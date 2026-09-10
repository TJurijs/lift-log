import { describe, expect, it } from "vitest";
import type { PlannedWorkout, SessionSetValue, WorkoutItem } from "../../lib/domain";
import { plannedRecordingValues, unrecordedEntryCount } from "../../lib/workout-recording";

function item(overrides: Partial<WorkoutItem> = {}): WorkoutItem {
  return { id: "exercise", title: "Exercise", cue: "", mode: "sets", fields: ["reps", "load"], prescription: { sets: 3, reps: "5", loadKg: 40 }, ...overrides };
}

function workout(items: WorkoutItem[]): PlannedWorkout {
  return { id: "workout", title: "Workout", dayLabel: "Today", durationMinutes: 20, sections: [{ id: "main", title: "Exercises", items }] };
}

const blankSet = (): SessionSetValue => ({ reps: "", load: "", rpe: "" });

describe("planned recording values", () => {
  it("copies only tracked exact objective targets and never target RPE", () => {
    expect(plannedRecordingValues(item({ fields: ["reps", "load", "duration", "distance", "heartRate", "rpe"], prescription: { reps: "5", loadKg: 40, durationMinutes: 0.5, distance: 500, distanceUnit: "m", targetRpe: "8" } }))).toEqual({ reps: "5", load: "40", duration: "0.5", distance: "0.5" });
    expect(plannedRecordingValues(item({ fields: ["duration"], prescription: { reps: "5", loadKg: 40, durationMinutes: 0.5, targetRpe: "8" } }))).toEqual({ duration: "0.5" });
  });

  it.each(["8–12", "8-12", "AMRAP", "5 each side", "", "5.5"])("does not guess actual reps from %j", (reps) => {
    expect(plannedRecordingValues(item({ fields: ["reps", "rpe"], prescription: { reps, targetRpe: "8" } }))).toEqual({});
  });

  it("uses the selected individual set target without borrowing missing fields from the shared prescription", () => {
    const movement = item({ prescription: { reps: "5", loadKg: 40, entries: [{ reps: "3", loadKg: 50 }, { reps: "2" }] } });
    expect(plannedRecordingValues(movement, 0)).toEqual({ reps: "3", load: "50" });
    expect(plannedRecordingValues(movement, 1)).toEqual({ reps: "2" });
  });

  it("preserves explicit zero and canonical kilometres without treating them as missing", () => {
    expect(plannedRecordingValues(item({ fields: ["reps", "load", "duration", "distance"], prescription: { reps: "0", loadKg: 0, durationMinutes: 0, distance: 0, distanceUnit: "m" } }))).toEqual({ reps: "0", load: "0", duration: "0", distance: "0" });
    expect(plannedRecordingValues(item({ fields: ["distance"], prescription: { distance: 1.609344, distanceUnit: "km" } }))).toEqual({ distance: "1.609344" });
  });
});

describe("unrecorded entry counts", () => {
  it("counts missing time in repeated timed sets and treats explicit zero as recorded", () => {
    const planned = workout([item({ fields: ["duration"], prescription: { sets: 3, durationMinutes: 0.5 } })]);
    expect(unrecordedEntryCount(planned, { exercise: [{ ...blankSet(), duration: "0.5" }, { ...blankSet(), duration: "0" }, { ...blankSet(), duration: " " }] }, {})).toBe(1);
    expect(unrecordedEntryCount(planned, {}, {})).toBe(3);
  });

  it("uses individual prescribed row counts when the set log is missing", () => {
    const planned = workout([item({ fields: ["duration"], prescription: { entries: [{ durationMinutes: 0.5 }, { durationMinutes: 0.5 }, { durationMinutes: 0.5 }] } })]);
    expect(unrecordedEntryCount(planned, {}, {})).toBe(3);
    expect(unrecordedEntryCount(planned, { exercise: [] }, {})).toBe(3);
  });

  it("checks the primary measurement for single results, independently of optional metrics", () => {
    const timed = item({ id: "timed", mode: "result", fields: ["duration", "rpe"], prescription: { durationMinutes: 1 } });
    const distance = item({ id: "distance", mode: "result", fields: ["distance", "duration"], prescription: { distance: 1, distanceUnit: "km" } });
    const planned = workout([timed, distance]);
    expect(unrecordedEntryCount(planned, {}, {})).toBe(2);
    expect(unrecordedEntryCount(planned, {}, { timed: { rpe: "8" }, distance: { duration: "5" } })).toBe(2);
    expect(unrecordedEntryCount(planned, {}, { timed: { duration: "0" }, distance: { distance: "0" } })).toBe(0);
  });

  it("counts explicit interval round completions and missing prescribed rounds", () => {
    const planned = workout([item({ mode: "intervals", fields: ["rounds", "duration"], prescription: { rounds: 3, workSeconds: 30 } })]);
    expect(unrecordedEntryCount(planned, {}, {})).toBe(3);
    expect(unrecordedEntryCount(planned, {}, { exercise: { "round.0.completed": "1", "round.1.duration": "30", "round.2.completed": "" } })).toBe(2);
    expect(unrecordedEntryCount(planned, {}, { exercise: { "round.0.completed": "0" } })).toBe(3);
  });

  it("ignores instructions and retains zero reps without requiring optional weight or effort", () => {
    const planned = workout([item(), item({ id: "instructions", mode: "none", fields: [], prescription: {} })]);
    expect(unrecordedEntryCount(planned, { exercise: [{ ...blankSet(), reps: "0" }, { ...blankSet(), reps: "5" }] }, {})).toBe(0);
  });
});
