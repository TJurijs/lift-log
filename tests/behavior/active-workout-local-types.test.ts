import { describe, expect, it } from "vitest";

import type { ActiveWorkoutDraftSnapshot } from "../../lib/active-workout-draft-storage";
import {
  ACTIVE_WORKOUT_LOCAL_SCHEMA_VERSION,
  activeWorkoutSnapshotsEqual,
  applyActiveWorkoutPatch,
  isActiveWorkoutDraftSnapshot,
  isActiveWorkoutLocalRecord,
  materializeActiveWorkoutEntry,
  type ActiveWorkoutLocalRecord,
} from "../../lib/active-workout-local-types";

const TIME = "2026-08-29T08:00:00.000Z";

function snapshot(): ActiveWorkoutDraftSnapshot {
  return {
    setLogs: { lift: [{ reps: "5", load: "40", rpe: "6" }] },
    resultLogs: { cardio: { duration: "10" } },
    sessionRpe: "6",
    sessionNote: "Base",
  };
}

function record(): ActiveWorkoutLocalRecord {
  return {
    schemaVersion: ACTIVE_WORKOUT_LOCAL_SCHEMA_VERSION,
    userId: "user-a",
    sessionId: "session-a",
    session: {
      id: "session-a",
      workoutId: "workout-a",
      programVersionId: "version-a",
    },
    confirmedRevision: 4,
    confirmedSnapshot: snapshot(),
    confirmedThroughSequence: 0,
    compactedSnapshot: snapshot(),
    compactedThroughSequence: 0,
    pendingMutation: null,
    revisionConflict: null,
    createdAt: TIME,
    updatedAt: TIME,
  };
}

describe("active workout patch journal", () => {
  it("applies granular set, result, and session changes immutably", () => {
    const original = snapshot();
    let current = applyActiveWorkoutPatch(original, {
      type: "set-set-field",
      itemId: "lift",
      index: 0,
      field: "load",
      value: "45",
    });
    expect(current).not.toBe(original);
    expect(current.setLogs).not.toBe(original.setLogs);
    expect(current.resultLogs).toBe(original.resultLogs);
    current = applyActiveWorkoutPatch(current, {
      type: "insert-set",
      itemId: "lift",
      index: 1,
      value: { reps: "4", load: "50", rpe: "7" },
    });
    current = applyActiveWorkoutPatch(current, {
      type: "set-result-field",
      itemId: "cardio",
      field: "distance",
      value: "3",
    });
    current = applyActiveWorkoutPatch(current, {
      type: "remove-result-field",
      itemId: "cardio",
      field: "duration",
    });
    current = applyActiveWorkoutPatch(current, {
      type: "set-session-note",
      value: "Offline note",
    });
    current = applyActiveWorkoutPatch(current, {
      type: "set-session-rpe",
      value: "8",
    });

    expect(original).toEqual(snapshot());
    expect(current).toEqual({
      setLogs: {
        lift: [
          { reps: "5", load: "45", rpe: "6" },
          { reps: "4", load: "50", rpe: "7" },
        ],
      },
      resultLogs: { cardio: { distance: "3" } },
      sessionRpe: "8",
      sessionNote: "Offline note",
    });
    expect(activeWorkoutSnapshotsEqual(current, structuredClone(current))).toBe(
      true,
    );
  });

  it("replays a contiguous journal and rejects missing sequences", () => {
    const baseRecord = record();
    const patches = [
      {
        sequence: 1,
        createdAt: TIME,
        change: { type: "set-session-rpe" as const, value: "7" },
      },
      {
        sequence: 2,
        createdAt: TIME,
        change: { type: "set-session-note" as const, value: "Reloaded" },
      },
    ];
    expect(materializeActiveWorkoutEntry({ record: baseRecord, journal: patches }))
      .toMatchObject({
        latestSequence: 2,
        snapshot: { sessionRpe: "7", sessionNote: "Reloaded" },
      });
    expect(() =>
      materializeActiveWorkoutEntry({
        record: baseRecord,
        journal: [patches[1]],
      }),
    ).toThrow("out of order");
  });

  it("rejects unsafe keys, invalid bounds, and untrusted record metadata", () => {
    expect(() =>
      applyActiveWorkoutPatch(snapshot(), {
        type: "set-result-field",
        itemId: "__proto__",
        field: "duration",
        value: "1",
      }),
    ).toThrow("invalid");
    expect(() =>
      applyActiveWorkoutPatch(snapshot(), {
        type: "set-session-rpe",
        value: "11",
      }),
    ).toThrow("1 to 10");
    expect(
      isActiveWorkoutDraftSnapshot({ ...snapshot(), unexpected: true }),
    ).toBe(false);
    expect(
      isActiveWorkoutLocalRecord({
        ...record(),
        pendingMutation: {
          idempotencyKey: "key",
          expectedRevision: "4",
        },
      }),
    ).toBe(false);
  });
});
