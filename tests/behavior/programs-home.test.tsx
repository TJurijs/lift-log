import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProgramRow, ProgramsHome } from "../../app/features/programs/ProgramsHome";
import { initialProgram } from "../../lib/demo-data";
import type { Program } from "../../lib/domain";

const programs: Program[] = [
  { ...initialProgram, id: "strength-plan", title: "Strength plan", description: "", contentType: "program", sourceType: "self" },
  { ...initialProgram, id: "strength-session", title: "Strength session", description: "", contentType: "quick_workout", sourceType: "self" },
  { ...initialProgram, id: "conditioning", title: "Conditioning", description: "", contentType: "program", sourceType: "self" },
];

function renderPrograms() {
  render(<ProgramsHome programs={programs} programRuns={[]} hasMoreProgramRuns={false}
    programRunsLoadingMore={false} programRunsLoadError="" viewerId={initialProgram.athleteId}
    source="own" hasCoach={false} hasMore={false} loadingMore={false} loadError="" action={null}
    capabilitiesForProgram={() => ({ view: true, copyToOwn: false, edit: false, save: false,
      schedule: false, assign: false, provideInitialAssignmentDate: false, deleteOwn: false, archiveInstance: false })}
    onOpen={vi.fn()} onEdit={vi.fn()} onDuplicate={vi.fn()} onDelete={vi.fn()} onUnassign={vi.fn()}
    onSource={vi.fn()} onCreate={vi.fn()} onCreateWorkout={vi.fn()} onSchedule={vi.fn()}
    onOpenRun={vi.fn()} onScheduleRun={vi.fn()} onEndRun={vi.fn()} onRepeatRun={vi.fn()}
    onLoadMore={vi.fn()} onLoadMoreProgramRuns={vi.fn()} />);
}

describe("Programs search and filters", () => {
  it("opens the reusable template and its active plan through distinct, explicit targets", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onOpenActiveRun = vi.fn();
    render(<ProgramRow program={programs[0]} viewerId={initialProgram.athleteId}
      activeRun={{ id: "run-1", programId: programs[0].id, programVersionId: "version-1",
        athleteId: initialProgram.athleteId, createdById: initialProgram.athleteId,
        title: programs[0].title, status: "in_progress", totalWorkouts: 4, completedWorkouts: 1,
        scheduledWorkouts: 2, completionPercent: 25, createdAt: "2026-09-01T09:00:00Z" }}
      canEdit={false} canDuplicate={false} canDelete={false} action={null}
      onOpen={onOpen} onOpenActiveRun={onOpenActiveRun} onEdit={vi.fn()} />);

    expect(screen.getByText("In use · 1/4 completed").closest("button")).toBeNull();
    await user.click(screen.getByText("Strength plan"));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpenActiveRun).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "View active plan for Strength plan" }));
    expect(onOpenActiveRun).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledOnce();
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
