import { describe, expect, it } from "vitest";

import {
  deriveProgramRunStatus,
  deriveProgramWorkoutProgressState,
  deriveSingleWorkoutStatus,
  programRunStatusLabel,
  type ProgramRunStatus,
  type ProgramWorkoutProgressState,
} from "../../lib/program-progress";

describe("program progress", () => {
  it.each([
    [undefined, "unscheduled"],
    [{ status: "planned", plannedDate: undefined }, "unscheduled"],
    [{ status: "skipped", plannedDate: "2026-08-24" }, "skipped"],
    [{ status: "completed", plannedDate: "2026-08-24" }, "completed"],
    [{ status: "planned", plannedDate: "2026-08-24" }, "overdue"],
    [{ status: "planned", plannedDate: "2026-08-25" }, "due"],
    [{ status: "planned", plannedDate: "2026-08-26" }, "scheduled"],
  ] as const)("classifies %j as %s", (schedule, expected) => {
    expect(deriveProgramWorkoutProgressState(schedule, "2026-08-25")).toBe(
      expected,
    );
  });

  it.each([
    [true, [], "draft"],
    [false, ["unscheduled", "unscheduled"], "ready"],
    [false, ["skipped", "unscheduled"], "ready"],
    [false, ["scheduled", "unscheduled"], "scheduled"],
    [false, ["due", "unscheduled"], "scheduled"],
    [false, ["completed", "scheduled"], "in_progress"],
    [false, ["completed", "overdue"], "needs_attention"],
    [false, ["completed", "completed"], "completed"],
  ] as Array<[boolean, ProgramWorkoutProgressState[], string]>)(
    "derives draft=%s, states=%j as %s",
    (draft, states, expected) => {
      expect(deriveProgramRunStatus(draft, states)).toBe(expected);
    },
  );

  it("uses the approved user-facing status labels", () => {
    const statuses: ProgramRunStatus[] = [
      "draft",
      "ready",
      "scheduled",
      "in_progress",
      "needs_attention",
      "completed",
    ];
    expect(
      statuses.map(programRunStatusLabel),
    ).toEqual([
      "Draft",
      "Ready",
      "Scheduled",
      "In progress",
      "Needs attention",
      "Completed",
    ]);
  });

  it("prioritizes active, overdue, and upcoming single-workout occurrences", () => {
    expect(
      deriveSingleWorkoutStatus(
        false,
        [
          { status: "planned", plannedDate: "2026-08-24" },
          { status: "in_progress", plannedDate: "2026-08-25" },
        ],
        "2026-08-25",
      ),
    ).toMatchObject({ status: "in_progress", nextDate: "2026-08-25" });

    expect(
      deriveSingleWorkoutStatus(
        false,
        [{ status: "planned", plannedDate: "2026-08-24" }],
        "2026-08-25",
      ),
    ).toMatchObject({
      status: "needs_attention",
      overdueDate: "2026-08-24",
    });

    expect(
      deriveSingleWorkoutStatus(
        false,
        [
          { status: "planned", plannedDate: "2026-08-28" },
          { status: "planned", plannedDate: "2026-08-26" },
        ],
        "2026-08-25",
      ),
    ).toMatchObject({
      status: "scheduled",
      upcomingCount: 2,
      nextDate: "2026-08-26",
    });
  });

  it("returns reusable workouts to Ready while retaining completion context", () => {
    expect(
      deriveSingleWorkoutStatus(
        false,
        [
          { status: "completed", plannedDate: "2026-08-20" },
          { status: "skipped", plannedDate: "2026-08-21" },
        ],
        "2026-08-25",
      ),
    ).toEqual({
      status: "ready",
      upcomingCount: 0,
      lastCompletedDate: "2026-08-20",
    });
  });
});
