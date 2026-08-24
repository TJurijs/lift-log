import { describe, expect, it } from "vitest";

import type { WorkoutItem } from "../../lib/domain";
import { LiftLogRepository } from "../../lib/repository";

interface RpcCall {
  name: string;
  arguments: Record<string, unknown>;
}

function repositoryWithRpcRecorder() {
  const calls: RpcCall[] = [];
  const client = {
    async rpc(name: string, arguments_: Record<string, unknown>) {
      calls.push({ name, arguments: arguments_ });
      return { data: null, error: null };
    },
  };

  return {
    calls,
    repository: new LiftLogRepository(client as never, "athlete-1", "Athlete One"),
  };
}

describe("workout-item prescription persistence", () => {
  it("serializes per-set ranges and canonical metric quantities for the RPC", async () => {
    const { calls, repository } = repositoryWithRpcRecorder();
    const item: WorkoutItem = {
      id: "item-1",
      title: "Back squat",
      cue: "Controlled descent",
      mode: "sets",
      fields: ["reps", "load", "rpe"],
      prescription: {
        sets: 2,
        targetText: "Leave one clean rep",
        entries: [
          {
            reps: "5–7",
            loadKg: 100.25,
            targetRpe: "7-8",
          },
          {
            reps: "3",
            loadKg: 102.5,
            targetRpe: "9",
          },
          {
            reps: "1",
            loadKg: 110,
            targetRpe: "10",
          },
        ],
      },
    };

    await repository.updateWorkoutItemPrescription(item);

    expect(calls).toEqual([
      {
        name: "save_workout_item_prescription",
        arguments: {
          target_item_id: "item-1",
          target_cue: "Controlled descent",
          target_mode: "sets",
          target_fields: ["reps", "load", "rpe"],
          target_entries: [
            {
              reps_min: 5,
              reps_max: 7,
              load_kg: 100.25,
              duration_seconds: null,
              distance_metres: null,
              rounds: null,
              work_seconds: null,
              rest_seconds: null,
              target_rpe_min: 7,
              target_rpe_max: 8,
              target_text: "Leave one clean rep",
            },
            {
              reps_min: 3,
              reps_max: 3,
              load_kg: 102.5,
              duration_seconds: null,
              distance_metres: null,
              rounds: null,
              work_seconds: null,
              rest_seconds: null,
              target_rpe_min: 9,
              target_rpe_max: 9,
              target_text: "Leave one clean rep",
            },
          ],
        },
      },
    ]);
  });

  it("expands an interval-level prescription into one entry per round", async () => {
    const { calls, repository } = repositoryWithRpcRecorder();
    const item: WorkoutItem = {
      id: "item-interval",
      title: "Run intervals",
      cue: "Even pace",
      mode: "intervals",
      fields: ["rounds", "duration", "distance", "rpe"],
      prescription: {
        rounds: 2,
        durationMinutes: 0.5,
        distance: 0.4,
        distanceUnit: "km",
        workSeconds: 30,
        restSeconds: 15,
        targetRpe: "8",
      },
    };

    await repository.updateWorkoutItemPrescription(item);

    const expectedEntry = {
      reps_min: null,
      reps_max: null,
      load_kg: null,
      duration_seconds: 30,
      distance_metres: 400,
      rounds: 2,
      work_seconds: 30,
      rest_seconds: 15,
      target_rpe_min: 8,
      target_rpe_max: 8,
      target_text: null,
    };
    expect(calls[0]).toEqual({
      name: "save_workout_item_prescription",
      arguments: {
        target_item_id: "item-interval",
        target_cue: "Even pace",
        target_mode: "intervals",
        target_fields: ["rounds", "duration", "distance", "rpe"],
        target_entries: [expectedEntry, expectedEntry],
      },
    });
  });

  it("clears prescription entries when tracking mode is none", async () => {
    const { calls, repository } = repositoryWithRpcRecorder();
    const item: WorkoutItem = {
      id: "item-none",
      title: "Mobility flow",
      cue: "Move comfortably",
      mode: "none",
      fields: [],
      prescription: {
        sets: 3,
        entries: [{ reps: "10", loadKg: 20 }],
      },
    };

    await repository.updateWorkoutItemPrescription(item);

    expect(calls[0]).toEqual({
      name: "save_workout_item_prescription",
      arguments: {
        target_item_id: "item-none",
        target_cue: "Move comfortably",
        target_mode: "none",
        target_fields: [],
        target_entries: [],
      },
    });
  });
});
