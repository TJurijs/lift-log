export type PerformanceMetricName =
  | "bootstrap"
  | "navigation"
  | "detail"
  | "save"
  | "long-task"
  | "interaction";

export type TelemetryOperation =
  | "bootstrap"
  | "navigation"
  | "detail"
  | "save"
  | "sync"
  | "authentication"
  | "render"
  | "unknown";

export type TelemetryEnvelope = {
  schemaVersion: 1;
  releaseSha: string;
  environment: "local" | "development" | "production" | "test";
  recordedAt: string;
} & (
  | {
      kind: "performance";
      payload: {
        name: PerformanceMetricName;
        durationMs: number;
        outcome?: "success" | "failure" | "cancelled";
        requestCount?: number;
        retries?: number;
        cardinalityBucket?: "0" | "1-10" | "11-50" | "51-250" | "251+";
        roleBucket?: "athlete" | "coach" | "both" | "unknown";
        phase?: "shell" | "repository";
      };
    }
  | {
      kind: "error";
      payload: {
        category: "render" | "network" | "authentication" | "storage" | "conflict" | "unknown";
        operation: TelemetryOperation;
        fatal: boolean;
        retryable: boolean;
      };
    }
);

export interface TelemetrySink {
  capture(envelope: TelemetryEnvelope): void | Promise<void>;
}

export interface TelemetryCollector {
  performance(payload: Extract<TelemetryEnvelope, { kind: "performance" }>['payload']): void;
  error(payload: Extract<TelemetryEnvelope, { kind: "error" }>['payload']): void;
}

export const browserTelemetryStorageKey = "liftlog:telemetry:v1";
const browserTelemetryCapacity = 100;

function browserSessionStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    // Browser policies can reject access to the storage getter itself.
    return null;
  }
}

/**
 * Keeps a small privacy-safe diagnostic trail in this browser session and
 * exposes the same envelope to an optional, separately reviewed adapter.
 */
export function createBrowserTelemetrySink(
  storage: Storage | null = browserSessionStorage(),
): TelemetrySink {
  return {
    capture(envelope) {
      if (storage) {
        try {
          const current: unknown = JSON.parse(
            storage.getItem(browserTelemetryStorageKey) ?? "[]",
          );
          const entries = Array.isArray(current) ? current : [];
          storage.setItem(
            browserTelemetryStorageKey,
            JSON.stringify(
              [...entries, envelope].slice(-browserTelemetryCapacity),
            ),
          );
        } catch {
          // Storage may be blocked or full; the live event remains available.
        }
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("liftlog:telemetry", { detail: envelope }),
        );
      }
    },
  };
}

type CollectorOptions = {
  sink: TelemetrySink;
  releaseSha?: string;
  environment?: TelemetryEnvelope["environment"];
  now?: () => Date;
};

const RELEASE_PATTERN = /^(?:[0-9a-f]{7,40}|local|development|test)$/u;

function runtimeReleaseSha(): string {
  if (typeof __LIFTLOG_RELEASE_SHA__ === "string") return __LIFTLOG_RELEASE_SHA__;
  return import.meta.env.VITE_RELEASE_SHA ?? "local";
}

function finiteNonnegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value * 100) / 100) : 0;
}

export function createTelemetryCollector(options: CollectorOptions): TelemetryCollector {
  const releaseCandidate = options.releaseSha ?? runtimeReleaseSha();
  const releaseSha = RELEASE_PATTERN.test(releaseCandidate)
    ? releaseCandidate
    : "local";
  const environment = options.environment ?? "local";
  const now = options.now ?? (() => new Date());
  const emit = (event: Omit<TelemetryEnvelope, "schemaVersion" | "releaseSha" | "environment" | "recordedAt">) => {
    const envelope = {
      schemaVersion: 1 as const,
      releaseSha,
      environment,
      recordedAt: now().toISOString(),
      ...event,
    } as TelemetryEnvelope;
    try {
      void Promise.resolve(options.sink.capture(envelope)).catch(() => undefined);
    } catch {
      // Observability is best-effort and must never break the product path.
    }
  };
  return {
    performance(payload) {
      emit({
        kind: "performance",
        payload: {
          name: payload.name,
          durationMs: finiteNonnegative(payload.durationMs),
          ...(payload.outcome ? { outcome: payload.outcome } : {}),
          ...(Number.isFinite(payload.requestCount) ? { requestCount: finiteNonnegative(payload.requestCount as number) } : {}),
          ...(Number.isFinite(payload.retries) ? { retries: finiteNonnegative(payload.retries as number) } : {}),
          ...(payload.cardinalityBucket ? { cardinalityBucket: payload.cardinalityBucket } : {}),
          ...(payload.roleBucket ? { roleBucket: payload.roleBucket } : {}),
          ...(payload.phase ? { phase: payload.phase } : {}),
        },
      });
    },
    error(payload) {
      emit({
        kind: "error",
        payload: {
          category: payload.category,
          operation: payload.operation,
          fatal: payload.fatal === true,
          retryable: payload.retryable === true,
        },
      });
    },
  };
}

const PERFORMANCE_NAMES = new Set<PerformanceMetricName>([
  "bootstrap", "navigation", "detail", "save", "long-task", "interaction",
]);

export function installBrowserTelemetry(collector: TelemetryCollector): () => void {
  const onPerformance = (event: Event) => {
    const detail: unknown = event instanceof CustomEvent ? event.detail : undefined;
    if (!detail || typeof detail !== "object") return;
    const record = detail as Record<string, unknown>;
    if (!PERFORMANCE_NAMES.has(record.name as PerformanceMetricName) || typeof record.durationMs !== "number") return;
    collector.performance({
      name: record.name as PerformanceMetricName,
      durationMs: record.durationMs,
      ...(record.outcome === "success" || record.outcome === "failure" || record.outcome === "cancelled" ? { outcome: record.outcome } : {}),
      ...(typeof record.requestCount === "number" ? { requestCount: record.requestCount } : {}),
      ...(typeof record.retries === "number" ? { retries: record.retries } : {}),
      ...(record.cardinalityBucket === "0" ||
      record.cardinalityBucket === "1-10" ||
      record.cardinalityBucket === "11-50" ||
      record.cardinalityBucket === "51-250" ||
      record.cardinalityBucket === "251+"
        ? { cardinalityBucket: record.cardinalityBucket }
        : {}),
      ...(record.roleBucket === "athlete" ||
      record.roleBucket === "coach" ||
      record.roleBucket === "both" ||
      record.roleBucket === "unknown"
        ? { roleBucket: record.roleBucket }
        : {}),
      ...(record.phase === "shell" || record.phase === "repository"
        ? { phase: record.phase }
        : {}),
    });
  };
  const onError = () => collector.error({ category: "render", operation: "unknown", fatal: false, retryable: false });
  const onRejection = () => collector.error({ category: "unknown", operation: "unknown", fatal: false, retryable: false });
  window.addEventListener("liftlog:performance", onPerformance);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("liftlog:performance", onPerformance);
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
