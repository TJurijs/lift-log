import { describe, expect, it, vi } from "vitest";

import { LiftLogRepository } from "../../lib/repository";

function exerciseRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `exercise-${String(index).padStart(5, "0")}`,
    scope: "global",
    owner_id: null,
    name: `Exercise ${String(index).padStart(5, "0")}`,
    category: "Strength",
    discipline: "gym",
    tags: [],
    source_provider: "catalyst-athletics",
    source_external_id: String(index),
    source_url: `https://www.catalystathletics.com/exercise/${index}/Exercise/`,
    video_url: `https://www.youtube.com/watch?v=${index}`,
    cue: "Move well",
    default_entry_mode: "sets",
    default_tracking_fields: ["reps"],
  }));
}

describe("repository keyset pagination", () => {
  it("keeps a 5,000-row exercise library bounded to the requested visible page", async () => {
    const rows = exerciseRows(5_000);
    const rpc = vi.fn(
      async (_name: string, arguments_: Record<string, unknown>) => {
        const afterId = arguments_.after_id as string | null;
        const start = afterId
          ? rows.findIndex((row) => row.id === afterId) + 1
          : 0;
        const pageLimit = arguments_.page_limit as number;
        return {
          data: rows.slice(start, start + pageLimit),
          error: null,
        };
      },
    );
    const from = vi.fn(() => {
      throw new Error("exercise search must not scan the table from the client");
    });
    const repository = new LiftLogRepository(
      { rpc, from } as never,
      "athlete-1",
      "Athlete One",
    );

    const first = await repository.searchExercises({ limit: 50 });
    const second = await repository.searchExercises({
      limit: 50,
      cursor: first.nextCursor,
    });

    expect(first.items).toHaveLength(50);
    expect(second.items).toHaveLength(50);
    expect(first.items[0]?.id).toBe("exercise-00000");
    expect(first.items[0]).toMatchObject({
      sourceProvider: "catalyst-athletics",
      sourceExternalId: "0",
      sourceUrl: "https://www.catalystathletics.com/exercise/0/Exercise/",
      videoUrl: "https://www.youtube.com/watch?v=0",
    });
    expect(second.items[0]?.id).toBe("exercise-00050");
    expect(first.hasMore).toBe(true);
    expect(second.hasMore).toBe(true);
    expect(rpc).toHaveBeenNthCalledWith(1, "search_exercises", {
      search_text: "",
      scope_filter: "all",
      discipline_filters: null,
      category_filters: null,
      mode_filters: null,
      tracking_filters: null,
      page_limit: 51,
      after_name: null,
      after_id: null,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "search_exercises", {
      search_text: "",
      scope_filter: "all",
      discipline_filters: null,
      category_filters: null,
      mode_filters: null,
      tracking_filters: null,
      page_limit: 51,
      after_name: "Exercise 00049",
      after_id: "exercise-00049",
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("never asks the bounded RPC for more than its 100-row server cap", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const repository = new LiftLogRepository(
      { rpc } as never,
      "athlete-1",
      "Athlete One",
    );

    await repository.searchExercises({ limit: 5_000 });

    expect(rpc).toHaveBeenCalledWith(
      "search_exercises",
      expect.objectContaining({ page_limit: 100 }),
    );
  });
});
