import { describe, expect, it } from "vitest";

import type { EntryMode, TrackingField } from "../../lib/domain";
import { LiftLogRepository } from "../../lib/repository";

function repositoryWithInsertRecorder() {
  let inserted: Record<string, unknown> | undefined;
  const client = {
    from(table: string) {
      expect(table).toBe("exercises");
      return {
        insert(payload: Record<string, unknown>) {
          inserted = payload;
          return {
            select() {
              return {
                async single() {
                  return {
                    data: {
                      id: "exercise-1",
                      discipline: null,
                      tags: [],
                      ...payload,
                    },
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    },
  };

  return {
    getInserted: () => inserted,
    repository: new LiftLogRepository(client as never, "athlete-1", "Athlete One"),
  };
}

describe("personal-exercise tracking defaults", () => {
  it.each<[EntryMode, TrackingField[]]>([
    ["sets", ["reps", "load", "rpe"]],
    ["result", ["duration", "distance", "rpe"]],
    ["intervals", ["rounds", "duration", "rpe"]],
    ["none", []],
  ])("maps %s mode to its persisted default fields", async (mode, expectedFields) => {
    const { getInserted, repository } = repositoryWithInsertRecorder();

    await repository.createPersonalExercise({
      name: "Custom movement",
      category: "Conditioning",
      cue: "Stay smooth",
      mode,
    });

    expect(getInserted()).toMatchObject({
      scope: "personal",
      owner_id: "athlete-1",
      name: "Custom movement",
      category: "Conditioning",
      cue: "Stay smooth",
      default_entry_mode: mode,
      default_tracking_fields: expectedFields,
    });
  });

  it("uses Custom when the supplied category is blank", async () => {
    const { getInserted, repository } = repositoryWithInsertRecorder();

    await repository.createPersonalExercise({
      name: "Custom movement",
      category: "",
      cue: "",
      mode: "none",
    });

    expect(getInserted()).toMatchObject({ category: "Custom" });
  });
});
