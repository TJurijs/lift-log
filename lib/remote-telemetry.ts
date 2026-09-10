import { createTelemetryCollector, type TelemetryEnvelope } from "./telemetry";

type Send = (events: TelemetryEnvelope[]) => Promise<unknown>;

/** Bounded, memory-only diagnostics. Never persists a queue across accounts. */
export function installRemoteTelemetry(send: Send) {
  let queue: TelemetryEnvelope[] = [];
  let active = true;
  let sending = false;
  const enqueue = (event: TelemetryEnvelope) => {
    if (queue.length === 20) {
      const performance = queue.findIndex(item => item.kind === "performance");
      queue.splice(performance < 0 ? 0 : performance, 1);
    }
    queue.push(event);
  };
  const receive = (event: Event) => {
    if (!(event instanceof CustomEvent) || !event.detail || typeof event.detail !== "object") return;
    const raw = event.detail as Partial<TelemetryEnvelope>;
    if (!raw.payload || typeof raw.payload !== "object" ||
      !["production", "development", "local", "test"].includes(raw.environment ?? "") ||
      typeof raw.releaseSha !== "string" || typeof raw.recordedAt !== "string" ||
      !Number.isFinite(Date.parse(raw.recordedAt))) return;
    // Rebuild the envelope through the allowlisting collector, dropping extras.
    const collector = createTelemetryCollector({
      sink: { capture: enqueue }, environment: raw.environment,
      releaseSha: raw.releaseSha, now: () => new Date(raw.recordedAt!),
    });
    if (raw.kind === "performance" && "name" in raw.payload &&
      ["bootstrap", "navigation", "detail", "save", "long-task", "interaction"].includes(raw.payload.name) &&
      typeof raw.payload.durationMs === "number") {
      const payload = raw.payload as Extract<TelemetryEnvelope, { kind: "performance" }>["payload"];
      // Keep the outcome needed by failure-rate reports; never spread an event's
      // arbitrary properties into the network payload.
      collector.performance({
        name: payload.name, durationMs: Math.min(86_400_000, payload.durationMs),
        ...(["success", "failure", "cancelled"].includes(payload.outcome ?? "") ? { outcome: payload.outcome } : {}),
      });
    } else if (raw.kind === "error" && "category" in raw.payload) {
      const payload = raw.payload as Extract<TelemetryEnvelope, { kind: "error" }>["payload"];
      collector.error({
        category: ["render", "network", "authentication", "storage", "conflict"].includes(payload.category) ? payload.category : "unknown",
        operation: ["bootstrap", "navigation", "detail", "save", "sync", "authentication", "render"].includes(payload.operation) ? payload.operation : "unknown",
        fatal: payload.fatal === true, retryable: payload.retryable === true,
      });
    }
  };
  const timer = window.setInterval(() => {
    if (!active || sending || !navigator.onLine || !queue.length) return;
    const batch = queue.splice(0, 10);
    sending = true;
    // Diagnostics are expendable: no automatic retry loop competes with workouts.
    void Promise.resolve().then(() => active ? send(batch) : undefined)
      .catch(() => undefined).finally(() => { sending = false; });
  }, 30_000);
  window.addEventListener("liftlog:telemetry", receive);
  return () => {
    active = false;
    queue = [];
    window.clearInterval(timer);
    window.removeEventListener("liftlog:telemetry", receive);
  };
}
