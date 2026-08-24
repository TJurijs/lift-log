import { describe, expect, it } from "vitest";

import { LiftLogRepository } from "../../lib/repository";

function exerciseRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `exercise-${String(index).padStart(5, "0")}`,
    scope: "global" as const,
    owner_id: null,
    name: `Exercise ${index}`,
    category: "Strength",
    discipline: "gym" as const,
    tags: [],
    cue: "Move well",
    default_entry_mode: "sets" as const,
    default_tracking_fields: ["reps" as const],
  }));
}

function exerciseClient(count: number) {
  const rows = exerciseRows(count);
  const ranges: Array<[number, number]> = [];
  return {
    ranges,
    client: {
      from(table: string) {
        expect(table).toBe("exercises");
        const query = {
          select() {
            return query;
          },
          is() {
            return query;
          },
          order() {
            return query;
          },
          range(from: number, to: number) {
            ranges.push([from, to]);
            return Promise.resolve({
              data: rows.slice(from, to + 1),
              error: null,
            });
          },
        };
        return query;
      },
    },
  };
}

describe("repository pagination", () => {
  it.each([999, 1_000, 1_001, 5_000])(
    "loads all %s exercises without accepting a max-rows truncation",
    async (count) => {
      const { client, ranges } = exerciseClient(count);
      const repository = new LiftLogRepository(
        client as never,
        "athlete-1",
        "Athlete One",
      );

      const exercises = await repository.listExercises();

      expect(exercises).toHaveLength(count);
      expect(exercises.at(-1)?.id).toBe(
        `exercise-${String(count - 1).padStart(5, "0")}`,
      );
      expect(ranges.at(0)).toEqual([0, 499]);
      expect(ranges.every(([from, to]) => to - from + 1 === 500)).toBe(true);
      if (count >= 1_000) expect(ranges.length).toBeGreaterThan(2);
    },
  );
});
