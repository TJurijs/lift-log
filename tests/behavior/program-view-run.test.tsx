import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import ProgramView, { type ProgramViewProps } from "../../app/features/programs/ProgramView";
import type { TrainingContentCapabilities } from "../../lib/capabilities";
import type {
  PlannedWorkout,
  Program,
  ProgramRunSummary,
  ProgramRunWorkout,
} from "../../lib/domain";

const workouts: PlannedWorkout[] = ["Strength A", "Strength B"].map(
  (title, index) => ({
    id: `workout-${index + 1}`,
    programVersionId: "version-1",
    title,
    dayLabel: `Session ${index + 1}`,
    durationMinutes: 45,
    sections: [
      {
        id: `section-${index + 1}`,
        title: "Exercises",
        kind: "main",
        items: [],
      },
    ],
  }),
);

const program: Program = {
  id: "program-1",
  athleteId: "athlete-1",
  versionId: "version-1",
  versionStatus: "published",
  title: "Coach strength",
  description: "An immutable assigned plan.",
  phase: "Plan",
  activeWeek: 1,
  weeks: [{ id: "week-1", index: 1, label: "Week 1", workouts }],
  ownerName: "Athlete",
  createdById: "coach-1",
  createdByName: "Coach",
  sourceType: "coach",
  sourceLabel: "Assigned by coach",
  contentType: "program",
  programRunId: "run-1",
};

const run: ProgramRunSummary = {
  id: "run-1",
  athleteId: "athlete-1",
  createdById: "coach-1",
  programId: "program-1",
  programVersionId: "version-1",
  title: "Coach strength",
  contentType: "program",
  status: "in_progress",
  totalWorkouts: 2,
  scheduledWorkouts: 1,
  completedWorkouts: 0,
  completionPercent: 0,
  createdAt: "2026-09-01T09:00:00Z",
};

const runWorkouts: ProgramRunWorkout[] = [
  {
    id: "slot-1",
    runId: "run-1",
    workoutId: "workout-1",
    title: "Strength A",
    position: 0,
    estimatedMinutes: 45,
    plannedDate: "2026-09-04",
    status: "scheduled",
    scheduledWorkoutId: "schedule-1",
    prescriptionOverrides: {},
  },
  {
    id: "slot-2",
    runId: "run-1",
    workoutId: "workout-2",
    title: "Strength B",
    position: 1,
    estimatedMinutes: 45,
    status: "unscheduled",
    prescriptionOverrides: {},
  },
];

const capabilities: TrainingContentCapabilities = {
  view: true,
  copyToOwn: true,
  edit: false,
  save: false,
  schedule: false,
  assign: false,
  provideInitialAssignmentDate: false,
  deleteOwn: false,
  archiveInstance: true,
};

function renderRun(options: {
  completedActivity?: boolean;
  backLabel?: string;
  program?: Program;
  run?: ProgramRunSummary;
  viewerId?: string;
  props?: Partial<ProgramViewProps>;
} = {}) {
  const onDuplicate = vi.fn();
  const onOpenRunWorkout = vi.fn();
  const onOpenActivity = vi.fn();
  const rendered = render(
    <ProgramView
        metadata={{ title: program.title, description: program.description, status: "saved", error: "" }}
        onMetadataChange={vi.fn()}
      program={options.program ?? program}
      programRun={options.run ?? run}
      action={null}
      mutationPending={false}
      viewerId={options.viewerId ?? "athlete-1"}
      capabilities={capabilities}
      workouts={workouts}
      selectedWorkout={workouts[0]}
      runWorkouts={runWorkouts}
      workoutActivity={options.completedActivity ? [{
        id: "session:session-1",
        programRunId: "run-1",
        programRunWorkoutId: "slot-1",
        kind: "completed",
        status: "completed",
        programId: "program-1",
        programVersionId: "version-1",
        programTitle: "Coach strength",
        workoutId: "workout-1",
        workoutTitle: "Strength A",
        date: "2026-09-04",
        rpe: 8,
        sessionId: "session-1",
      }] : []}
      onOpenRunWorkout={onOpenRunWorkout}
      onOpenActivity={onOpenActivity}
      onSearchExercises={vi.fn().mockResolvedValue([])}
      onSelectWorkout={vi.fn()}
      onAddWorkout={vi.fn()}
      onDeleteWorkout={vi.fn()}
      onReorderWorkouts={vi.fn()}
      onAddExercise={vi.fn()}
      onEditItem={vi.fn()}
      onRemoveItem={vi.fn()}
      onReorderItems={vi.fn()}
      onSave={vi.fn()}
      onDuplicate={onDuplicate}
      onBack={vi.fn()}
      backLabel={options.backLabel}
      onEditWorkout={vi.fn()}
      renderWorkoutItem={() => null}
      {...options.props}
    />,
  );
  return { ...rendered, onDuplicate, onOpenRunWorkout, onOpenActivity };
}

describe("ProgramView program-run presentation", () => {
  it.each([false, true])("separates editing from training actions when editing is %s", async (editing) => {
    const user = userEvent.setup();
    const onSave = vi.fn(), onEdit = vi.fn(), onStart = vi.fn();
    renderRun({ props: {
      editing, programRun: undefined, program: { ...program, versionStatus: "draft" },
      capabilities: { ...capabilities, edit: true, save: true, assign: true },
      onEdit, onStart, onSetDates: vi.fn(), onAssignProgram: vi.fn(), onEndProgram: vi.fn(), onSave,
    } });

    if (editing) {
      expect(screen.getByRole("textbox", { name: "Program name" })).toBeVisible();
      for (const name of ["Start workout", "Set dates", "Edit", "Repeat", "Assign to athletes"]) {
        expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
      }
      expect(screen.queryByLabelText(`More actions for ${program.title}`)).not.toBeInTheDocument();
      const editDetails = screen.getByRole("button", { name: `Edit details for ${workouts[0].title}` });
      expect(editDetails).not.toHaveTextContent("Edit details");
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(onSave).toHaveBeenCalledWith(program.title, program.description);
    } else {
      expect(screen.queryByRole("textbox", { name: "Program name" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Add exercise" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Add workout" })).not.toBeInTheDocument();
      for (const name of ["Start workout", "Set dates", "Repeat", "Assign to athletes"]) {
        expect(screen.getByRole("button", { name })).toBeVisible();
      }
      await user.click(screen.getByRole("button", { name: "Edit" }));
      expect(onEdit).toHaveBeenCalledOnce();
      await user.click(screen.getByRole("button", { name: "Start workout" }));
      expect(onStart).toHaveBeenCalledOnce();
    }
  });

  it("retries the retained metadata draft while keeping Save available", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const draft = { title: "Updated plan", description: "Retained description", status: "error" as const, error: "Connection unavailable" };
    renderRun({ props: {
      program: { ...program, versionStatus: "draft" }, programRun: undefined,
      capabilities: { ...capabilities, edit: true, save: true }, metadata: draft, onSave,
    } });

    expect(screen.getByRole("status")).toHaveTextContent("Couldn't save");
    expect(screen.getByRole("textbox", { name: "Program name" })).toHaveValue(draft.title);
    expect(screen.getByRole("textbox", { name: /Description/ })).toHaveValue(draft.description);
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    await user.click(within(screen.getByRole("alert")).getByRole("button", { name: "Try again" }));

    expect(onSave).toHaveBeenCalledWith(draft.title, draft.description);
    expect(screen.getByRole("textbox", { name: "Program name" })).toHaveValue(draft.title);
  });

  it("shows complete run status metadata without depending on agenda previews", async () => {
    const user = userEvent.setup();
    const { container, onOpenRunWorkout } = renderRun();

    expect(screen.queryByRole("combobox", { name: "Current workout" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Strength A.*Scheduled.*45 min/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Strength B.*No date.*45 min/ })).toHaveAttribute("aria-pressed", "false");

    const rows = container.querySelectorAll(".workout-order-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Scheduled");
    expect(rows[1]).toHaveTextContent("No date");
    expect(
      within(screen.getByRole("region", { name: "Training progress" }))
        .getByText("Assigned program"),
    ).toBeVisible();

    const status = screen.getByRole("region", { name: "Workout status" });
    expect(within(status).getByText("Workout 1 of 2")).toBeVisible();
    expect(within(status).getByText("Scheduled")).toBeVisible();
    await user.click(within(status).getByRole("button"));
    expect(onOpenRunWorkout).toHaveBeenCalledWith(runWorkouts[0]);
  });

  it("does not let a coach open an athlete's scheduled workout for recording", async () => {
    const user = userEvent.setup();
    const { onOpenRunWorkout } = renderRun({ viewerId: "coach-1" });
    const status = screen.getByRole("region", { name: "Workout status" });
    const action = within(status).getByRole("button");
    expect(action).toBeDisabled();
    await user.click(action);
    expect(onOpenRunWorkout).not.toHaveBeenCalled();
  });

  it("keeps an unscheduled workout's status informational", () => {
    renderRun({ props: { selectedWorkout: workouts[1] } });
    const status = screen.getByRole("region", { name: "Workout status" });
    expect(within(status).getByRole("button")).toBeDisabled();
  });

  it("starts the selected undated workout directly without opening a date picker", async () => {
    const user = userEvent.setup();
    const onStartRunWorkout = vi.fn(), onSetDates = vi.fn();
    renderRun({ props: { selectedWorkout: workouts[1], onStartRunWorkout, onSetDates } });
    await user.click(screen.getByRole("button", { name: "Start workout" }));
    expect(onStartRunWorkout).toHaveBeenCalledWith(runWorkouts[1]);
    expect(onSetDates).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Change dates" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /^(Plan program|Schedule)$/ })).not.toBeInTheDocument();
  });

  it("does not let a coach start their athlete's selected workout", () => {
    renderRun({ viewerId: "coach-1", props: { onStartRunWorkout: vi.fn() } });
    expect(screen.queryByRole("button", { name: "Start workout" })).not.toBeInTheDocument();
  });

  it("keeps a completed slot read-only and opens its exact result without an agenda preview", async () => {
    const user = userEvent.setup();
    const completed = { ...runWorkouts[0], status: "completed" as const, sessionId: "session-result" };
    const onOpenRunWorkoutResults = vi.fn();
    renderRun({ props: { runWorkouts: [completed, runWorkouts[1]], onStartRunWorkout: vi.fn(), onOpenRunWorkoutResults } });
    expect(screen.queryByRole("button", { name: "Start workout" })).not.toBeInTheDocument();
    await user.click(within(screen.getByRole("region", { name: "Workout status" })).getByRole("button"));
    expect(onOpenRunWorkoutResults).toHaveBeenCalledWith(completed);
  });

  it("uses Resume workout for the selected in-progress slot", async () => {
    const user = userEvent.setup();
    const current = { ...runWorkouts[0], status: "in_progress" as const };
    const onStartRunWorkout = vi.fn();
    renderRun({ props: { runWorkouts: [current, runWorkouts[1]], onStartRunWorkout } });
    await user.click(screen.getByRole("button", { name: "Resume workout" }));
    expect(onStartRunWorkout).toHaveBeenCalledWith(current);
  });

  it("labels an athlete's self-started run as their training plan", () => {
    const selfStartedRun: ProgramRunSummary = {
      ...run,
      createdById: run.athleteId,
    };
    const selfProgram: Program = {
      ...program,
      createdById: program.athleteId,
      sourceType: "self",
      sourceLabel: "Created by you",
    };

    renderRun({ program: selfProgram, run: selfStartedRun });

    const context = screen.getByRole("region", { name: "Training progress" });
    expect(within(context).getByText("Your program")).toBeVisible();
    expect(within(context).queryByText("Assigned program")).not.toBeInTheDocument();
  });

  it("repeats an existing program through one fresh-copy action", async () => {
    const user = userEvent.setup();
    const { onDuplicate } = renderRun();

    const duplicateActions = screen.getAllByRole("button", { name: "Repeat" });
    expect(duplicateActions).toHaveLength(1);
    await user.click(duplicateActions[0]);
    expect(onDuplicate).toHaveBeenCalledOnce();
    expect(screen.queryByText(/Template|Saved version/)).not.toBeInTheDocument();
  });

  it("edits only the selected upcoming workout when its permission is granted", async () => {
    const user = userEvent.setup();
    const onEditRunWorkout = vi.fn();
    const slot = { ...runWorkouts[0], canEdit: true };
    const rendered = renderRun({ props: { onEditRunWorkout, runWorkouts: [slot, runWorkouts[1]] } });
    await user.click(screen.getByRole("button", { name: "Edit Strength A" }));
    expect(onEditRunWorkout).toHaveBeenCalledWith(slot);
    rendered.unmount();

    renderRun({ props: { onEditRunWorkout, runWorkouts: [{ ...slot, canEdit: false }, runWorkouts[1]] } });
    expect(screen.queryByRole("button", { name: "Edit Strength A" })).not.toBeInTheDocument();
  });

  it("keeps status and edit actions attached to a customized workout", async () => {
    const user = userEvent.setup();
    const onEditRunWorkout = vi.fn();
    const effectiveWorkout = { ...workouts[0], id: "edited-workout" };
    const slot = { ...runWorkouts[0], effectiveWorkoutId: effectiveWorkout.id, canEdit: true };
    renderRun({ props: { onEditRunWorkout, workouts: [effectiveWorkout, workouts[1]], selectedWorkout: effectiveWorkout,
      runWorkouts: [slot, runWorkouts[1]] } });

    expect(within(screen.getByRole("region", { name: "Workout status" })).getByText("Scheduled")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Edit Strength A" }));
    expect(onEditRunWorkout).toHaveBeenCalledWith(slot);
  });

  it("uses the launch-surface label and opens an exact completed result", async () => {
    const user = userEvent.setup();
    const { onOpenActivity, onOpenRunWorkout } = renderRun({
      completedActivity: true,
      backLabel: "Programs",
    });

    expect(screen.getAllByRole("button", { name: /Programs/i })[0]).toBeVisible();
    const status = screen.getByRole("region", { name: "Workout status" });
    expect(within(status).getByText("RPE 8")).toBeVisible();
    await user.click(within(status).getByRole("button"));
    expect(onOpenActivity).toHaveBeenCalledOnce();
    expect(onOpenRunWorkout).not.toHaveBeenCalled();
  });
});
