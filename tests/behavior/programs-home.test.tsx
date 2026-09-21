import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProgramRow, ProgramsHome } from "../../app/features/programs/ProgramsHome";
import { initialProgram } from "../../lib/demo-data";
import type { Program, ProgramRunSummary } from "../../lib/domain";
import type { ComponentProps } from "react";

const programs: Program[] = [
  { ...initialProgram, id: "strength-plan", title: "Strength plan", description: "", contentType: "program", sourceType: "self" },
  { ...initialProgram, id: "strength-session", title: "Strength session", description: "", contentType: "quick_workout", sourceType: "self" },
  { ...initialProgram, id: "conditioning", title: "Conditioning", description: "", contentType: "program", sourceType: "self" },
];

const activeRun: ProgramRunSummary = {
  id: "run-1", programId: programs[0].id, programVersionId: "version-1",
  athleteId: initialProgram.athleteId, createdById: initialProgram.athleteId,
  title: programs[0].title, status: "in_progress", totalWorkouts: 4, completedWorkouts: 1,
  scheduledWorkouts: 2, completionPercent: 25, createdAt: "2026-09-01T09:00:00Z",
};

function renderPrograms(props: Partial<ComponentProps<typeof ProgramsHome>> = {}) {
  render(<ProgramsHome programs={programs} programRuns={[]} hasMoreRuns={false}
    runsLoading={false} runsError="" viewerId={initialProgram.athleteId}
    source="own" hasCoach={false} hasMore={false} loadingMore={false} loadError="" action={null}
    capabilitiesForProgram={() => ({ view: true, copyToOwn: false, edit: false, save: false,
      schedule: false, assign: false, provideInitialAssignmentDate: false, deleteOwn: false, archiveInstance: false })}
    onOpen={vi.fn()} onEdit={vi.fn()} onDuplicate={vi.fn()} onDelete={vi.fn()}
    onSource={vi.fn()} onCreate={vi.fn()} onCreateWorkout={vi.fn()} onSetDates={vi.fn()}
    onOpenRun={vi.fn()} onSetRunDates={vi.fn()} onEndRun={vi.fn()} onRepeatRun={vi.fn()}
    onLoadMore={vi.fn()} onLoadMoreRuns={vi.fn()} {...props} />);
}

describe("Programs search and filters", () => {
  it("shows the actual active program once and opens its own progress", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onOpenRun = vi.fn();
    renderPrograms({ programRuns: [activeRun], onOpen, onOpenRun });

    await screen.findByText("1/4 completed");
    expect(screen.getAllByText("Strength plan")).toHaveLength(1);
    expect(screen.queryByText(/Template|Saved version|In use/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open Strength plan" }));
    expect(onOpenRun).toHaveBeenCalledWith(activeRun);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("keeps two uses as independent programs and hides only their source card", async () => {
    const repeat = { ...activeRun, id: "run-2", title: "Strength plan again", status: "not_started" as const };
    renderPrograms({ programRuns: [activeRun, repeat] });

    expect(await screen.findByRole("button", { name: "Open Strength plan" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Open Strength plan again" })).toBeVisible();
    expect(screen.getAllByText("Strength plan")).toHaveLength(1);
    expect(screen.getByText("Strength session")).toBeVisible();
  });

  it("does not hide a coach's own workout after assigning a copy to someone else", () => {
    renderPrograms({ programRuns: [{ ...activeRun, athleteId: "another-athlete" }] });
    expect(screen.getByText("Strength plan")).toBeVisible();
  });

  it("keeps a used source hidden when its older history has not loaded yet", async () => {
    const user = userEvent.setup();
    const onLoadMoreRuns = vi.fn();
    renderPrograms({ programs: [{ ...programs[0], hasOwnRuns: true }], programRuns: [], hasMoreRuns: true,
      onLoadMoreRuns });

    expect(screen.queryByText("Strength plan")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Set dates for Strength plan" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Load more training" }));
    expect(onLoadMoreRuns).toHaveBeenCalledOnce();
  });

  it("offers repeat and assignment without exposing version state", async () => {
    const user = userEvent.setup();
    const onRepeat = vi.fn();
    const onAssign = vi.fn();
    render(<ProgramRow program={programs[0]}
      canEdit canDuplicate canDelete action={null} onOpen={vi.fn()} onEdit={vi.fn()}
      onDuplicate={onRepeat} onAssign={onAssign} onDelete={vi.fn()} onSetDates={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Set dates for Strength plan" })).not.toBeVisible();
    await user.click(screen.getByText("More"));
    await user.click(screen.getByRole("button", { name: "Repeat Strength plan program" }));
    expect(onRepeat).toHaveBeenCalledOnce();
    await user.click(screen.getByText("More"));
    await user.click(screen.getByRole("button", { name: "Assign Strength plan to athletes" }));
    expect(onAssign).toHaveBeenCalledOnce();
    expect(screen.queryByText(/Template|Saved version|In use/)).not.toBeInTheDocument();
  });

  it("loads the shared active training page while filtering personal training", async () => {
    const user = userEvent.setup();
    const onLoadMoreRuns = vi.fn();
    renderPrograms({ programRuns: [activeRun], hasMoreRuns: true,
      onLoadMoreRuns });
    await user.click(await screen.findByRole("button", { name: "Load more training" }));
    expect(onLoadMoreRuns).toHaveBeenCalledOnce();
  });

  it("keeps coach pagination available when search has no loaded matches", async () => {
    const user = userEvent.setup();
    const onLoadMoreRuns = vi.fn();
    renderPrograms({ source: "coach", hasCoach: true, hasMoreRuns: true,
      programRuns: [{ ...activeRun, createdById: "coach-1" }], onLoadMoreRuns });
    await user.type(screen.getByRole("textbox", { name: "Search programs and workouts" }), "Missing");

    expect(screen.getByRole("heading", { name: "No matching training" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "No coach training" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Load more training" }));
    expect(onLoadMoreRuns).toHaveBeenCalledOnce();
  });

  it("clears type filters while retaining the user's search and matching results", async () => {
    const user = userEvent.setup();
    renderPrograms();
    const search = screen.getByRole("textbox", { name: "Search programs and workouts" });
    await user.type(search, "Strength");
    await user.click(screen.getByRole("button", { name: "Filters" }));
    const filters = document.getElementById("program-filter-panel")!;
    await user.click(within(filters).getByRole("button", { name: "Workouts" }));
    expect(screen.getByText("Strength session")).toBeVisible();
    expect(screen.queryByText("Strength plan")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(search).toHaveValue("Strength");
    expect(screen.getByText("Strength plan")).toBeVisible();
    expect(screen.getByText("Strength session")).toBeVisible();
    expect(screen.queryByText("Conditioning")).not.toBeInTheDocument();
    expect(within(filters).getByRole("button", { name: "Workouts" })).toHaveAttribute("aria-pressed", "false");
  });

  it("clears both search and filters only through the explicitly named empty-state action", async () => {
    const user = userEvent.setup();
    renderPrograms();
    const search = screen.getByRole("textbox", { name: "Search programs and workouts" });
    await user.type(search, "Missing");
    await user.click(screen.getByRole("button", { name: "Filters" }));
    const filters = document.getElementById("program-filter-panel")!;
    await user.click(within(filters).getByRole("button", { name: "Workouts" }));

    await user.click(screen.getByRole("button", { name: "Clear search and filters" }));

    expect(search).toHaveValue("");
    expect(screen.getByText("Strength plan")).toBeVisible();
    expect(screen.getByText("Strength session")).toBeVisible();
    expect(screen.getByText("Conditioning")).toBeVisible();
    expect(within(filters).getByRole("button", { name: "Workouts" })).toHaveAttribute("aria-pressed", "false");
  });
});
