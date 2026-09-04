import { describe, expect, it, vi } from "vitest";
import { LiftLogRepository } from "../../lib/repository";

function completedDetailSource(failSecondPage = false) {
  const items = Array.from({ length: 12 }, (_, position) => ({
    id: `item-${String(position).padStart(2, "0")}`,
    workout_session_id: "session-1",
    source_workout_item_id: null,
    snapshot_name: `Exercise ${position + 1}`,
    snapshot_category: "Strength",
    snapshot_video_url: null,
    snapshot_cue: "",
    entry_mode: "sets",
    tracking_fields: ["reps", "load"],
    position,
  }));
  const entries = items.flatMap((item) => Array.from({ length: 100 }, (_, position) => ({
    id: `${item.id}-entry-${position}`,
    session_item_log_id: item.id,
    position,
    reps: 5,
    load_kg: "100",
    duration_seconds: null,
    distance_metres: null,
    rounds: null,
    heart_rate: null,
    rpe: null,
  })));
  const ranges: Array<{ table: string; from: number; to: number }> = [];
  const filters: Array<{ table: string; column: string; value: unknown }> = [];
  const from = vi.fn((table: string) => {
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => {
        filters.push({ table, column, value });
        return query;
      },
      in: () => query,
      order: () => query,
      maybeSingle: async () => ({
        data: {
          id: "session-1",
          program_version_id: "version-1",
          workout_id: "workout-1",
          workout_title: "Complete history",
          started_at: "2026-09-04T10:00:00Z",
          completed_at: "2026-09-04T11:00:00Z",
          completed_for_date: "2026-09-04",
          session_rpe: 7,
        },
        error: null,
      }),
      range: async (start: number, end: number) => {
        ranges.push({ table, from: start, to: end });
        if (failSecondPage && table === "session_entries" && start > 0) {
          return { data: null, error: { message: "connection lost" } };
        }
        const rows = table === "session_item_logs" ? items : entries;
        return { data: rows.slice(start, end + 1), error: null };
      },
    };
    return query;
  });
  const rpc = vi.fn().mockResolvedValue({
    data: {
      sessionNote: "Private session note",
      itemNotes: {},
      entryNotes: { "item-11-entry-99": "Last entry note" },
    },
    error: null,
  });
  return {
    repository: new LiftLogRepository({ from, rpc } as never, "athlete-1", "Athlete"),
    ranges,
    filters,
  };
}

describe("completed workout detail", () => {
  it("loads every result beyond the API row cap with bounded pages", async () => {
    const { repository, ranges, filters } = completedDetailSource();
    const detail = await repository.loadCompletedSessionDetail("session-1");

    expect(detail?.items).toHaveLength(12);
    expect(detail?.items.every((item) => item.entries.length === 100)).toBe(true);
    expect(detail?.items.at(-1)?.entries.at(-1)).toMatchObject({
      position: 99,
      reps: 5,
      loadKg: 100,
      note: "Last entry note",
    });
    expect(ranges.filter((range) => range.table === "session_entries")).toEqual([
      { table: "session_entries", from: 0, to: 499 },
      { table: "session_entries", from: 500, to: 999 },
      { table: "session_entries", from: 1000, to: 1499 },
    ]);
    expect(filters).toContainEqual({
      table: "workout_sessions", column: "athlete_id", value: "athlete-1",
    });
    expect(filters).toContainEqual({
      table: "workout_sessions", column: "status", value: "completed",
    });
  });

  it("does not present truncated history as a successful load after a page failure", async () => {
    const { repository } = completedDetailSource(true);
    await expect(repository.loadCompletedSessionDetail("session-1"))
      .rejects.toThrow("Could not load completed workout entries: connection lost");
  });
});
