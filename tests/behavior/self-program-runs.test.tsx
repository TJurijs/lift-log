import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import SelfProgramRuns, {
  CoachProgramRuns,
} from "../../app/features/program-runs/SelfProgramRuns";
import type { ProgramRunSummary } from "../../lib/domain";

const activeRun: ProgramRunSummary = {
  id: "run-active",
  athleteId: "viewer-1",
  createdById: "viewer-1",
  programId: "program-1",
  programVersionId: "version-1",
  title: "Ten-week plan",
  status: "in_progress",
  totalWorkouts: 40,
  scheduledWorkouts: 6,
  completedWorkouts: 11,
  completionPercent: 28,
  nextWorkout: {
    id: "slot-12",
    title: "Workout 12",
    status: "unscheduled",
  },
  createdAt: "2026-09-01T09:00:00Z",
};

const endedRun: ProgramRunSummary = {
  ...activeRun,
  id: "run-ended",
  status: "ended",
  completedWorkouts: 13,
  completionPercent: 33,
  nextWorkout: undefined,
  endedAt: "2026-09-02T09:00:00Z",
};

function renderRuns(runs: ProgramRunSummary[]) {
  const callbacks = {
    onOpen: vi.fn(),
    onSchedule: vi.fn(),
    onEnd: vi.fn(),
    onRepeat: vi.fn(),
  };
  const rendered = render(<SelfProgramRuns runs={runs} {...callbacks} />);
  return { ...rendered, callbacks };
}

describe("SelfProgramRuns", () => {
  it("renders aggregate progress from the complete run and exposes future-slot actions", async () => {
    const user = userEvent.setup();
    const { callbacks } = renderRuns([activeRun]);

    expect(screen.getByText("In progress · 11/40 completed")).toBeVisible();
    expect(screen.getByText("40 workouts")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Open active Ten-week plan training" }));
    await user.click(screen.getByRole("button", { name: "Schedule Ten-week plan" }));
    await user.click(screen.getByRole("button", { name: "End Ten-week plan" }));

    expect(callbacks.onOpen).toHaveBeenCalledWith(activeRun);
    expect(callbacks.onSchedule).toHaveBeenCalledWith(activeRun);
    expect(callbacks.onEnd).toHaveBeenCalledWith(activeRun);
});

describe("CoachProgramRuns", () => {
  it("shows only coach-created runs with the same lifecycle actions", async () => {
    const user = userEvent.setup();
    const coachRun: ProgramRunSummary = {
      ...activeRun,
      id: "run-from-coach",
      createdById: "coach-1",
      title: "Coach-assigned strength",
    };
    const callbacks = {
      onOpen: vi.fn(),
      onSchedule: vi.fn(),
      onEnd: vi.fn(),
      onRepeat: vi.fn(),
    };

    render(
      <CoachProgramRuns
        viewerId="viewer-1"
        runs={[activeRun, coachRun, coachRun]}
        {...callbacks}
      />,
    );

    expect(screen.getByText("Coach-assigned strength")).toBeVisible();
    expect(screen.getAllByText("Coach-assigned strength")).toHaveLength(1);
    expect(screen.queryByText("Ten-week plan")).not.toBeInTheDocument();
    expect(screen.getByText(/Coach assigned/)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Open active Coach-assigned strength training" }));
    await user.click(screen.getByRole("button", { name: "Schedule Coach-assigned strength" }));
    await user.click(screen.getByRole("button", { name: "End Coach-assigned strength" }));


    expect(callbacks.onOpen).toHaveBeenCalledWith(coachRun);
    expect(callbacks.onSchedule).toHaveBeenCalledWith(coachRun);
    expect(callbacks.onEnd).toHaveBeenCalledWith(coachRun);
  });

  it("has a useful empty state when only reusable self training exists", () => {
    render(
      <CoachProgramRuns
        viewerId="viewer-1"
        runs={[activeRun]}
        onOpen={vi.fn()}
        onSchedule={vi.fn()}
        onEnd={vi.fn()}
        onRepeat={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "No coach training" })).toBeVisible();
    expect(
      screen.getByText("Programs and workouts assigned by your coach will appear here."),
    ).toBeVisible();
  });
});
  it("keeps a finished run available for viewing and repeats it as a separate action", async () => {
    const user = userEvent.setup();
    const { callbacks } = renderRuns([endedRun]);

    await user.click(screen.getByText("Recent training"));
    expect(screen.getByText("Ended", { exact: false })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "View Ten-week plan" }));
    await user.click(screen.getByRole("button", { name: "Repeat Ten-week plan" }));

    expect(callbacks.onOpen).toHaveBeenCalledWith(endedRun);
    expect(callbacks.onRepeat).toHaveBeenCalledWith(endedRun);
    expect(callbacks.onEnd).not.toHaveBeenCalled();
  });

  it("renders every loaded history row and exposes an accessible next-page action", async () => {
    const user = userEvent.setup();
    const onLoadMore = vi.fn();
    const runs = Array.from({ length: 12 }, (_, index) => ({
      ...endedRun,
      id: `run-ended-${index}`,
      title: `Finished plan ${index + 1}`,
    }));

    render(
      <SelfProgramRuns
        runs={runs}
        hasMore
        onLoadMore={onLoadMore}
        onOpen={vi.fn()}
        onSchedule={vi.fn()}
        onEnd={vi.fn()}
        onRepeat={vi.fn()}
      />,
    );

    await user.click(screen.getByText("Recent training"));
    expect(screen.getAllByRole("button", { name: /^View Finished plan/ })).toHaveLength(12);
    await user.click(screen.getByRole("button", { name: "Load more training" }));
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it("adds no empty panel when the user has never started a run", () => {
    const { container } = renderRuns([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps errors and a retry action visible before the first run has loaded", async () => {
    const user = userEvent.setup();
    const onLoadMore = vi.fn();
    render(
      <SelfProgramRuns runs={[]} loadError="Training could not be loaded" onLoadMore={onLoadMore}
        onOpen={vi.fn()} onSchedule={vi.fn()} onEnd={vi.fn()} onRepeat={vi.fn()} />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Training could not be loaded");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it("can load another page when the current page has no personal runs", async () => {
    const user = userEvent.setup();
    const onLoadMore = vi.fn();
    render(
      <SelfProgramRuns runs={[]} hasMore onLoadMore={onLoadMore}
        onOpen={vi.fn()} onSchedule={vi.fn()} onEnd={vi.fn()} onRepeat={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: "Load more training" }));
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it("keeps the coach empty state hidden until loading has finished", () => {
    const callbacks = { onOpen: vi.fn(), onSchedule: vi.fn(), onEnd: vi.fn(), onRepeat: vi.fn() };
    const { rerender } = render(<CoachProgramRuns viewerId="viewer-1" runs={[]} loadingMore {...callbacks} />);

    expect(screen.queryByRole("heading", { name: "No coach training" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Loading training…" })).toBeDisabled();
    rerender(<CoachProgramRuns viewerId="viewer-1" runs={[]} {...callbacks} />);
    expect(screen.getByRole("heading", { name: "No coach training" })).toBeVisible();
  });
});
