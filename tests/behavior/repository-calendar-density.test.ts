import { describe, expect, it, vi } from "vitest";
import { LiftLogRepository } from "../../lib/repository";

describe("dense calendar viewports", () => {
  it("loads all 250 occurrences and completions through bounded cursor pages", async () => {
    const occurrences = Array.from({ length: 250 }, (_, index) => ({
      id: `schedule-${String(index).padStart(3, "0")}`,
      program_id: "program-1", program_version_id: "version-1", program_title: "Plan",
      workout_id: "workout-1", workout_title: "Workout", planned_date: "2026-09-04",
      sequence_number: index + 1, status: "completed",
    }));
    const sessions = occurrences.map((occurrence, index) => ({
      id: `session-${String(index).padStart(3, "0")}`,
      scheduled_workout_id: occurrence.id, program_version_id: "version-1",
      workout_id: "workout-1", workout_title: "Workout",
      started_at: "2026-09-04T10:00:00Z", completed_at: "2026-09-04T11:00:00Z",
      completed_for_date: "2026-09-04", session_rpe: 7,
    }));
    const rpc = vi.fn(async (name: string, arguments_: Record<string, unknown>) => {
      const rows = name === "list_calendar_occurrences" ? occurrences : sessions;
      const cursorId = arguments_.after_id;
      const offset = cursorId ? rows.findIndex((row) => row.id === cursorId) + 1 : 0;
      return { data: rows.slice(offset, offset + Number(arguments_.page_limit)), error: null };
    });
    const repository = new LiftLogRepository({ rpc } as never, "athlete-1", "Athlete");

    const result = await repository.loadCalendarRange("2026-09-01", "2026-09-30");

    expect(result.scheduledWorkouts).toHaveLength(250);
    expect(result.completedSessions).toHaveLength(250);
    expect(new Set(result.scheduledWorkouts.map((row) => row.id)).size).toBe(250);
    expect(new Set(result.completedSessions.map((row) => row.id)).size).toBe(250);
    expect(rpc).toHaveBeenCalledTimes(6);
    expect(rpc).toHaveBeenCalledWith("list_calendar_session_summaries", {
      range_start: "2026-09-01", range_end: "2026-09-30", page_limit: 100,
      after_completed_for_date: "2026-09-04", after_id: "session-099",
    });
    expect(rpc.mock.calls.every(([, args]) => Number(args.page_limit) <= 101)).toBe(true);
  });

  it("reports a later calendar page error instead of displaying an incomplete month", async () => {
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === "list_calendar_occurrences") return { data: [], error: null };
      if (args.after_id) return { data: null, error: { message: "offline" } };
      return {
        data: Array.from({ length: 100 }, (_, id) => ({ id: String(id), completed_for_date: "2026-09-04" })),
        error: null,
      };
    });
    const repository = new LiftLogRepository({ rpc } as never, "athlete-1", "Athlete");
    await expect(repository.loadCalendarRange("2026-09-01", "2026-09-30"))
      .rejects.toThrow("Could not load completed workouts for your calendar: offline");
  });
});
