import { render, screen, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { describe, expect, it } from "vitest";
import { ProgramWorkoutPlanPreview } from "../../app/features/programs/ProgramWorkoutPlanPreview";
import type { PlannedWorkout, WorkoutItem } from "../../lib/domain";

function workoutWith(...items: WorkoutItem[]): PlannedWorkout {
  return {
    id: "workout-1",
    title: "Strength day",
    dayLabel: "Session 1",
    durationMinutes: 60,
    sections: [{ id: "items", title: "Exercises", items }],
  };
}

const uniformExercise: WorkoutItem = {
  id: "front-squat",
  exerciseId: "exercise-front-squat",
  title: "Front squat",
  category: "Strength",
  videoUrl: "https://www.youtube.com/watch?v=abc123",
  cue: "Stay tall through the drive.",
  mode: "sets",
  fields: ["reps", "load", "rpe"],
  prescription: {
    sets: 3,
    reps: "5",
    loadKg: 70,
    targetRpe: "8",
  },
};

describe("program workout plan preview", () => {
  it("shows uniform timed sets and rests using readable seconds", () => {
    render(<ProgramWorkoutPlanPreview workout={workoutWith({ ...uniformExercise, title: "Plank", mode: "sets", fields: ["duration"], prescription: { sets: 3, durationMinutes: 0.5, restSeconds: 20 } })} />);
    expect(screen.getByText("3 × 30 sec · 20s rest")).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText(/70 kg/)).not.toBeInTheDocument();
  });

  it("shows varied set times, distances and rests without losing zero targets", () => {
    render(<ProgramWorkoutPlanPreview workout={workoutWith({
      ...uniformExercise, title: "Timed carry", mode: "sets", fields: ["duration", "distance"],
      prescription: { entries: [
        { durationMinutes: 0, distance: 0, distanceUnit: "m", restSeconds: 0 },
        { durationMinutes: 0.5, distance: 0.25, distanceUnit: "km", restSeconds: 20 },
      ] },
    })} />);
    const table = screen.getByRole("table", { name: "Per-set plan for Timed carry" });
    for (const name of ["Time", "Distance", "Rest"]) expect(within(table).getByRole("columnheader", { name })).toBeVisible();
    expect(within(table).queryByRole("columnheader", { name: "Reps" })).not.toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: "Load (kg)" })).not.toBeInTheDocument();
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);
    for (const value of ["0 sec", "0 m", "0s"]) expect(within(rows[1]).getByText(value)).toBeVisible();
    for (const value of ["30 sec", "0.25 km", "20s"]) expect(within(rows[2]).getByText(value)).toBeVisible();
  });

  it("treats a changed distance unit as a varied per-set target", () => {
    render(<ProgramWorkoutPlanPreview workout={workoutWith({
      ...uniformExercise, title: "Walk", fields: ["distance"],
      prescription: { entries: [{ distance: 100, distanceUnit: "m" }, { distance: 100, distanceUnit: "km" }] },
    })} />);
    const table = screen.getByRole("table", { name: "Per-set plan for Walk" });
    expect(screen.getByText("2 sets · Per-set plan")).toBeVisible();
    expect(within(table).getByText("100 m")).toBeVisible();
    expect(within(table).getByText("100 km")).toBeVisible();
  });

  it("reads single-result targets from the stored entry, including zero rest", () => {
    render(<ProgramWorkoutPlanPreview workout={workoutWith({
      ...uniformExercise, title: "Carry", mode: "result", fields: ["duration", "distance", "load"],
      prescription: { entries: [{ durationMinutes: 0, distance: 0, distanceUnit: "m", loadKg: 0, restSeconds: 0 }] },
    })} />);
    expect(screen.getByText("0 sec · 0 m · 0 kg · 0s rest")).toBeVisible();
  });

  it("shows a compact uniform prescription without logging controls", () => {
    render(
      <ProgramWorkoutPlanPreview
        workout={workoutWith(uniformExercise)}
        weightUnit="kg"
      />,
    );

    expect(screen.getByRole("region", { name: "Strength day plan" })).toBeVisible();
    expect(screen.getByText("Strength exercise")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Watch Front squat video" })).toBeVisible();
    expect(screen.getByText("3 × 5 · 70 kg")).toBeVisible();
    expect(screen.getByText("Target")).toBeInTheDocument();
    expect(screen.getByText("Stay tall through the drive.")).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/Actual RPE/i)).not.toBeInTheDocument();
  });

  it("adds read-only set rows only when the prescription changes by set", () => {
    const variedExercise: WorkoutItem = {
      ...uniformExercise,
      id: "clean-pull",
      title: "Clean pull",
      prescription: {
        sets: 3,
        reps: "3",
        targetRpe: "8",
        entries: [
          { reps: "3", loadKg: 80, targetRpe: "7" },
          { reps: "3", loadKg: 90, targetRpe: "8" },
          { reps: "2", loadKg: 95, targetRpe: "9" },
        ],
      },
    };

    render(
      <ProgramWorkoutPlanPreview
        workout={workoutWith(variedExercise)}
        weightUnit="kg"
      />,
    );

    expect(screen.getByText("3 sets · Per-set plan")).toBeVisible();
    const table = screen.getByRole("table", { name: "Per-set plan for Clean pull" });
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByRole("columnheader", { name: "Load (kg)" })).toBeVisible();
    expect(within(table).getByRole("columnheader", { name: "RPE target" })).toBeVisible();
    expect(within(table).getByRole("rowheader", { name: "3" })).toBeVisible();
    expect(within(table).getByText("95")).toBeVisible();
    expect(within(table).getAllByText("Target")).toHaveLength(3);
    expect(within(table).queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/Actual RPE/i)).not.toBeInTheDocument();
  });

  it("keeps instructions and uniform intervals concise and accessible", async () => {
    const instructions: WorkoutItem = {
      id: "warmup",
      title: "Weightlifting warmup",
      category: "Mobility",
      cue: "Move through a comfortable range.",
      mode: "none",
      fields: [],
      prescription: {},
    };
    const intervals: WorkoutItem = {
      id: "bike",
      title: "Bike intervals",
      category: "Conditioning",
      cue: "Keep the cadence smooth.",
      mode: "intervals",
      fields: ["rounds", "duration", "rpe"],
      prescription: {
        rounds: 5,
        workSeconds: 40,
        restSeconds: 20,
        targetRpe: "7–8",
      },
    };

    const { container } = render(
      <ProgramWorkoutPlanPreview workout={workoutWith(instructions, intervals)} />,
    );

    expect(screen.getByText("Instructions only")).toBeVisible();
    expect(screen.getByText("5 rounds · 40s work · 20s rest")).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
