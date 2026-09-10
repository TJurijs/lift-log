import { activeWorkoutScopeKey } from "./active-workout-local-types";
import { waitForActiveWorkoutRetry } from "./active-workout-retry";

export class ActiveWorkoutWriterUnavailableError extends Error {
  constructor() {
    super("This browser cannot protect workout edits across tabs. Update your browser and try again.");
    this.name = "ActiveWorkoutWriterUnavailableError";
  }
}

export interface ActiveWorkoutWriterLease {
  /** Release only after this writer's pending local and server work settles. */
  release(): Promise<void>;
}

/** Holds an origin-wide, exclusive writer lease without queuing another tab. */
export async function acquireActiveWorkoutWriter(
  userId: string,
  sessionId: string,
  locks: Pick<LockManager, "request"> | null | undefined = typeof navigator === "undefined" ? undefined : navigator.locks,
  options: { retryForMs?: number; signal?: AbortSignal; onBlocked?: () => void } = {},
): Promise<ActiveWorkoutWriterLease | null> {
  const key = `liftlog:workout-writer:${activeWorkoutScopeKey(userId, sessionId)}`;
  if (!locks) return Promise.reject(new ActiveWorkoutWriterUnavailableError());
  const deadline = Date.now() + (options.retryForMs ?? 0);
  let reportBlocked = options.onBlocked;
  while (true) {
    if (options.signal?.aborted) throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    const lease = await requestWriter(key, locks);
    if (options.signal?.aborted) {
      await lease?.release();
      throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    const remaining = deadline - Date.now();
    if (lease || remaining <= 0) return lease;
    reportBlocked?.();
    reportBlocked = undefined;
    // A closed WebKit page can retain its native lock briefly after close()
    // resolves. Retry only the non-stealing probe during an explicit handover.
    await waitForActiveWorkoutRetry(Math.min(100, remaining), options.signal);
  }
}

function requestWriter(key: string, locks: Pick<LockManager, "request">): Promise<ActiveWorkoutWriterLease | null> {
  return new Promise((resolve, reject) => {
    let release!: () => void;
    const released = new Promise<void>((onRelease) => { release = onRelease; });
    // Deferring the request also turns a synchronous browser/storage failure
    // into the same recoverable rejection as an asynchronous lock failure.
    const request = Promise.resolve().then(async () => { await locks.request(
      key,
      { mode: "exclusive", ifAvailable: true },
      async (lock) => {
        if (!lock) {
          resolve(null);
          return;
        }
        resolve({
          release: () => {
            release();
            return request;
          },
        });
        await released;
      },
    ); });
    void request.catch(reject);
  });
}
