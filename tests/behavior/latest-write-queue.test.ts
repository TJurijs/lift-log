import { describe, expect, it, vi } from "vitest";

import {
  LatestWriteQueue,
  LatestWriteQueueClosedError,
} from "../../lib/latest-write-queue";

function controlledPromise() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
}

async function drainMicrotasks() {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

describe("LatestWriteQueue", () => {
  it("never overlaps writes", async () => {
    const first = controlledPromise();
    const second = controlledPromise();
    const writes: string[] = [];
    let activeWrites = 0;
    let maximumActiveWrites = 0;
    const completions = [first, second];
    const queue = new LatestWriteQueue<string>((value) => {
      writes.push(value);
      activeWrites += 1;
      maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
      return completions[writes.length - 1].promise.finally(() => {
        activeWrites -= 1;
      });
    });

    queue.enqueue("first");
    await drainMicrotasks();
    queue.enqueue("second");
    await drainMicrotasks();

    expect(writes).toEqual(["first"]);
    expect(maximumActiveWrites).toBe(1);

    first.resolve();
    await drainMicrotasks();

    expect(writes).toEqual(["first", "second"]);
    expect(maximumActiveWrites).toBe(1);

    second.resolve();
    await queue.flush();
    expect(maximumActiveWrites).toBe(1);
  });

  it("coalesces pending writes to the newest value", async () => {
    const first = controlledPromise();
    const newest = controlledPromise();
    const writes: string[] = [];
    const queue = new LatestWriteQueue<string>((value) => {
      writes.push(value);
      return writes.length === 1 ? first.promise : newest.promise;
    });

    queue.enqueue("first");
    await drainMicrotasks();
    queue.enqueue("stale-pending");
    queue.enqueue("newest-pending");

    first.resolve();
    await drainMicrotasks();

    expect(writes).toEqual(["first", "newest-pending"]);

    newest.resolve();
    await queue.flush();
  });

  it("keeps flush waiting until the newest queued write is acknowledged", async () => {
    const first = controlledPromise();
    const newest = controlledPromise();
    const writes: string[] = [];
    const queue = new LatestWriteQueue<string>((value) => {
      writes.push(value);
      return writes.length === 1 ? first.promise : newest.promise;
    });

    queue.enqueue("first");
    await drainMicrotasks();
    const flushed = queue.flush();
    const onFlushed = vi.fn();
    void flushed.then(onFlushed);
    queue.enqueue("newest");

    first.resolve();
    await drainMicrotasks();

    expect(writes).toEqual(["first", "newest"]);
    expect(onFlushed).not.toHaveBeenCalled();

    newest.resolve();
    await flushed;
    expect(onFlushed).toHaveBeenCalledOnce();
  });

  it("reports a rejection and accepts a later retry", async () => {
    const failed = controlledPromise();
    const retried = controlledPromise();
    const failure = new Error("offline");
    const onError = vi.fn();
    let attempt = 0;
    const queue = new LatestWriteQueue<string>(
      () => {
        attempt += 1;
        return attempt === 1 ? failed.promise : retried.promise;
      },
      { onError },
    );

    queue.enqueue("fails");
    const failedFlush = queue.flush();
    failed.reject(failure);

    await expect(failedFlush).rejects.toBe(failure);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(failure);

    queue.enqueue("retry");
    const retriedFlush = queue.flush();
    retried.resolve();

    await expect(retriedFlush).resolves.toBeUndefined();
    expect(attempt).toBe(2);
  });

  it("flushes a newer snapshot after an older in-flight write rejects", async () => {
    const older = controlledPromise();
    const newer = controlledPromise();
    const failure = new Error("older autosave failed");
    const writes: string[] = [];
    const onError = vi.fn();
    const queue = new LatestWriteQueue<string>(
      (value) => {
        writes.push(value);
        return writes.length === 1 ? older.promise : newer.promise;
      },
      { onError },
    );

    queue.enqueue("older-autosave");
    await drainMicrotasks();
    queue.enqueue("finish-snapshot");
    const flushed = queue.flush();
    const onFlushed = vi.fn();
    void flushed.then(onFlushed);

    older.reject(failure);
    await drainMicrotasks();

    expect(onError).toHaveBeenCalledWith(failure);
    expect(writes).toEqual(["older-autosave", "finish-snapshot"]);
    expect(onFlushed).not.toHaveBeenCalled();

    newer.resolve();
    await flushed;
    expect(onFlushed).toHaveBeenCalledOnce();
  });

  it("discards stale pending work when closed and allows a replacement queue", async () => {
    const oldActive = controlledPromise();
    const replacementWrite = controlledPromise();
    const writes: string[] = [];
    const oldQueue = new LatestWriteQueue<string>((value) => {
      writes.push(value);
      return oldActive.promise;
    });

    oldQueue.enqueue("old-active");
    await drainMicrotasks();
    oldQueue.enqueue("old-stale-pending");
    const oldFlush = oldQueue.flush();
    oldQueue.close();

    await expect(oldFlush).rejects.toBeInstanceOf(LatestWriteQueueClosedError);
    await expect(oldQueue.flush()).rejects.toBeInstanceOf(
      LatestWriteQueueClosedError,
    );
    expect(() => oldQueue.enqueue("closed-write")).toThrow(
      LatestWriteQueueClosedError,
    );

    oldActive.resolve();
    await drainMicrotasks();
    expect(writes).toEqual(["old-active"]);

    const replacementQueue = new LatestWriteQueue<string>((value) => {
      writes.push(value);
      return replacementWrite.promise;
    });
    replacementQueue.enqueue("replacement-session");
    await drainMicrotasks();
    replacementWrite.resolve();
    await replacementQueue.flush();

    expect(writes).toEqual(["old-active", "replacement-session"]);
  });
});
