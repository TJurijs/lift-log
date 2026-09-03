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

    expect(screen.getByText("11 of 40 workouts completed")).toBeVisible();
    expect(screen.getByLabelText("28% complete")).toBeVisible();
    expect(screen.getByText(/Workout 12/)).toHaveTextContent("no date");

    await user.click(screen.getByRole("button", { name: "View plan" }));
    await user.click(screen.getByRole("button", { name: "Schedule remaining" }));
    await user.click(screen.getByRole("button", { name: "End program" }));

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
        runs={[activeRun, coachRun]}
        {...callbacks}
      />,
    );

    expect(screen.getByText("Coach-assigned strength")).toBeVisible();
    expect(screen.queryByText("Ten-week plan")).not.toBeInTheDocument();
    expect(screen.getByText(/Coach assigned/)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "View plan" }));
    await user.click(screen.getByRole("button", { name: "Schedule remaining" }));
    await user.click(screen.getByRole("button", { name: "End program" }));


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
    await user.click(screen.getByRole("button", { name: "View" }));
    await user.click(screen.getByRole("button", { name: "Repeat" }));

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
    expect(screen.getAllByRole("button", { name: "View" })).toHaveLength(12);
    await user.click(screen.getByRole("button", { name: "Load more training" }));
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it("adds no empty panel when the user has never started a run", () => {
    const { container } = renderRuns([]);
    expect(container).toBeEmptyDOMElement();
  });
});
