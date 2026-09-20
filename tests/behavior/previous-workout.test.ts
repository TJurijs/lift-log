import { describe, expect, it, vi } from "vitest";
import { parsePreviousWorkoutValues, validatePreviousWorkoutValues } from "../../lib/previous-workout";
import { LiftLogRepository } from "../../lib/repository";

const payload = {
  sessionId: "previous-session", completedAt: "2026-09-12T12:00:00Z",
  items: [
    { workoutItemId: "first-squat", mode: "sets", fields: ["reps", "load", "rpe"], entries: [{ position: 0, reps: 0, loadKg: 45, rpe: 7 }, { position: 2, reps: 5, loadKg: null, rpe: null }] },
    { workoutItemId: "second-squat", mode: "sets", fields: ["reps", "load", "rpe"], entries: [{ position: 0, reps: 8, loadKg: 30, rpe: 6 }] },
    { workoutItemId: "timed", mode: "sets", fields: ["duration", "heartRate"], entries: [{ position: 0, durationSeconds: 45, heartRate: 120, loadKg: 999 }] },
    { workoutItemId: "distance", mode: "result", fields: ["duration", "distance", "heartRate", "rpe"], entries: [{ position: 0, durationSeconds: 90, distanceMetres: 500, heartRate: 140, rpe: 8 }] },
    { workoutItemId: "intervals", mode: "intervals", fields: ["rounds", "duration", "distance", "heartRate", "rpe"], entries: [{ position: 0, rounds: 1, durationSeconds: 30, distanceMetres: 0, heartRate: 150, rpe: 9 }, { position: 1, rounds: null, durationSeconds: null }] },
  ],
};

describe("previous workout reference values", () => {
  it("keeps movement occurrences and entry positions separate, preserves zero and converts units", () => {
    const result = parsePreviousWorkoutValues(payload)!;
    expect(result.items["first-squat"].setLogs).toEqual([{ reps: "0", load: "45", rpe: "7" }, { reps: "", load: "", rpe: "" }, { reps: "5", load: "", rpe: "" }]);
    expect(result.items["second-squat"].setLogs[0]).toEqual({ reps: "8", load: "30", rpe: "6" });
    expect(result.items.timed.setLogs[0]).toEqual({ reps: "", load: "", rpe: "", duration: "0.75", heartRate: "120" });
    expect(result.items.distance.resultLog).toMatchObject({ duration: "1.5", distance: "0.5", heartRate: "140", rpe: "8" });
    expect(result.items.intervals.resultLog).toMatchObject({ "round.0.completed": "1", "round.0.duration": "30", "round.0.distance": "0", "round.1.duration": "" });
  });

  it("validates the offline reference cache, rejects draft-shaped or malformed data, and copies values", () => {
    const reference = parsePreviousWorkoutValues(payload)!;
    const copy = validatePreviousWorkoutValues(reference)!;
    expect(copy).toEqual(reference);
    copy.items["first-squat"].setLogs[0].load = "100";
    expect(reference.items["first-squat"].setLogs[0].load).toBe("45");
    expect(validatePreviousWorkoutValues({ ...reference, items: { bad: { setLogs: [{ reps: "5", load: "not numeric", rpe: "" }], resultLog: {} } } })).toBeNull();
    expect(validatePreviousWorkoutValues({ setLogs: {}, resultLogs: {}, sessionRpe: "7" })).toBeNull();
    expect(parsePreviousWorkoutValues(null)).toBeNull();
    expect(parsePreviousWorkoutValues({ ...payload, completedAt: "invalid" })).toBeNull();
  });

  it("uses one cached RPC per workout/exclusion and invalidates it after completing a session", async () => {
    const rpc = vi.fn(async (name: string) => ({ data: name === "get_previous_workout_values" ? payload : {}, error: null }));
    const repository = new LiftLogRepository({ rpc } as never, "viewer", "Viewer");
    await Promise.all([repository.loadPreviousWorkoutValues("workout", "active"), repository.loadPreviousWorkoutValues("workout", "active")]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenLastCalledWith("get_previous_workout_values", { target_workout_id: "workout", exclude_session_id: "active" });
    await repository.loadPreviousWorkoutValues("workout", "another-session");
    expect(rpc).toHaveBeenCalledTimes(2);
    await repository.completeSession("active", "7", "", 0, "completion-token");
    await repository.loadPreviousWorkoutValues("workout", "active");
    expect(rpc).toHaveBeenCalledTimes(4);
  });

  it("does not cache a failed reference read", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: null, error: { message: "Offline" } }).mockResolvedValue({ data: null, error: null });
    const repository = new LiftLogRepository({ rpc } as never, "viewer", "Viewer");
    await expect(repository.loadPreviousWorkoutValues("workout")).rejects.toThrow("Offline");
    await expect(repository.loadPreviousWorkoutValues("workout")).resolves.toBeNull();
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
