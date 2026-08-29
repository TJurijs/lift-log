import type {
  ActiveWorkoutFailureCategory,
} from "./active-workout-local-types";

export interface ActiveWorkoutRetryDecision {
  category: ActiveWorkoutFailureCategory;
  retryable: boolean;
  /** True when the server may have committed the request before the failure. */
  ambiguous: boolean;
  retryAfterMs?: number;
  status?: number;
  code?: string;
}

export interface ActiveWorkoutFailureContext {
  /** Pass `navigator.onLine` at the call site. Omit it outside a browser. */
  online?: boolean;
  now?: () => number;
}

type ErrorRecord = Record<string, unknown>;

function asRecord(value: unknown): ErrorRecord | null {
  return typeof value === "object" && value !== null
    ? (value as ErrorRecord)
    : null;
}

function numericStatus(error: ErrorRecord | null) {
  const response = asRecord(error?.response);
  const candidate = error?.status ?? error?.statusCode ?? response?.status;
  return typeof candidate === "number" && Number.isFinite(candidate)
    ? candidate
    : typeof candidate === "string" && /^\d{3}$/.test(candidate)
      ? Number(candidate)
      : undefined;
}

function errorCode(error: ErrorRecord | null) {
  const candidate = error?.code ?? error?.errorCode;
  return typeof candidate === "string" ? candidate.toUpperCase() : undefined;
}

function errorName(error: ErrorRecord | null) {
  return typeof error?.name === "string" ? error.name : undefined;
}

function errorMessage(value: unknown, error: ErrorRecord | null) {
  if (typeof error?.message === "string") return error.message;
  return typeof value === "string" ? value : "";
}

function retryAfterMilliseconds(
  error: ErrorRecord | null,
  now: () => number,
) {
  const explicit = error?.retryAfterMs;
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit >= 0) {
    return explicit;
  }

  const response = asRecord(error?.response);
  const headers = error?.headers ?? response?.headers;
  let header: unknown;
  if (headers && typeof (headers as { get?: unknown }).get === "function") {
    header = (headers as { get(name: string): unknown }).get("retry-after");
  } else if (asRecord(headers)) {
    header =
      (headers as ErrorRecord)["retry-after"] ??
      (headers as ErrorRecord)["Retry-After"];
  }
  if (typeof header !== "string") return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - now()) : undefined;
}

function decision(
  category: ActiveWorkoutFailureCategory,
  retryable: boolean,
  ambiguous: boolean,
  status?: number,
  code?: string,
  retryAfterMs?: number,
): ActiveWorkoutRetryDecision {
  return {
    category,
    retryable,
    ambiguous,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    ...(status === undefined ? {} : { status }),
    ...(code === undefined ? {} : { code }),
  };
}

/**
 * Classifies transport and HTTP failures without coupling the persistence
 * layer to Supabase. Ambiguous failures are safe to retry only with the exact
 * same idempotency key and immutable mutation snapshot.
 */
export function classifyActiveWorkoutFailure(
  value: unknown,
  context: ActiveWorkoutFailureContext = {},
): ActiveWorkoutRetryDecision {
  const error = asRecord(value);
  const status = numericStatus(error);
  const code = errorCode(error);
  const name = errorName(error);
  const message = errorMessage(value, error);
  const normalizedMessage = message.toLowerCase();

  if (
    name === "AbortError" ||
    code === "ABORT_ERR" ||
    code === "ERR_CANCELED" ||
    code === "ERR_CANCELLED"
  ) {
    return decision("aborted", false, false, status, code);
  }
  if (
    status === 409 ||
    code === "ACTIVE_WORKOUT_REVISION_CONFLICT" ||
    code === "REVISION_CONFLICT" ||
    normalizedMessage.includes("revision conflict") ||
    normalizedMessage.includes("stale revision")
  ) {
    return decision("revision-conflict", false, false, status, code);
  }
  if (status === 401 || status === 403 || code === "AUTH_ERROR") {
    return decision("auth", false, false, status, code);
  }
  if (status === 429 || code === "RATE_LIMITED" || code === "TOO_MANY_REQUESTS") {
    return decision(
      "rate-limit",
      true,
      false,
      status,
      code,
      retryAfterMilliseconds(error, context.now ?? Date.now),
    );
  }
  if (
    status === 408 ||
    name === "TimeoutError" ||
    code === "ETIMEDOUT" ||
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    /(?:timed? out|timeout)/i.test(message)
  ) {
    return decision("timeout", true, true, status, code);
  }
  if (status !== undefined && status >= 500 && status <= 599) {
    return decision("server", true, true, status, code);
  }
  if (status !== undefined && status >= 400 && status <= 499) {
    return decision("validation", false, false, status, code);
  }
  if (context.online === false) {
    return decision("offline", true, true, status, code);
  }
  if (
    name === "TypeError" &&
      /(?:fetch|network|load failed|connection)/i.test(message) ||
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ENETUNREACH" ||
    code === "EAI_AGAIN" ||
    /(?:failed to fetch|network error|connection lost)/i.test(message)
  ) {
    return decision("network", true, true, status, code);
  }
  return decision("unknown", false, false, status, code);
}

export interface ActiveWorkoutBackoffOptions {
  baseDelayMs?: number;
  maximumDelayMs?: number;
  jitterRatio?: number;
  random?: () => number;
  retryAfterMs?: number;
}

/** `attemptCount` is one-based and describes the failed attempt. */
export function activeWorkoutRetryDelay(
  attemptCount: number,
  options: ActiveWorkoutBackoffOptions = {},
) {
  if (!Number.isSafeInteger(attemptCount) || attemptCount < 1) {
    throw new RangeError("Retry attempt count must be one or greater");
  }
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maximumDelayMs = options.maximumDelayMs ?? 30_000;
  const jitterRatio = options.jitterRatio ?? 0.2;
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0) {
    throw new RangeError("Retry base delay must be zero or greater");
  }
  if (!Number.isFinite(maximumDelayMs) || maximumDelayMs < baseDelayMs) {
    throw new RangeError("Retry maximum delay cannot be less than the base delay");
  }
  if (!Number.isFinite(jitterRatio) || jitterRatio < 0 || jitterRatio > 1) {
    throw new RangeError("Retry jitter ratio must be between zero and one");
  }
  const randomValue = (options.random ?? Math.random)();
  if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue > 1) {
    throw new RangeError("Retry random source must return a value from zero to one");
  }
  const exponential = Math.min(
    maximumDelayMs,
    baseDelayMs * 2 ** Math.min(attemptCount - 1, 30),
  );
  const jittered = Math.round(
    exponential * (1 + (randomValue * 2 - 1) * jitterRatio),
  );
  return Math.max(0, jittered, options.retryAfterMs ?? 0);
}

export interface ActiveWorkoutRetryOptions
  extends Omit<ActiveWorkoutBackoffOptions, "retryAfterMs"> {
  maxAttempts?: number;
  signal?: AbortSignal;
  classify?: (error: unknown) => ActiveWorkoutRetryDecision;
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  onRetry?: (
    decision: ActiveWorkoutRetryDecision,
    attemptCount: number,
    delayMs: number,
  ) => void | Promise<void>;
}

function defaultSleep(delayMs: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, delayMs);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

/** Runs a bounded retry loop. The caller must reuse one prepared mutation. */
export async function runWithActiveWorkoutRetry<T>(
  operation: (attemptCount: number, signal?: AbortSignal) => Promise<T>,
  options: ActiveWorkoutRetryOptions = {},
) {
  const maxAttempts = options.maxAttempts ?? 4;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError("Maximum retry attempts must be one or greater");
  }
  const classify = options.classify ?? classifyActiveWorkoutFailure;
  const sleep = options.sleep ?? defaultSleep;
  for (let attemptCount = 1; attemptCount <= maxAttempts; attemptCount += 1) {
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    try {
      return await operation(attemptCount, options.signal);
    } catch (error) {
      const retryDecision = classify(error);
      if (!retryDecision.retryable || attemptCount >= maxAttempts) throw error;
      const delayMs = activeWorkoutRetryDelay(attemptCount, {
        baseDelayMs: options.baseDelayMs,
        maximumDelayMs: options.maximumDelayMs,
        jitterRatio: options.jitterRatio,
        random: options.random,
        retryAfterMs: retryDecision.retryAfterMs,
      });
      await options.onRetry?.(retryDecision, attemptCount, delayMs);
      await sleep(delayMs, options.signal);
    }
  }
  throw new Error("Active workout retry loop exhausted unexpectedly");
}
