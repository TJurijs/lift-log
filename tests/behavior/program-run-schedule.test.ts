import { describe, expect, it } from "vitest";
import {
  generateProgramRunDates,
  programRunDateOrderError,
  suggestProgramTrainingDays,
} from "../../lib/program-run-schedule";

describe("program run scheduling", () => {
  it("generates every workout in sequence across selected weekdays", () => {
    expect(
      generateProgramRunDates(
        ["snatch", "jerk", "balanced", "snatch-2"],
        "2026-09-07",
        [1, 3, 5],
      ),
    ).toEqual([
      { workoutId: "snatch", plannedDate: "2026-09-07" },
      { workoutId: "jerk", plannedDate: "2026-09-09" },
      { workoutId: "balanced", plannedDate: "2026-09-11" },
      { workoutId: "snatch-2", plannedDate: "2026-09-14" },
    ]);
  });

  it("rotates the suggested rhythm to include the selected start date", () => {
    expect(suggestProgramTrainingDays("2026-09-08", 3)).toEqual([2, 4, 6]);
  });

  it("requires at least one training day", () => {
    expect(() =>
      generateProgramRunDates(["workout"], "2026-09-07", []),
    ).toThrow("Choose at least one training day");
  });

  it("rejects dated workouts that reverse the program sequence", () => {
    expect(
      programRunDateOrderError([
        { title: "Snatch", plannedDate: "2026-09-09" },
        { title: "Jerk", plannedDate: "2026-09-07" },
      ]),
    ).toBe(
      "Jerk is dated before Snatch. Workout dates must follow the program order.",
    );
    expect(
      programRunDateOrderError([
        { title: "Snatch", plannedDate: "2026-09-07" },
        { title: "Jerk" },
        { title: "Balanced", plannedDate: "2026-09-09" },
      ]),
    ).toBe("");
  });
});
