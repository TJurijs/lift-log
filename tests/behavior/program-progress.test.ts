import { describe, expect, it } from "vitest";

import {
  deriveProgramRunStatus,
  deriveProgramWorkoutProgressState,
  deriveSingleWorkoutStatus,
  nextIncompleteRunWorkoutId,
  programRunLifecycleLabel,
  programRunStatusLabel,
  type ProgramRunStatus,
  type ProgramWorkoutProgressState,
} from "../../lib/program-progress";

describe("program progress", () => {
  it("opens the first incomplete workout by run position", () => {
    const base = {
      runId: "run-1",
      title: "Workout",
      estimatedMinutes: 45,
      prescriptionOverrides: {},
    };
    expect(
      nextIncompleteRunWorkoutId([
        { ...base, id: "slot-3", workoutId: "workout-3", position: 2, status: "scheduled" },
        { ...base, id: "slot-1", workoutId: "workout-1", position: 0, status: "completed" },
        { ...base, id: "slot-2", workoutId: "workout-2", position: 1, status: "unscheduled" },
      ]),
    ).toBe("workout-2");
  });

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
    [true, [], "editable"],
    [false, ["unscheduled", "unscheduled"], "locked"],
    [false, ["skipped", "unscheduled"], "locked"],
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
      "editable",
      "locked",
      "scheduled",
      "in_progress",
      "needs_attention",
      "completed",
    ];
    expect(
      statuses.map(programRunStatusLabel),
    ).toEqual([
      "Editable",
      "Locked",
      "Scheduled",
      "In progress",
      "Needs attention",
      "Completed",
    ]);
  });

  it("does not describe a terminal run with skipped workouts as completed", () => {
    expect(
      programRunLifecycleLabel({
        status: "completed",
        totalWorkouts: 3,
        completedWorkouts: 2,
      }),
    ).toBe("Closed");
    expect(
      programRunLifecycleLabel({
        status: "completed",
        totalWorkouts: 3,
        completedWorkouts: 3,
      }),
    ).toBe("Completed");
    expect(
      programRunLifecycleLabel({
        status: "ended",
        totalWorkouts: 3,
        completedWorkouts: 1,
      }),
    ).toBe("Ended");
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

  it("returns reusable workouts to Locked while retaining completion context", () => {
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
      status: "locked",
      upcomingCount: 0,
      lastCompletedDate: "2026-08-20",
    });
  });
});
