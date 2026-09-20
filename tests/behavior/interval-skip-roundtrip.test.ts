import { describe, expect, it } from "vitest";
import type { ActiveSession, ScheduledWorkout } from "../../lib/domain";
import type { ActiveWorkoutDraftSnapshot } from "../../lib/active-workout-draft-storage";
import { buildSessionDraftPayload, normalizeSessionDraftSnapshot } from "../../lib/repository";
import { completeDemoWorkout } from "../../app/features/active-workout/demo-workout";

const session: ActiveSession = {
  id: "active", workoutId: "workout", programVersionId: "version", draftRevision: 0,
  itemLogIds: { intervals: "interval-log" }, itemFields: { intervals: ["rounds", "duration", "distance", "heartRate", "rpe"] },
  setLogs: {}, resultLogs: {}, sessionRpe: "", sessionNote: "",
};
const snapshot: ActiveWorkoutDraftSnapshot = {
  setLogs: {}, sessionRpe: "", sessionNote: "", resultLogs: { intervals: {
    "round.0.completed": "1", "round.0.duration": "45", "round.0.distance": "0.1", "round.0.heartRate": "140", "round.0.rpe": "7",
    "round.1.completed": "0", "round.1.duration": "", "round.1.distance": "", "round.1.heartRate": "", "round.1.rpe": "",
    "round.2.completed": "", "round.2.duration": "", "round.2.distance": "", "round.2.heartRate": "", "round.2.rpe": "",
  } },
};

describe("interval Skip persistence", () => {
  it("persists done, skipped and unknown separately without restoring cleared measurements", () => {
    const entries = buildSessionDraftPayload(session, snapshot.setLogs, snapshot.resultLogs, "", "").items[0].entries;
    expect(entries.map((entry) => entry.rounds)).toEqual([1, 0, null]);
    expect(entries[1]).toMatchObject({ rounds: 0, durationSeconds: null, distanceMetres: null, heartRate: null, rpe: null });
    const confirmed = normalizeSessionDraftSnapshot(session, snapshot);
    expect(confirmed).toEqual(snapshot);
    expect(normalizeSessionDraftSnapshot(session, confirmed)).toEqual(snapshot);
  });

  it("keeps explicitly skipped rounds distinct from blank rounds in completed demo results", () => {
    const schedule: ScheduledWorkout = {
      id: "scheduled", programId: "program", programTitle: "Program", programVersionId: "version", workoutId: "workout",
      workoutTitle: "Intervals", slotLabel: "Day 1", sequenceNumber: 1, status: "in_progress",
      workout: { id: "workout", title: "Intervals", dayLabel: "Day 1", durationMinutes: 10, sections: [{ id: "section", title: "Exercises", items: [{
        id: "intervals", title: "Bike intervals", cue: "", mode: "intervals", fields: ["rounds", "duration", "distance", "heartRate", "rpe"], prescription: { rounds: 3, workSeconds: 45 },
      }] }] },
    };
    const entries = completeDemoWorkout(session, schedule, snapshot).items[0].entries;
    expect(entries.map((entry) => entry.rounds)).toEqual([1, 0, undefined]);
    expect(entries[1]).toMatchObject({ rounds: 0, durationMinutes: undefined, distanceKm: undefined, heartRate: undefined, rpe: undefined });
  });
});
