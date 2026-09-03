import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ProgramView from "../../app/features/programs/ProgramView";
import type { TrainingContentCapabilities } from "../../lib/capabilities";
import type {
  Exercise,
  PlannedWorkout,
  Program,
  WorkoutItem,
} from "../../lib/domain";

const workout: PlannedWorkout = {
  id: "workout-1",
  programVersionId: "version-1",
  title: "Mobile workout",
  dayLabel: "Day 1",
  durationMinutes: 45,
  sections: [
    { id: "exercises", title: "Exercises", kind: "main", items: [] },
  ],
};

const program: Program = {
  id: "program-1",
  athleteId: "viewer-1",
  versionId: "version-1",
  versionStatus: "draft",
  title: "Mobile program",
  description: "",
  phase: "Build",
  activeWeek: 1,
  weeks: [{ id: "week-1", index: 1, label: "Week 1", workouts: [workout] }],
  ownerName: "Viewer",
  createdById: "viewer-1",
  createdByName: "Viewer",
  sourceType: "self",
  sourceLabel: "Own",
  contentType: "program",
};

const exercise: Exercise = {
  id: "back-squat",
  name: "Back squat",
  category: "Strength",
  discipline: "gym",
  cue: "Brace and stand tall.",
  scope: "global",
  defaultMode: "sets",
  defaultFields: ["reps", "load", "rpe"],
};

const workoutItems: WorkoutItem[] = [
  {
    id: "squat-item",
    title: "Back squat",
    cue: "Brace and stand tall.",
    mode: "sets",
    fields: ["reps", "load", "rpe"],
    prescription: { sets: 3, reps: "5" },
  },
  {
    id: "row-item",
    title: "Barbell row",
    cue: "Pull toward the ribs.",
    mode: "sets",
    fields: ["reps", "load"],
    prescription: { sets: 3, reps: "8" },
  },
];

const capabilities: TrainingContentCapabilities = {
  view: true,
  copyToOwn: false,
  edit: true,
  save: true,
  schedule: false,
  assign: false,
  provideInitialAssignmentDate: false,
  deleteOwn: true,
  archiveInstance: false,
};

describe("mobile program exercise picker", () => {
  it("opens one workout-wide picker and adds the selected exercise", async () => {
    const user = userEvent.setup();
    const onAddExercise = vi.fn();

    render(
      <ProgramView
        program={program}
        action={null}
        mutationPending={false}
        viewerId="viewer-1"
        capabilities={capabilities}
        workouts={[workout]}
        selectedWorkout={workout}
        onSearchExercises={vi.fn().mockResolvedValue([exercise])}
        onSelectWorkout={vi.fn()}
        onAddWorkout={vi.fn()}
        onDeleteWorkout={vi.fn()}
        onReorderWorkouts={vi.fn()}
        onAddExercise={onAddExercise}
        onEditItem={vi.fn()}
        onRemoveItem={vi.fn()}
        onReorderItems={vi.fn()}
        onSave={vi.fn()}
        onBack={vi.fn()}
        onEditWorkout={vi.fn()}
        renderWorkoutItem={() => null}
      />,
    );

    expect(screen.getAllByRole("button", { name: "Add exercise" })).toHaveLength(1);
    expect(screen.queryByText("Week 1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add exercise" }));

    expect(
      screen.getByRole("dialog", { name: "Add exercise" }),
    ).toBeVisible();
    expect(document.body.style.overflow).toBe("hidden");

    const result = await screen.findByText("Back squat");
    expect(screen.getByLabelText("Strength exercise")).toBeVisible();
    await user.click(result.closest("button") as HTMLButtonElement);

    expect(onAddExercise).toHaveBeenCalledWith(exercise);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
  });

  it("offers one compact native workout selector for a long program", async () => {
    const user = userEvent.setup();
    const onSelectWorkout = vi.fn();
    const workouts = Array.from({ length: 40 }, (_, index): PlannedWorkout => ({
      ...workout,
      id: `workout-${index + 1}`,
      title: `Workout ${index + 1}`,
    }));
    const longProgram: Program = {
      ...program,
      weeks: [{ ...program.weeks[0], workouts }],
    };

    const { container } = render(
      <ProgramView
        program={longProgram}
        action={null}
        mutationPending={false}
        viewerId="viewer-1"
        capabilities={capabilities}
        workouts={workouts}
        selectedWorkout={workouts[0]}
        onSearchExercises={vi.fn().mockResolvedValue([])}
        onSelectWorkout={onSelectWorkout}
        onAddWorkout={vi.fn()}
        onDeleteWorkout={vi.fn()}
        onReorderWorkouts={vi.fn()}
        onAddExercise={vi.fn()}
        onEditItem={vi.fn()}
        onRemoveItem={vi.fn()}
        onReorderItems={vi.fn()}
        onSave={vi.fn()}
        onBack={vi.fn()}
        onEditWorkout={vi.fn()}
        renderWorkoutItem={() => null}
      />,
    );

    const selector = screen.getByRole("combobox", { name: "Current workout" });
    expect(selector).toHaveValue("workout-1");
    expect(screen.getAllByRole("option")).toHaveLength(40);
    await user.selectOptions(selector, "workout-40");
    expect(onSelectWorkout).toHaveBeenCalledWith("workout-40");

    const workoutList = container.querySelector(".workout-list");
    expect(workoutList).not.toHaveClass("mobile-reorder-open");
    await user.click(screen.getAllByRole("button", { name: "Reorder" })[0]);
    expect(workoutList).toHaveClass("mobile-reorder-open");
  });

  it("reorders workouts and exercises with accessible move controls", async () => {
    const user = userEvent.setup();
    const onReorderWorkouts = vi.fn();
    const onReorderItems = vi.fn();
    const firstWorkout: PlannedWorkout = {
      ...workout,
      title: "First workout",
      sections: [{ ...workout.sections[0], items: workoutItems }],
    };
    const secondWorkout: PlannedWorkout = {
      ...workout,
      id: "workout-2",
      title: "Second workout",
    };

    render(
      <ProgramView
        program={program}
        action={null}
        mutationPending={false}
        viewerId="viewer-1"
        capabilities={capabilities}
        workouts={[firstWorkout, secondWorkout]}
        selectedWorkout={firstWorkout}
        onSearchExercises={vi.fn().mockResolvedValue([])}
        onSelectWorkout={vi.fn()}
        onAddWorkout={vi.fn()}
        onDeleteWorkout={vi.fn()}
        onReorderWorkouts={onReorderWorkouts}
        onAddExercise={vi.fn()}
        onEditItem={vi.fn()}
        onRemoveItem={vi.fn()}
        onReorderItems={onReorderItems}
        onSave={vi.fn()}
        onBack={vi.fn()}
        onEditWorkout={vi.fn()}
        renderWorkoutItem={(item) => <span>{item.title}</span>}
      />,
    );

    await user.click(screen.getAllByRole("button", { name: "Reorder" })[0]);
    expect(
      screen.getByRole("button", { name: "Move First workout up" }),
    ).toBeDisabled();
    await user.click(
      screen.getByRole("button", { name: "Move First workout down" }),
    );
    expect(onReorderWorkouts).toHaveBeenCalledWith([
      "workout-2",
      "workout-1",
    ]);

    await user.click(screen.getByRole("button", { name: "Reorder" }));
    expect(
      screen.getByRole("button", { name: "Move Back squat up" }),
    ).toBeDisabled();
    const moveExerciseDown = screen.getByRole("button", {
      name: "Move Back squat down",
    });
    moveExerciseDown.focus();
    await user.keyboard("{Enter}");
    expect(onReorderItems).toHaveBeenCalledWith(["row-item", "squat-item"]);
  });

});
