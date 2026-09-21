import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import AssignTrainingDialog, { type AssignTrainingDialogProps } from "../../app/features/program-runs/AssignTrainingDialog";
import { initialProgram } from "../../lib/demo-data";
import type { AthleteSummary, PlannedWorkout, Program, ProgramRunSummary } from "../../lib/domain";

const workouts: PlannedWorkout[] = ["Snatch", "Jerk"].map((title, index) => ({
  id: `workout-${index + 1}`, title, dayLabel: title, programVersionId: "version", durationMinutes: 45,
  sections: [{ id: `section-${index}`, title: "Exercises", kind: "main", items: [] }],
}));
const program: Program = { ...initialProgram, id: "program", title: "Balanced program", contentType: "program",
  weeks: [{ id: "sequence", index: 1, label: "Workouts", workouts }] };
const quickWorkout: Program = { ...program, id: "quick", contentType: "quick_workout", title: "Quick workout",
  weeks: [{ ...program.weeks[0], workouts: [workouts[0]] }] };
const athletes: AthleteSummary[] = [
  { id: "athlete-1", name: "Athlete One", initials: "AO", programRuns: [], agenda: [] },
  { id: "athlete-2", name: "Athlete Two", initials: "AT", programRuns: [], agenda: [] },
];
const run: ProgramRunSummary = {
  id: "run-1", athleteId: program.athleteId, createdById: program.athleteId,
  programId: program.id, programVersionId: program.versionId, title: "Edited balanced program",
  contentType: "program", status: "in_progress", totalWorkouts: 2, completedWorkouts: 0,
  scheduledWorkouts: 1, completionPercent: 0, createdAt: "2026-09-20T12:00:00Z",
  nextWorkout: { id: "run-workout-1", title: "Adjusted snatch", plannedDate: "2026-09-23", status: "scheduled" },
};
const effectiveProgram: Program = { ...program, title: run.title, id: "private-editor",
  weeks: [{ ...program.weeks[0], workouts: workouts.map((workout, index) => ({ ...workout,
    id: `effective-workout-${index}`, title: `Adjusted ${workout.title.toLowerCase()}` })) }] };

function renderDialog(overrides: Partial<AssignTrainingDialogProps> = {}) {
  const onAssign = vi.fn().mockResolvedValue(undefined);
  render(<AssignTrainingDialog programs={[program]} athletes={athletes} initialProgramId={program.id}
    initialAthleteIds={[athletes[0].id]} onLoadProgram={vi.fn().mockResolvedValue(program)}
    onClose={vi.fn()} onAssign={onAssign} {...overrides} />);
  return { onAssign };
}

describe("AssignTrainingDialog", () => {
  it("selects concrete training and submits its edited workout IDs instead of the hidden source", async () => {
    const user = userEvent.setup();
    const onLoadRun = vi.fn().mockResolvedValue(effectiveProgram);
    const onLoadProgram = vi.fn();
    const { onAssign } = renderDialog({ initialProgramId: undefined, runs: [run], onLoadRun, onLoadProgram,
      programs: [program, { ...program, id: "old-source", hasOwnRuns: true, title: "Old source" },
        { ...program, id: "editor", editableRunId: run.id, title: "Private editor" }] });
    expect(screen.queryByText("Balanced program")).not.toBeInTheDocument();
    expect(screen.queryByText(/Old source|Private editor/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Edited balanced program/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Next: Adjusted snatch")).toBeVisible();
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Adjusted snatch")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Assign program" }));
    expect(onLoadProgram).not.toHaveBeenCalled();
    expect(onLoadRun).toHaveBeenCalledWith(run);
    expect(onAssign).toHaveBeenCalledWith(expect.objectContaining({ programId: program.id, runId: run.id,
      workoutDates: [{ workoutId: "effective-workout-0" }, { workoutId: "effective-workout-1" }] }));
  });

  it("keeps independently edited copies distinct when stale detail requests finish later", async () => {
    const user = userEvent.setup();
    const otherRun = { ...run, id: "run-2", title: "Second copy" };
    const otherProgram = { ...effectiveProgram, title: otherRun.title,
      weeks: [{ ...program.weeks[0], workouts: [{ ...workouts[0], id: "second-copy-workout", title: "Second copy snatch" }] }] };
    let resolveFirst!: (value: Program) => void;
    let resolveSecond!: (value: Program) => void;
    const onLoadRun = vi.fn((selectedRun: ProgramRunSummary) => new Promise<Program>((resolve) => {
      if (selectedRun.id === run.id) resolveFirst = resolve;
      else resolveSecond = resolve;
    }));
    const { onAssign } = renderDialog({ initialProgramId: undefined, runs: [run, otherRun], onLoadRun });
    await user.click(screen.getByRole("button", { name: /Second copy/ }));
    await act(async () => { resolveSecond(otherProgram); });
    await act(async () => { resolveFirst(effectiveProgram); });
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Second copy snatch")).toBeVisible();
    expect(screen.queryByText("Adjusted jerk")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Assign program" }));
    expect(onAssign).toHaveBeenCalledWith(expect.objectContaining({ runId: otherRun.id,
      workoutDates: [{ workoutId: "second-copy-workout" }] }));
  });

  it("retries unavailable run details without silently assigning its original source", async () => {
    const user = userEvent.setup();
    const onLoadRun = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(effectiveProgram);
    const { onAssign } = renderDialog({ initialProgramId: undefined, initialRunId: run.id, runs: [run], onLoadRun });
    expect(await screen.findByRole("alert")).toHaveTextContent("This training could not be loaded");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(onAssign).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Adjusted snatch")).toBeVisible();
    expect(onLoadRun).toHaveBeenCalledTimes(2);
  });

  it("does not retain a hidden source preselection after it becomes concrete training", () => {
    renderDialog({ programs: [{ ...program, hasOwnRuns: true }] });
    expect(screen.getByRole("alert")).toHaveTextContent("This training is no longer available");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("can load later source and run pages when the loaded sources are hidden or no results match", async () => {
    const user = userEvent.setup();
    const onLoadMorePrograms = vi.fn();
    const onLoadMoreRuns = vi.fn();
    renderDialog({ initialProgramId: undefined, programs: [{ ...program, hasOwnRuns: true }],
      hasMorePrograms: true, hasMoreRuns: true, onLoadMorePrograms, onLoadMoreRuns });
    expect(screen.getByText("More training is available")).toBeVisible();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "Search training" }), "jerk");
    expect(screen.getByText("No matching training")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Load more training" }));
    expect(onLoadMorePrograms).toHaveBeenCalledOnce();
    expect(onLoadMoreRuns).toHaveBeenCalledOnce();
  });

  it("defaults to no dates and reviews the independent assignment before saving", async () => {
    const user = userEvent.setup();
    const { onAssign } = renderDialog();
    expect(screen.getByRole("radio", { name: /No dates/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByLabelText("Start date")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Assign program" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("2 workouts for Athlete One")).toBeVisible();
    expect(onAssign).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Assign program" }));
    expect(onAssign).toHaveBeenCalledWith({ programId: program.id, athleteIds: [athletes[0].id],
      workoutDates: workouts.map((workout) => ({ workoutId: workout.id })), idempotencyKey: expect.any(String) });
  });

  it("assigns generated dates to each selected athlete without a separate scheduling action", async () => {
    const user = userEvent.setup();
    const { onAssign } = renderDialog({ initialAthleteIds: [] });
    await user.click(screen.getByRole("button", { name: /Athlete One/ }));
    await user.click(screen.getByRole("button", { name: /Athlete Two/ }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("radio", { name: /Set dates/ }));
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-09-07" } });
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Assign program" }));
    expect(onAssign).toHaveBeenCalledWith(expect.objectContaining({ athleteIds: ["athlete-1", "athlete-2"],
      workoutDates: [{ workoutId: "workout-1", plannedDate: "2026-09-07" }, { workoutId: "workout-2", plannedDate: "2026-09-10" }] }));
  });

  it("keeps a cleared review date optional and preserves other workout dates", async () => {
    const user = userEvent.setup();
    const { onAssign } = renderDialog();
    await user.click(screen.getByRole("radio", { name: /Set dates/ }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByLabelText("Date for Snatch"), { target: { value: "" } });
    expect(screen.getByLabelText("Date for Snatch")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Assign program" }));
    expect(onAssign).toHaveBeenCalledWith(expect.objectContaining({ workoutDates: [
      { workoutId: "workout-1", plannedDate: undefined }, { workoutId: "workout-2", plannedDate: expect.any(String) },
    ] }));
  });

  it("keeps frequency and selected training days synchronized", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("radio", { name: /Set dates/ }));
    const frequency = screen.getByLabelText("Sessions per week");
    const selected = () => screen.getAllByRole("button").filter((button) => button.getAttribute("aria-pressed") === "true");
    expect(frequency).toHaveValue("2");
    expect(selected()).toHaveLength(2);
    await user.click(selected()[0]);
    expect(frequency).toHaveValue("1");
    await user.click(selected()[0]);
    expect(selected()).toHaveLength(1);
  });

  it("requires a valid optional date before continuing with a standalone assignment", async () => {
    const user = userEvent.setup();
    const { onAssign } = renderDialog({ programs: [quickWorkout], initialProgramId: quickWorkout.id });
    await user.click(screen.getByRole("radio", { name: /Set dates/ }));
    expect(screen.queryByLabelText("Sessions per week")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Workout date"), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Workout date"), { target: { value: "2026-09-23" } });
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(onAssign).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Assign workout" }));
    expect(onAssign).toHaveBeenCalledWith(expect.objectContaining({ programId: quickWorkout.id,
      workoutDates: [{ workoutId: "workout-1", plannedDate: "2026-09-23" }] }));
  });

  it("waits for complete workout details before review", () => {
    const onAssign = vi.fn();
    renderDialog({ programs: [{ ...quickWorkout, weeks: [], detailsLoaded: false, workoutCount: 1 }],
      initialProgramId: quickWorkout.id, onLoadProgram: vi.fn(() => new Promise<Program>(() => {})), onAssign });
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(screen.getByText("Loading workouts…")).toBeVisible();
    expect(onAssign).not.toHaveBeenCalled();
  });

  it("reuses the idempotency key for an identical retry and changes it after dates change", async () => {
    const user = userEvent.setup();
    const onAssign = vi.fn().mockRejectedValue(new Error("Connection interrupted"));
    renderDialog({ onAssign });
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Assign program" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection interrupted");
    await user.click(screen.getByRole("button", { name: "Assign program" }));
    const key = onAssign.mock.calls[0][0].idempotencyKey;
    expect(onAssign.mock.calls[1][0].idempotencyKey).toBe(key);
    await user.click(screen.getByRole("button", { name: /Back/ }));
    await user.click(screen.getByRole("radio", { name: /Set dates/ }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Assign program" }));
    expect(onAssign.mock.calls[2][0].idempotencyKey).not.toBe(key);
  });

  it("creates a distinct assignment request when switching between copies of the same source", async () => {
    const user = userEvent.setup();
    const onAssign = vi.fn().mockRejectedValue(new Error("Connection interrupted"));
    const otherRun = { ...run, id: "run-2", title: "Second copy" };
    renderDialog({ initialProgramId: undefined, runs: [run, otherRun],
      onLoadRun: vi.fn().mockResolvedValue(effectiveProgram), onAssign });
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Assign program" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection interrupted");
    const first = onAssign.mock.calls[0][0];
    await user.click(screen.getByRole("button", { name: /Back/ }));
    await user.click(screen.getByRole("button", { name: /Back/ }));
    await user.click(screen.getByRole("button", { name: /Second copy/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Assign program" }));
    const second = onAssign.mock.calls[1][0];
    expect(second.programId).toBe(first.programId);
    expect(second.workoutDates).toEqual(first.workoutDates);
    expect(second.runId).toBe(otherRun.id);
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it("cannot assign to a missing preselected athlete", () => {
    renderDialog({ initialAthleteIds: ["revoked-athlete"], athletes: [] });
    expect(screen.getByRole("heading", { name: "Assign training" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(screen.queryByText(/0 athletes/i)).not.toBeInTheDocument();
  });

  it("rejects review dates that reverse the workout sequence", async () => {
    const user = userEvent.setup();
    const { onAssign } = renderDialog();
    await user.click(screen.getByRole("radio", { name: /Set dates/ }));
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-09-07" } });
    await user.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByLabelText("Date for Jerk"), { target: { value: "2026-09-06" } });
    await user.click(screen.getByRole("button", { name: "Assign program" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Jerk is dated before Snatch");
    expect(onAssign).not.toHaveBeenCalled();
  });
});
