import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireActiveWorkoutWriter,
  ActiveWorkoutWriterUnavailableError,
} from "../../lib/active-workout-writer-lock";
import { createTestLockManager } from "../helpers/test-lock-manager";

afterEach(() => vi.useRealTimers());

describe("active workout writer leases", () => {
  it("grants one writer across simultaneous requests and allows takeover after release", async () => {
    const locks = createTestLockManager();
    const [first, second] = await Promise.all([
      acquireActiveWorkoutWriter("user", "workout", locks),
      acquireActiveWorkoutWriter("user", "workout", locks),
    ]);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    await first?.release();
    const replacement = await acquireActiveWorkoutWriter("user", "workout", locks);
    expect(replacement).not.toBeNull();
    await replacement?.release();
  });

  it("scopes writers to their user and workout and releases idempotently", async () => {
    const locks = createTestLockManager();
    const leases = await Promise.all([
      acquireActiveWorkoutWriter("user-1", "workout-1", locks),
      acquireActiveWorkoutWriter("user-1", "workout-2", locks),
      acquireActiveWorkoutWriter("user-2", "workout-1", locks),
    ]);
    expect(leases.every(Boolean)).toBe(true);
    await Promise.all(leases.flatMap((lease) => [lease?.release(), lease?.release()]));
  });

  it("fails closed when browser-wide locking is unavailable", async () => {
    await expect(acquireActiveWorkoutWriter("user", "workout", null)).rejects.toBeInstanceOf(ActiveWorkoutWriterUnavailableError);
  });

  it("reports lock-manager failures instead of leaving acquisition pending", async () => {
    const failure = new Error("Browser storage denied");
    const locks = { request: () => { throw failure; } };
    await expect(acquireActiveWorkoutWriter("user", "workout", locks)).rejects.toBe(failure);
  });

  it("hands over after a closing browser delays releasing its lock, without stealing it", async () => {
    vi.useFakeTimers();
    const locks = createTestLockManager();
    const first = await acquireActiveWorkoutWriter("user", "workout", locks);
    let acquired = false;
    const retry = acquireActiveWorkoutWriter("user", "workout", locks, { retryForMs: 2_000 })
      .then((lease) => { acquired = Boolean(lease); return lease; });
    await vi.advanceTimersByTimeAsync(500);
    expect(acquired).toBe(false);
    await first!.release();
    await vi.advanceTimersByTimeAsync(100);
    const replacement = await retry;
    expect(replacement).not.toBeNull();
    await replacement!.release();
  });

  it("stops retrying after the handover window and keeps a live writer protected", async () => {
    vi.useFakeTimers();
    const locks = createTestLockManager();
    const first = await acquireActiveWorkoutWriter("user", "workout", locks);
    const onBlocked = vi.fn();
    const retry = acquireActiveWorkoutWriter("user", "workout", locks, { retryForMs: 2_000, onBlocked });
    await vi.advanceTimersByTimeAsync(0);
    expect(onBlocked).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await retry).toBeNull();
    expect(onBlocked).toHaveBeenCalledOnce();
    expect(await acquireActiveWorkoutWriter("user", "workout", locks)).toBeNull();
    await first!.release();
  });

  it("cancels a handover immediately and removes its retry timer", async () => {
    vi.useFakeTimers();
    const locks = createTestLockManager();
    const first = await acquireActiveWorkoutWriter("user", "workout", locks);
    const abort = new AbortController();
    const retry = acquireActiveWorkoutWriter("user", "workout", locks, { retryForMs: 2_000, signal: abort.signal });
    const rejected = expect(retry).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(100);
    abort.abort();
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    await first!.release();
    const next = await acquireActiveWorkoutWriter("user", "workout", locks);
    expect(next).not.toBeNull();
    await next!.release();
  });

  it("releases a late grant when its workout scope was cancelled during acquisition", async () => {
    const locks = createTestLockManager();
    let allowRequest!: () => void;
    const delayed = new Promise<void>((resolve) => { allowRequest = resolve; });
    const delayedLocks = { request: async (name: string, options: LockOptions, callback: LockGrantedCallback<unknown>) => {
      await delayed;
      return locks.request(name, options, callback);
    } } as LockManager;
    const abort = new AbortController();
    const retry = acquireActiveWorkoutWriter("user", "workout", delayedLocks, { retryForMs: 2_000, signal: abort.signal });
    const rejected = expect(retry).rejects.toMatchObject({ name: "AbortError" });
    abort.abort();
    allowRequest();
    await rejected;
    const next = await acquireActiveWorkoutWriter("user", "workout", locks);
    expect(next).not.toBeNull();
    await next!.release();
  });
});
