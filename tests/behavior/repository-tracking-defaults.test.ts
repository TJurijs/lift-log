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

function repositoryWithUpdateRecorder() {
  let updated: Record<string, unknown> | undefined;
  const builder = {
    update(payload: Record<string, unknown>) {
      updated = payload;
      return builder;
    },
    eq() {
      return builder;
    },
    select() {
      return {
        async maybeSingle() {
          return {
            data: {
              id: "exercise-1",
              scope: "personal",
              owner_id: "athlete-1",
              discipline: null,
              tags: [],
              ...updated,
            },
            error: null,
          };
        },
      };
    },
  };
  const client = {
    from(table: string) {
      expect(table).toBe("exercises");
      return builder;
    },
  };
  return {
    getUpdated: () => updated,
    repository: new LiftLogRepository(client as never, "athlete-1", "Athlete One"),
  };
}

function repositoryWithDeleteRecorder(result = { count: 1, error: null }) {
  let deleteOptions: Record<string, unknown> | undefined;
  const filters: Array<[string, unknown]> = [];
  const builder = {
    delete(options?: Record<string, unknown>) {
      deleteOptions = options;
      return builder;
    },
    eq(column: string, value: unknown) {
      filters.push([column, value]);
      return builder;
    },
    then(resolve: (value: typeof result) => unknown) {
      return Promise.resolve(result).then(resolve);
    },
  };
  const client = {
    from(table: string) {
      expect(table).toBe("exercises");
      return builder;
    },
  };
  return {
    filters,
    getDeleteOptions: () => deleteOptions,
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

  it("preserves the provided exercise taxonomy when it is copied to My exercises", async () => {
    const { getInserted, repository } = repositoryWithInsertRecorder();

    await repository.createPersonalExercise({
      name: "Power clean",
      category: "Weightlifting",
      discipline: "weightlifting",
      tags: ["Clean", "Power"],
      cue: "Stay close.",
      mode: "sets",
    });

    expect(getInserted()).toMatchObject({
      scope: "personal",
      discipline: "weightlifting",
      tags: ["Clean", "Power"],
    });
  });

  it.each<[EntryMode, TrackingField[], TrackingField[]]>([
    ["sets", ["reps", "rpe"], ["reps", "rpe"]],
    ["result", ["distance", "load", "rpe"], ["distance", "load", "rpe"]],
    [
      "intervals",
      ["rounds", "duration", "distance", "rpe"],
      ["rounds", "duration", "distance", "rpe"],
    ],
  ])(
    "preserves the compatible %s tracking variant",
    async (mode, fields, expectedFields) => {
      const { getInserted, repository } = repositoryWithInsertRecorder();

      await repository.createPersonalExercise({
        name: "Copied movement",
        category: "Conditioning",
        cue: "Stay smooth",
        mode,
        fields,
      });

      expect(getInserted()).toMatchObject({
        default_entry_mode: mode,
        default_tracking_fields: expectedFields,
      });
    },
  );

  it("filters incompatible requested fields and falls back when none remain", async () => {
    const first = repositoryWithInsertRecorder();
    await first.repository.createPersonalExercise({
      name: "Loaded carry",
      category: "Strength",
      cue: "Walk tall",
      mode: "result",
      fields: ["reps", "load", "rpe", "load"],
    });
    expect(first.getInserted()).toMatchObject({
      default_tracking_fields: ["load", "rpe"],
    });

    const second = repositoryWithInsertRecorder();
    await second.repository.createPersonalExercise({
      name: "Fallback result",
      category: "General",
      cue: "",
      mode: "result",
      fields: ["reps", "rounds"],
    });
    expect(second.getInserted()).toMatchObject({
      default_tracking_fields: ["duration", "distance", "rpe"],
    });
  });

  it("updates only the supplied personal exercise defaults", async () => {
    const { getUpdated, repository } = repositoryWithUpdateRecorder();

    await repository.updatePersonalExercise("exercise-1", {
      name: "Paused back squat",
      category: "Strength",
      cue: "Keep the brace.",
      mode: "sets",
    });

    expect(getUpdated()).toMatchObject({
      name: "Paused back squat",
      category: "Strength",
      cue: "Keep the brace.",
      default_entry_mode: "sets",
      default_tracking_fields: ["reps", "load", "rpe"],
    });
  });

  it("preserves a supplied compatible tracking variant while updating", async () => {
    const { getUpdated, repository } = repositoryWithUpdateRecorder();

    await repository.updatePersonalExercise("exercise-1", {
      name: "Farmer carry",
      category: "Strength",
      cue: "Walk tall",
      mode: "result",
      fields: ["distance", "load", "rpe"],
    });

    expect(getUpdated()).toMatchObject({
      default_entry_mode: "result",
      default_tracking_fields: ["distance", "load", "rpe"],
    });
  });

  it("deletes only the selected owned personal exercise", async () => {
    const { filters, getDeleteOptions, repository } =
      repositoryWithDeleteRecorder();

    await repository.deletePersonalExercise("exercise-1");

    expect(getDeleteOptions()).toEqual({ count: "exact" });
    expect(filters).toEqual([
      ["id", "exercise-1"],
      ["scope", "personal"],
      ["owner_id", "athlete-1"],
    ]);
  });

  it("rejects a delete when no owned personal exercise matched", async () => {
    const { repository } = repositoryWithDeleteRecorder({
      count: 0,
      error: null,
    });

    await expect(repository.deletePersonalExercise("exercise-1")).rejects.toThrow(
      "it no longer exists or is not owned by this account",
    );
  });
});
