export class LatestWriteQueueClosedError extends Error {
  constructor() {
    super("Latest-write queue is closed");
    this.name = "LatestWriteQueueClosedError";
  }
}

export interface LatestWriteQueueOptions {
  onError?: (error: unknown) => void;
}

type PendingWrite<Value> = {
  value: Value;
};

type FlushWaiter = {
  resolve: () => void;
  reject: (error: unknown) => void;
};

/**
 * Runs at most one write at a time and retains only the newest pending value.
 * A flush observes the queue until it drains, including values enqueued while
 * that flush is already waiting.
 */
export class LatestWriteQueue<Value> {
  readonly #write: (value: Value) => Promise<void> | void;
  readonly #onError?: (error: unknown) => void;
  readonly #flushWaiters = new Set<FlushWaiter>();

  #closed = false;
  #running = false;
  #pending: PendingWrite<Value> | null = null;
  #hasLastError = false;
  #lastError: unknown;

  constructor(
    write: (value: Value) => Promise<void> | void,
    options: LatestWriteQueueOptions = {},
  ) {
    this.#write = write;
    this.#onError = options.onError;
  }

  enqueue(value: Value) {
    if (this.#closed) throw new LatestWriteQueueClosedError();
    this.#pending = { value };
    this.#hasLastError = false;
    this.#startNext();
  }

  flush(): Promise<void> {
    if (this.#closed) {
      return Promise.reject(new LatestWriteQueueClosedError());
    }
    if (!this.#running && !this.#pending) {
      return this.#hasLastError
        ? Promise.reject(this.#lastError)
        : Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      this.#flushWaiters.add({ resolve, reject });
    });
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#pending = null;
    this.#rejectFlushWaiters(new LatestWriteQueueClosedError());
  }

  #startNext() {
    if (this.#closed || this.#running || !this.#pending) return;

    const current = this.#pending;
    this.#pending = null;
    this.#running = true;

    void Promise.resolve()
      .then(() => this.#write(current.value))
      .then(
        () => this.#settleSuccess(),
        (error: unknown) => this.#settleFailure(error),
      );
  }

  #settleSuccess() {
    this.#running = false;
    if (this.#closed) return;

    this.#hasLastError = false;
    this.#startNext();
    if (!this.#running && !this.#pending) this.#resolveFlushWaiters();
  }

  #settleFailure(error: unknown) {
    this.#running = false;
    if (this.#closed) return;

    this.#hasLastError = true;
    this.#lastError = error;
    try {
      this.#onError?.(error);
    } catch {
      // A reporting failure must not leave the write queue stuck.
    }

    if (this.#running || this.#pending) {
      this.#startNext();
      return;
    }
    this.#rejectFlushWaiters(error);
  }

  #resolveFlushWaiters() {
    for (const waiter of this.#flushWaiters) waiter.resolve();
    this.#flushWaiters.clear();
  }

  #rejectFlushWaiters(error: unknown) {
    for (const waiter of this.#flushWaiters) waiter.reject(error);
    this.#flushWaiters.clear();
  }
}
