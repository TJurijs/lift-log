import { describe, expect, it } from "vitest";
import {
  acquireActiveWorkoutWriter,
  ActiveWorkoutWriterUnavailableError,
} from "../../lib/active-workout-writer-lock";
import { createTestLockManager } from "../helpers/test-lock-manager";

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
});
