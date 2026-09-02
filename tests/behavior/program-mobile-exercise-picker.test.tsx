import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ProgramView from "../../app/features/programs/ProgramView";
import type { TrainingContentCapabilities } from "../../lib/capabilities";
import type { Exercise, PlannedWorkout, Program } from "../../lib/domain";

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
        renderWorkoutDetails={() => null}
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

});
