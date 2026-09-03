import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import ProgramView from "../../app/features/programs/ProgramView";
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
} = {}) {
  const onDuplicate = vi.fn();
  const onOpenRunWorkout = vi.fn();
  const onOpenActivity = vi.fn();
  const rendered = render(
    <ProgramView
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
    />,
  );
  return { ...rendered, onDuplicate, onOpenRunWorkout, onOpenActivity };
}

describe("ProgramView program-run presentation", () => {
  it("shows complete run status metadata without depending on agenda previews", async () => {
    const user = userEvent.setup();
    const { container, onOpenRunWorkout } = renderRun();

    const selector = screen.getByRole("combobox", { name: "Current workout" });
    expect(
      within(selector).getByRole("option", { name: /Strength A.*Scheduled.*45 min/ }),
    ).toBeVisible();
    expect(
      within(selector).getByRole("option", { name: /Strength B.*Not scheduled.*45 min/ }),
    ).toBeVisible();

    const rows = container.querySelectorAll(".workout-order-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Scheduled");
    expect(rows[1]).toHaveTextContent("Not scheduled");
    expect(
      within(screen.getByRole("region", { name: "Training plan progress" }))
        .getByText("Assigned plan"),
    ).toBeVisible();

    const status = screen.getByRole("region", { name: "Workout status" });
    expect(within(status).getByText("Workout 1 of 2")).toBeVisible();
    expect(within(status).getByText("Scheduled")).toBeVisible();
    await user.click(within(status).getByRole("button"));
    expect(onOpenRunWorkout).toHaveBeenCalledWith(runWorkouts[0]);
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

    const context = screen.getByRole("region", { name: "Training plan progress" });
    expect(within(context).getByText("Your training plan")).toBeVisible();
    expect(within(context).queryByText("Assigned plan")).not.toBeInTheDocument();
  });

  it("offers an exact-copy action for a readable immutable run", async () => {
    const user = userEvent.setup();
    const { onDuplicate } = renderRun();

    const duplicateActions = screen.getAllByRole("button", { name: "Duplicate" });
    expect(duplicateActions).toHaveLength(2);
    await user.click(duplicateActions[0]);
    expect(onDuplicate).toHaveBeenCalledOnce();
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
