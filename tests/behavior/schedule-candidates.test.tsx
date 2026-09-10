import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useScheduleCandidates } from "../../app/features/scheduling/useScheduleCandidates";
import type { SchedulableWorkoutCandidate, SchedulableWorkoutCursor } from "../../lib/domain";

const candidate: SchedulableWorkoutCandidate = {
  kind: "program", programId: "program", programVersionId: "version", workoutId: "workout",
  programTitle: "Quick session", workoutTitle: "Quick session", contentType: "quick_workout",
  isQuickWorkout: true, weekIndex: 1, weekLabel: "Week 1", workoutPosition: 0,
  scheduleLabel: "Any day", estimatedMinutes: 20,
};
const cursor: SchedulableWorkoutCursor = { programTitle: "Quick session", weekIndex: 1, workoutPosition: 0, id: "workout" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("scheduling candidate controller", () => {
  it("preserves ordinary choices when frequent ranking fails and paginates by identity", async () => {
    const repository = {
      listSchedulableWorkouts: vi.fn().mockResolvedValueOnce({ items: [candidate], nextCursor: cursor })
        .mockResolvedValueOnce({ items: [candidate, { ...candidate, workoutId: "second" }], nextCursor: undefined }),
      listFrequentSchedulableWorkouts: vi.fn().mockRejectedValue(new Error("Optional ranking unavailable")),
    };
    const { result } = renderHook(() => useScheduleCandidates({ repository, schedulablePrograms: [], schedules: [] }));
    await act(() => result.current.loadScheduleCandidates(true));
    expect(result.current.scheduleCandidates).toEqual([candidate]);
    expect(result.current.scheduleCandidatesError).toBe("");
    await act(() => result.current.loadScheduleCandidates());
    expect(repository.listSchedulableWorkouts).toHaveBeenLastCalledWith({ limit: 50, cursor });
    expect(result.current.scheduleCandidates.map((item) => item.workoutId)).toEqual(["workout", "second"]);
    expect(result.current.scheduleCandidateCursor).toBeUndefined();
  });

  it("ignores an old picker response after selecting a specific program", async () => {
    const pending = deferred<{ items: SchedulableWorkoutCandidate[]; hasMore: boolean }>();
    const repository = {
      listSchedulableWorkouts: vi.fn(() => pending.promise),
      listFrequentSchedulableWorkouts: vi.fn().mockResolvedValue([]),
    };
    const { result } = renderHook(() => useScheduleCandidates({ repository, schedulablePrograms: [], schedules: [] }));
    let request!: Promise<void>;
    act(() => { request = result.current.loadScheduleCandidates(true); });
    await act(() => result.current.loadScheduleCandidates());
    expect(repository.listSchedulableWorkouts).toHaveBeenCalledOnce();
    const selected = { ...candidate, workoutId: "selected" };
    act(() => result.current.replaceScheduleCandidates([selected]));
    await act(async () => { pending.resolve({ items: [candidate], hasMore: false }); await request; });
    expect(result.current.scheduleCandidates).toEqual([selected]);
    expect(result.current.scheduleCandidatesLoading).toBe(false);
  });

  it("keeps a newer refresh when older network work resolves last", async () => {
    const old = deferred<{ items: SchedulableWorkoutCandidate[] }>();
    const repository = {
      listSchedulableWorkouts: vi.fn().mockReturnValueOnce(old.promise)
        .mockResolvedValueOnce({ items: [{ ...candidate, workoutId: "new" }] }),
      listFrequentSchedulableWorkouts: vi.fn().mockResolvedValue([]),
    };
    const { result } = renderHook(() => useScheduleCandidates({ repository, schedulablePrograms: [], schedules: [] }));
    let request!: Promise<void>;
    act(() => { request = result.current.loadScheduleCandidates(true); });
    await act(() => result.current.loadScheduleCandidates(true));
    await act(async () => { old.resolve({ items: [candidate] }); await request; });
    expect(result.current.scheduleCandidates.map((item) => item.workoutId)).toEqual(["new"]);
  });
});
