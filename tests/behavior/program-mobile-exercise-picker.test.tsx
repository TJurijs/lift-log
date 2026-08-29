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
    { id: "warmup", title: "Warm up", kind: "warmup", items: [] },
    { id: "main", title: "Main work", kind: "main", items: [] },
    { id: "cooldown", title: "Cooldown", kind: "cooldown", items: [] },
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
  publish: true,
  schedule: false,
  assign: false,
  provideInitialAssignmentDate: false,
  deleteOwn: true,
  archiveInstance: false,
};

describe("mobile program exercise picker", () => {
  it("opens for the tapped section and adds the selected exercise there", async () => {
    const user = userEvent.setup();
    const onAddExercise = vi.fn();
    const onSelectSection = vi.fn();

    const { container } = render(
      <ProgramView
        program={program}
        action={null}
        mutationPending={false}
        viewerId="viewer-1"
        capabilities={capabilities}
        currentWeek={program.weeks[0]}
        selectedWeek={1}
        selectedWorkout={workout}
        selectedSectionId="warmup"
        onSearchExercises={vi.fn().mockResolvedValue([exercise])}
        onSelectWeek={vi.fn()}
        onSelectWorkout={vi.fn()}
        onSelectSection={onSelectSection}
        onAddBlankWeek={vi.fn().mockResolvedValue(true)}
        onCopyWeek={vi.fn().mockResolvedValue(true)}
        onDeleteWeek={vi.fn()}
        onAddWorkout={vi.fn()}
        onDeleteWorkout={vi.fn()}
        onReorderWorkouts={vi.fn()}
        onAddSection={vi.fn()}
        onEditSection={vi.fn()}
        onDeleteSection={vi.fn()}
        onReorderSections={vi.fn()}
        onAddExercise={onAddExercise}
        onEditItem={vi.fn()}
        onRemoveItem={vi.fn()}
        onMoveItem={vi.fn()}
        onSave={vi.fn()}
        onCreateDraft={vi.fn()}
        onBack={vi.fn()}
        onEditWorkout={vi.fn()}
        renderWorkoutDetails={() => null}
        renderWorkoutItem={() => null}
      />,
    );

    fireEvent.click(container.querySelectorAll(".section-add-exercise")[1]);

    expect(
      screen.getByRole("dialog", { name: "Add to Main work" }),
    ).toBeVisible();
    expect(onSelectSection).toHaveBeenCalledWith("main");
    expect(document.body.style.overflow).toBe("hidden");

    const result = await screen.findByText("Back squat");
    await user.click(result.closest("button") as HTMLButtonElement);

    expect(onAddExercise).toHaveBeenCalledWith(exercise, "main");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
  });
});
