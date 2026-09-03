import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import ProgramRunScheduleWizard from "../../app/features/program-runs/ProgramRunScheduleWizard";
import type { ProgramRunDetail } from "../../lib/domain";
import { localDateOnly } from "../../lib/date-only";

const detail: ProgramRunDetail = {
  id: "run-1",
  athleteId: "athlete-1",
  createdById: "coach-1",
  programId: "program-1",
  programVersionId: "version-1",
  title: "Four-workout plan",
  status: "in_progress",
  totalWorkouts: 4,
  scheduledWorkouts: 1,
  completedWorkouts: 1,
  completionPercent: 25,
  createdAt: "2026-09-01T09:00:00Z",
  workouts: [
    {
      id: "slot-completed",
      runId: "run-1",
      workoutId: "workout-completed",
      title: "Completed workout",
      position: 0,
      estimatedMinutes: 60,
      status: "completed",
      prescriptionOverrides: {},
    },
    {
      id: "slot-unscheduled",
      runId: "run-1",
      workoutId: "workout-unscheduled",
      title: "Unscheduled workout",
      position: 1,
      estimatedMinutes: 60,
      status: "unscheduled",
      prescriptionOverrides: {},
    },
    {
      id: "slot-scheduled",
      runId: "run-1",
      workoutId: "workout-scheduled",
      title: "Scheduled workout",
      position: 2,
      estimatedMinutes: 45,
      plannedDate: "2026-09-12",
      status: "scheduled",
      scheduledWorkoutId: "schedule-1",
      prescriptionOverrides: {},
    },
    {
      id: "slot-skipped",
      runId: "run-1",
      workoutId: "workout-skipped",
      title: "Skipped workout",
      position: 3,
      estimatedMinutes: 30,
      status: "skipped",
      prescriptionOverrides: {},
    },
  ],
};

function renderWizard(onSave = vi.fn().mockResolvedValue(undefined)) {
  const onLoad = vi.fn().mockResolvedValue(detail);
  render(
    <ProgramRunScheduleWizard
      run={detail}
      athleteName="Athlete One"
      onLoad={onLoad}
      onClose={vi.fn()}
      onSave={onSave}
    />,
  );
  return { onLoad, onSave };
}

describe("ProgramRunScheduleWizard", () => {
  it("uses a one-date flow for a single workout", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const quickWorkout: ProgramRunDetail = {
      ...detail,
      id: "quick-run",
      title: "Quick strength",
      contentType: "quick_workout",
      status: "not_started",
      totalWorkouts: 1,
      scheduledWorkouts: 0,
      completedWorkouts: 0,
      completionPercent: 0,
      workouts: [{
        id: "quick-slot",
        runId: "quick-run",
        workoutId: "quick-workout",
        title: "Quick strength",
        position: 0,
        estimatedMinutes: 45,
        status: "unscheduled",
        prescriptionOverrides: {},
      }],
    };

    render(
      <ProgramRunScheduleWizard
        run={quickWorkout}
        athleteName="Elina"
        onLoad={vi.fn().mockResolvedValue(quickWorkout)}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    expect(await screen.findByText("Scheduling for Elina.")).toBeVisible();
    expect(screen.queryByText("Generate a schedule")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to calendar" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /Today/ }));
    await user.click(screen.getByRole("button", { name: "Add to calendar" }));
    expect(onSave).toHaveBeenCalledWith(
      [{ workoutId: "quick-workout", plannedDate: localDateOnly(new Date()) }],
      expect.any(String),
    );
  });

  it("keeps manual training-day choices synchronized with frequency", async () => {
    const user = userEvent.setup();
    renderWizard();
    const frequency = await screen.findByLabelText("Sessions per week");
    const trainingDays = screen
      .getAllByRole("button")
      .filter((button) => button.hasAttribute("aria-pressed"));
    expect(frequency).toHaveValue("2");
    expect(
      trainingDays.filter((button) => button.getAttribute("aria-pressed") === "true"),
    ).toHaveLength(2);

    const firstSelected = trainingDays.find(
      (button) => button.getAttribute("aria-pressed") === "true",
    );
    expect(firstSelected).toBeDefined();
    await user.click(firstSelected!);
    expect(frequency).toHaveValue("1");

    const finalSelected = trainingDays.find(
      (button) => button.getAttribute("aria-pressed") === "true",
    );
    expect(finalSelected).toBeDefined();
    await user.click(finalSelected!);
    expect(frequency).toHaveValue("1");
  });

  it("edits every future slot in one save while preserving finished history", async () => {
    const user = userEvent.setup();
    const { onLoad, onSave } = renderWizard();

    const unscheduledDate = await screen.findByLabelText("Date for Unscheduled workout");
    const scheduledDate = screen.getByLabelText("Date for Scheduled workout");
    expect(unscheduledDate).toHaveValue("");
    expect(scheduledDate).toHaveValue("2026-09-12");
    expect(screen.getByText("1 of 2 dated")).toBeVisible();
    expect(screen.getByText("1 needs a date")).toBeVisible();
    expect(screen.queryByLabelText("Date for Completed workout")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Date for Skipped workout")).not.toBeInTheDocument();

    fireEvent.change(unscheduledDate, { target: { value: "2026-09-14" } });
    fireEvent.change(scheduledDate, { target: { value: "" } });
    await user.click(screen.getByRole("button", { name: "Save all dates" }));

    expect(onLoad).toHaveBeenCalledWith("run-1");
    expect(onSave).toHaveBeenCalledWith(
      [
        { workoutId: "workout-unscheduled", plannedDate: "2026-09-14" },
        { workoutId: "workout-scheduled", plannedDate: undefined },
      ],
      expect.any(String),
    );
  });

  it("does not crash if frequency changes while the start date is temporarily blank", async () => {
    renderWizard();
    const startDate = await screen.findByLabelText("Start date");
    fireEvent.change(startDate, { target: { value: "" } });

    expect(() =>
      fireEvent.change(screen.getByLabelText("Sessions per week"), {
        target: { value: "1" },
      }),
    ).not.toThrow();
    expect(screen.getByRole("button", { name: "Generate dates" })).toBeDisabled();
  });

  it("generates only empty dates and preserves dates already on the calendar", async () => {
    const user = userEvent.setup();
    renderWizard();
    const unscheduledDate = await screen.findByLabelText("Date for Unscheduled workout");
    const scheduledDate = screen.getByLabelText("Date for Scheduled workout");

    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2026-09-07" },
    });
    await user.click(screen.getByRole("button", { name: "Generate dates" }));

    expect(unscheduledDate).toHaveValue("2026-09-07");
    expect(scheduledDate).toHaveValue("2026-09-12");
    expect(screen.getByText("2 of 2 dated")).toBeVisible();
    expect(screen.getByText("All dated")).toBeVisible();
  });

  it("blocks dates that put a later workout before an earlier workout", async () => {
    const user = userEvent.setup();
    const { onSave } = renderWizard();
    const unscheduledDate = await screen.findByLabelText("Date for Unscheduled workout");

    fireEvent.change(unscheduledDate, { target: { value: "2026-09-14" } });
    await user.click(screen.getByRole("button", { name: "Save all dates" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Scheduled workout is dated before Unscheduled workout/),
    ).toBeVisible();
  });

  it("validates editable dates against fixed dates from the complete run", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const detailWithFixedDate: ProgramRunDetail = {
      ...detail,
      workouts: detail.workouts.map((workout) =>
        workout.id === "slot-completed"
          ? { ...workout, plannedDate: "2026-09-10" }
          : workout,
      ),
    };
    render(
      <ProgramRunScheduleWizard
        run={detailWithFixedDate}
        athleteName="Athlete One"
        onLoad={vi.fn().mockResolvedValue(detailWithFixedDate)}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.change(
      await screen.findByLabelText("Date for Unscheduled workout"),
      { target: { value: "2026-09-09" } },
    );
    await user.click(screen.getByRole("button", { name: "Save all dates" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Unscheduled workout is dated before Completed workout/),
    ).toBeVisible();
  });
});
