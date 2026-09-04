import { activeWorkoutScopeKey } from "./active-workout-local-types";

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
export function acquireActiveWorkoutWriter(
  userId: string,
  sessionId: string,
  locks: Pick<LockManager, "request"> | null | undefined = typeof navigator === "undefined" ? undefined : navigator.locks,
): Promise<ActiveWorkoutWriterLease | null> {
  const key = `liftlog:workout-writer:${activeWorkoutScopeKey(userId, sessionId)}`;
  if (!locks) return Promise.reject(new ActiveWorkoutWriterUnavailableError());

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
