import { describe, expect, it, vi } from "vitest";

import {
  activeWorkoutRetryDelay,
  classifyActiveWorkoutFailure,
  runWithActiveWorkoutRetry,
} from "../../lib/active-workout-retry";

describe("active workout retry policy", () => {
  it("classifies offline, ambiguous transport, conflict, and permanent failures", () => {
    expect(
      classifyActiveWorkoutFailure(new TypeError("Failed to fetch"), {
        online: false,
      }),
    ).toMatchObject({ category: "offline", retryable: true, ambiguous: true });
    expect(
      classifyActiveWorkoutFailure({ status: 408, message: "Timeout" }),
    ).toMatchObject({ category: "timeout", retryable: true, ambiguous: true });
    expect(
      classifyActiveWorkoutFailure({ status: 503, message: "Unavailable" }),
    ).toMatchObject({ category: "server", retryable: true, ambiguous: true });
    expect(
      classifyActiveWorkoutFailure({ status: 409, code: "REVISION_CONFLICT" }),
    ).toMatchObject({
      category: "revision-conflict",
      retryable: false,
      ambiguous: false,
    });
    expect(classifyActiveWorkoutFailure({ status: 401 })).toMatchObject({
      category: "auth",
      retryable: false,
    });
    expect(classifyActiveWorkoutFailure({ status: 422 })).toMatchObject({
      category: "validation",
      retryable: false,
    });
    expect(
      classifyActiveWorkoutFailure(new DOMException("Canceled", "AbortError")),
    ).toMatchObject({ category: "aborted", retryable: false });
  });

  it("honors Retry-After and applies capped exponential jitter", () => {
    expect(
      classifyActiveWorkoutFailure({
        status: 429,
        headers: { get: () => "4" },
      }),
    ).toMatchObject({
      category: "rate-limit",
      retryable: true,
      ambiguous: false,
      retryAfterMs: 4_000,
    });
    expect(
      activeWorkoutRetryDelay(1, {
        baseDelayMs: 500,
        maximumDelayMs: 2_000,
        jitterRatio: 0.2,
        random: () => 0.5,
      }),
    ).toBe(500);
    expect(
      activeWorkoutRetryDelay(5, {
        baseDelayMs: 500,
        maximumDelayMs: 2_000,
        jitterRatio: 0,
        random: () => 0.5,
      }),
    ).toBe(2_000);
    expect(
      activeWorkoutRetryDelay(1, {
        baseDelayMs: 500,
        maximumDelayMs: 2_000,
        jitterRatio: 0,
        random: () => 0.5,
        retryAfterMs: 4_000,
      }),
    ).toBe(4_000);
  });

  it("retries bounded ambiguous failures and reports every delay", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValue("saved");
    const sleep = vi.fn<(delayMs: number) => Promise<void>>(async () => undefined);
    const onRetry = vi.fn();

    await expect(
      runWithActiveWorkoutRetry(() => operation(), {
        maxAttempts: 4,
        baseDelayMs: 100,
        jitterRatio: 0,
        random: () => 0.5,
        sleep,
        onRetry,
      }),
    ).resolves.toBe("saved");
    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([100, 200]);
    expect(onRetry.mock.calls.map(([, attempt]) => attempt)).toEqual([1, 2]);
  });

  it("does not retry a revision conflict", async () => {
    const conflict = Object.assign(new Error("revision conflict"), {
      status: 409,
    });
    const operation = vi.fn(async () => {
      throw conflict;
    });
    const sleep = vi.fn<(delayMs: number) => Promise<void>>(async () => undefined);
    await expect(
      runWithActiveWorkoutRetry(operation, { sleep }),
    ).rejects.toBe(conflict);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
