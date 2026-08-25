import { describe, expect, it } from "vitest";

import {
  mergeActiveWorkoutDraftSnapshots,
} from "../../lib/active-workout-draft-merge";
import type { ActiveWorkoutDraftSnapshot } from "../../lib/active-workout-draft-storage";

function baseSnapshot(): ActiveWorkoutDraftSnapshot {
  return {
    setLogs: {
      lift: [{ reps: "5", load: "40", rpe: "6" }],
    },
    resultLogs: {
      cardio: { duration: "10", distance: "2" },
    },
    sessionRpe: "6",
    sessionNote: "Base note",
  };
}

function clone(snapshot: ActiveWorkoutDraftSnapshot): ActiveWorkoutDraftSnapshot {
  return structuredClone(snapshot);
}

describe("mergeActiveWorkoutDraftSnapshots", () => {
  it("combines non-overlapping local and remote changes", () => {
    const base = baseSnapshot();
    const local = clone(base);
    const remote = clone(base);
    local.resultLogs.cardio.duration = "12";
    remote.resultLogs.cardio.distance = "3";
    remote.resultLogs.rower = { rounds: "5" };

    expect(mergeActiveWorkoutDraftSnapshots(base, local, remote)).toEqual({
      snapshot: {
        ...base,
        resultLogs: {
          cardio: { duration: "12", distance: "3" },
          rower: { rounds: "5" },
        },
      },
      conflicts: [],
    });
  });

  it("records a same-field disagreement and keeps the local candidate", () => {
    const base = baseSnapshot();
    const local = clone(base);
    const remote = clone(base);
    local.setLogs.lift[0].load = "45";
    remote.setLogs.lift[0].load = "50";

    const result = mergeActiveWorkoutDraftSnapshots(base, local, remote);
    expect(result.snapshot.setLogs.lift[0].load).toBe("45");
    expect(result.conflicts).toEqual(["setLogs[lift][0][load]"]);
  });

  it("merges a local load with remote reps in the same set row", () => {
    const base = baseSnapshot();
    const local = clone(base);
    const remote = clone(base);
    local.setLogs.lift[0].load = "45";
    remote.setLogs.lift[0].reps = "6";

    const result = mergeActiveWorkoutDraftSnapshots(base, local, remote);
    expect(result.snapshot.setLogs.lift[0]).toEqual({
      reps: "6",
      load: "45",
      rpe: "6",
    });
    expect(result.conflicts).toEqual([]);
  });

  it("merges a one-sided session note and preserves the remote session RPE", () => {
    const base = baseSnapshot();
    const local = clone(base);
    const remote = clone(base);
    local.sessionNote = "Local training note";
    remote.sessionRpe = "8";

    const result = mergeActiveWorkoutDraftSnapshots(base, local, remote);
    expect(result.snapshot.sessionNote).toBe("Local training note");
    expect(result.snapshot.sessionRpe).toBe("8");
    expect(result.conflicts).toEqual([]);
  });

  it("accepts one-sided set additions and result-field removals", () => {
    const base = baseSnapshot();
    const local = clone(base);
    const remote = clone(base);
    local.setLogs.lift.push({ reps: "5", load: "45", rpe: "7" });
    delete remote.resultLogs.cardio.distance;

    const result = mergeActiveWorkoutDraftSnapshots(base, local, remote);
    expect(result.snapshot.setLogs.lift).toHaveLength(2);
    expect(result.snapshot.resultLogs.cardio).toEqual({ duration: "10" });
    expect(result.conflicts).toEqual([]);
  });

  it("accepts identical structural changes on both sides", () => {
    const base = baseSnapshot();
    const local = clone(base);
    const remote = clone(base);
    const added = { reps: "3", load: "50", rpe: "8" };
    local.setLogs.lift.push(added);
    remote.setLogs.lift.push({ ...added });

    const result = mergeActiveWorkoutDraftSnapshots(base, local, remote);
    expect(result.snapshot.setLogs.lift).toEqual(local.setLogs.lift);
    expect(result.conflicts).toEqual([]);
  });

  it("flags an item-level conflict when row structure and content both change", () => {
    const base = baseSnapshot();
    const local = clone(base);
    const remote = clone(base);
    local.setLogs.lift.push({ reps: "5", load: "45", rpe: "7" });
    remote.setLogs.lift[0].reps = "6";
    remote.resultLogs.cardio.distance = "4";

    const result = mergeActiveWorkoutDraftSnapshots(base, local, remote);
    expect(result.snapshot.setLogs.lift).toEqual(local.setLogs.lift);
    expect(result.snapshot.resultLogs.cardio.distance).toBe("4");
    expect(result.conflicts).toEqual(["setLogs[lift]"]);
  });
});
