import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TrainingDatePicker, type TrainingDatePickerProps } from "../../app/features/scheduling/TrainingDatePicker";
import { initialProgram } from "../../lib/demo-data";
import type { Program, ProgramRunSummary } from "../../lib/domain";

const viewerId = initialProgram.athleteId;
const draft: Program = { ...initialProgram, id: "own-workout", createdById: viewerId, sourceType: "self", title: "Friday strength", contentType: "quick_workout" };
const run: ProgramRunSummary = {
  id: "run", athleteId: viewerId, createdById: "coach", programId: "coach-program", programVersionId: "version",
  title: "Balanced program", status: "in_progress", totalWorkouts: 3, scheduledWorkouts: 1, completedWorkouts: 1,
  completionPercent: 33, createdAt: "2026-09-20T12:00:00Z",
  nextWorkout: { id: "next", title: "Lower body", plannedDate: "2026-09-23", status: "scheduled" },
};
function renderPicker(props: Partial<TrainingDatePickerProps> = {}) {
  const callbacks = { onChooseProgram: vi.fn(), onChooseRun: vi.fn(), onClose: vi.fn() };
  render(<TrainingDatePicker programs={[draft]} runs={[run]} viewerId={viewerId} initialDate="2026-09-23" {...callbacks} {...props} />);
  return callbacks;
}

describe("Calendar training selection", () => {
  it("selects the existing workout or coach-assigned program without a repeat step", async () => {
    const user = userEvent.setup();
    const callbacks = renderPicker();
    expect(screen.getByRole("dialog", { name: "Set training dates" })).toBeVisible();
    expect(screen.getByText("Next: Lower body")).toBeVisible();
    const choices = screen.getAllByRole("button", { name: /^Set dates for/ });
    expect(choices.map((choice) => choice.getAttribute("aria-label"))).toEqual(["Set dates for Balanced program", "Set dates for Friday strength"]);
    await user.click(choices[0]);
    expect(callbacks.onChooseRun).toHaveBeenCalledWith(run);
    await user.click(choices[1]);
    expect(callbacks.onChooseProgram).toHaveBeenCalledWith(draft);
    expect(screen.queryByRole("button", { name: /Repeat|Plan workout|Use/ })).not.toBeInTheDocument();
  });

  it("excludes historical training, source duplicates, private editors, and another athlete's training", () => {
    renderPicker({ programs: [draft,
      { ...draft, id: run.programId, title: "Duplicate source" },
      { ...draft, id: "hidden-source", title: "History elsewhere", hasOwnRuns: true },
      { ...draft, id: "private", title: "Private editor", editableRunId: run.id },
      { ...draft, id: "other", title: "Another athlete", athleteId: "other" }],
    runs: [run, { ...run, id: "completed", title: "Completed run", status: "completed" },
      { ...run, id: "ended", title: "Ended run", status: "ended" },
      { ...run, id: "other-run", title: "Another athlete run", athleteId: "other" }] });
    expect(screen.getAllByRole("button", { name: /^Set dates for/ })).toHaveLength(2);
    expect(screen.queryByText(/Duplicate source|History elsewhere|Private editor|Another athlete|Completed run|Ended run/)).not.toBeInTheDocument();
  });

  it("searches next workout names and preserves pagination when loaded results do not match", async () => {
    const user = userEvent.setup();
    const onLoadMorePrograms = vi.fn();
    const onLoadMoreRuns = vi.fn();
    renderPicker({ hasMorePrograms: true, hasMoreRuns: true, onLoadMorePrograms, onLoadMoreRuns });
    const search = screen.getByRole("textbox", { name: "Search training" });
    await user.type(search, "lower");
    expect(screen.getByRole("button", { name: "Set dates for Balanced program" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Set dates for Friday strength" })).not.toBeInTheDocument();
    await user.clear(search);
    await user.type(search, "not loaded");
    expect(screen.getByRole("status")).toHaveTextContent("No matching training");
    await user.click(screen.getByRole("button", { name: "Load more training" }));
    expect(onLoadMorePrograms).toHaveBeenCalledOnce();
    expect(onLoadMoreRuns).toHaveBeenCalledOnce();
  });

  it("reports load failures and lets the caller retry without presenting a successful empty result", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderPicker({ programs: [], runs: [], error: "Training could not be loaded", onRetry });
    expect(screen.getByRole("alert")).toHaveTextContent("Training could not be loaded");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("does not mistake a page of finished runs for an empty training list", () => {
    renderPicker({ programs: [], runs: [{ ...run, status: "completed" }], hasMoreRuns: true, onLoadMoreRuns: vi.fn() });
    expect(screen.getByRole("status")).toHaveTextContent("More training is available");
    expect(screen.queryByText(/No unfinished training/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load more training" })).toBeVisible();
  });
});
