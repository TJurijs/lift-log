import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CoachWorkspace,
  coachWorkspaceViewModel,
  type CoachWorkspaceProps,
} from "../../app/features/coaching/CoachWorkspace";
import type {
  AthleteSummary,
  CoachAgendaEntry,
  ProgramRunSummary,
} from "../../lib/domain";
import {
  appDetailDataFromHistory,
  appDetailFromHistory,
  pushAppDetailHistory,
} from "../../lib/app-route";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const program: ProgramRunSummary = {
  id: "program-run-1",
  athleteId: "athlete-1",
  createdById: "coach-1",
  programId: "program-1",
  programVersionId: "version-1",
  title: "Balanced strength",
  status: "in_progress",
  totalWorkouts: 3,
  scheduledWorkouts: 2,
  completedWorkouts: 1,
  completionPercent: 33,
  nextWorkout: {
    id: "workout-2",
    title: "Full-body strength",
    plannedDate: "2026-09-04",
    status: "scheduled",
  },
  createdAt: "2026-09-01",
};

const completedEntry: CoachAgendaEntry = {
  id: "completed-1",
  programRunId: "program-run-1",
  programRunWorkoutId: "run-workout-1",
  kind: "completed",
  status: "completed",
  programId: "program-1",
  programVersionId: "version-1",
  programTitle: "Balanced strength",
  workoutId: "workout-1",
  workoutTitle: "Squat and press",
  date: "2026-09-02",
  rpe: 8,
  sessionId: "session-1",
};

const upcomingEntry: CoachAgendaEntry = {
  id: "upcoming-1",
  programRunId: "program-run-1",
  programRunWorkoutId: "run-workout-2",
  kind: "upcoming",
  status: "planned",
  programId: "program-1",
  programVersionId: "version-1",
  programTitle: "Balanced strength",
  workoutId: "workout-2",
  workoutTitle: "Full-body strength",
  date: "2026-09-04",
};

const athlete: AthleteSummary = {
  id: "athlete-1",
  name: "Elina Tolokonceva",
  initials: "ET",
  detailsLoaded: true,
  assignedProgramCount: 1,
  assignedPrograms: [],
  programRuns: [program],
  agenda: [completedEntry, upcomingEntry],
};

function renderWorkspace(overrides: Partial<CoachWorkspaceProps> = {}) {
  const callbacks = {
    onRefresh: vi.fn(),
    onRespondInvite: vi.fn(),
    onSelectAthlete: vi.fn(),
    onLoadMoreAthletes: vi.fn(),
    onLoadMoreHistory: vi.fn(),
    onLoadMoreProgramRuns: vi.fn(),
    onOpenAssignedProgram: vi.fn(),
    onOpenAgendaEntry: vi.fn(),
    onAssignAthlete: vi.fn(),
    onScheduleAthlete: vi.fn(),
    onUnassignAthlete: vi.fn(),
  };
  const props: CoachWorkspaceProps = {
    athletes: [athlete],
    pendingInvites: [],
    selectedAthlete: athlete,
    loadingAthleteId: null,
    openingProgramId: null,
    refreshing: false,
    hasMoreAthletes: false,
    loadingMoreAthletes: false,
    athletesLoadError: "",
    respondingInvite: null,
    ...callbacks,
    ...overrides,
  };
  const rendered = render(<CoachWorkspace {...props} />);
  return { ...rendered, callbacks };
}

describe("CoachWorkspace", () => {
  it("opens an athlete as a mobile drill-down instead of stacking navigation", async () => {
    const user = userEvent.setup();
    const { container, callbacks } = renderWorkspace();

    const workspace = container.querySelector(".coach-workspace");
    expect(workspace).not.toHaveClass("mobile-detail-open");

    await user.click(
      screen.getByRole("button", {
        name: "Open Elina Tolokonceva, 1 active training plan",
      }),
    );

    expect(workspace).toHaveClass("mobile-detail-open");
    expect(callbacks.onSelectAthlete).toHaveBeenCalledWith(athlete);

    await user.click(screen.getByRole("button", { name: "Back to athletes" }));
    expect(workspace).not.toHaveClass("mobile-detail-open");
  });

  it("uses the same native-history path for mobile athlete Back", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: true,
        media: "(max-width: 700px)",
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    );
    window.history.replaceState({}, "", "/#/coaching");
    const back = vi
      .spyOn(window.history, "back")
      .mockImplementation(() => undefined);
    renderWorkspace();

    await user.click(
      screen.getByRole("button", {
        name: "Open Elina Tolokonceva, 1 active training plan",
      }),
    );

    expect(appDetailFromHistory()).toBe("coach-athlete");
    expect(appDetailDataFromHistory()).toEqual({
      kind: "coach-athlete",
      athleteId: athlete.id,
      tab: "plan",
    });
    await user.click(screen.getByRole("button", { name: "Back to athletes" }));
    expect(back).toHaveBeenCalledOnce();
  });

  it("restores the exact athlete History context from native history", async () => {
    window.history.replaceState({}, "", "/#/coaching");
    pushAppDetailHistory("coach-athlete", "coaching", {
      data: {
        kind: "coach-athlete",
        athleteId: athlete.id,
        tab: "history",
      },
    });
    const { container } = renderWorkspace();

    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "History" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    expect(
      screen.getByRole("tabpanel", { name: "Workout history" }),
    ).toBeVisible();
    expect(container.querySelector(".coach-workspace")).toHaveClass(
      "mobile-detail-open",
    );

    window.history.replaceState({}, "", "/#/coaching");
    window.dispatchEvent(new PopStateEvent("popstate"));

    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Plan" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    expect(container.querySelector(".coach-workspace")).not.toHaveClass(
      "mobile-detail-open",
    );
  });

  it("separates the active plan from completed workout history", async () => {
    const user = userEvent.setup();
    const { callbacks } = renderWorkspace();

    expect(screen.getByText("In use · 1/3 completed")).toBeVisible();
    expect(screen.getByText("3 workouts")).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "History" }));
    expect(screen.getByRole("tabpanel", { name: "Workout history" })).toBeVisible();
    expect(screen.getByText("Squat and press")).toBeVisible();
    expect(screen.getByText("RPE 8")).toBeVisible();

    await user.click(screen.getByRole("button", { name: /Squat and press/ }));
    expect(callbacks.onOpenAgendaEntry).toHaveBeenCalledWith(
      athlete,
      completedEntry,
    );
  });

  it("uses an explicit end-program action", async () => {
    const user = userEvent.setup();
    const { callbacks } = renderWorkspace();

    await user.click(screen.getByRole("button", { name: "End Balanced strength" }));
    expect(callbacks.onUnassignAthlete).toHaveBeenCalledWith(athlete, program);
  });

  it("opens results from an ended run without an active program", async () => {
    const user = userEvent.setup();
    const endedAthlete: AthleteSummary = {
      ...athlete,
      assignedProgramCount: 0,
      assignedPrograms: [],
      programRuns: [],
      agenda: [completedEntry],
    };
    const { callbacks } = renderWorkspace({
      athletes: [endedAthlete],
      selectedAthlete: endedAthlete,
    });

    await user.click(screen.getByRole("tab", { name: "History" }));
    await user.click(screen.getByRole("button", { name: /Squat and press/ }));

    expect(callbacks.onOpenAgendaEntry).toHaveBeenCalledWith(
      endedAthlete,
      completedEntry,
    );
  });

  it("loads another history page for the selected athlete and exposes progress", async () => {
    const user = userEvent.setup();
    const pagedAthlete: AthleteSummary = {
      ...athlete,
      hasMoreHistory: true,
      historyCursor: {
        startedAt: "2026-09-02T10:00:00.000Z",
        id: "completed-1",
      },
    };
    const { callbacks, rerender } = renderWorkspace({
      athletes: [pagedAthlete],
      selectedAthlete: pagedAthlete,
    });

    await user.click(screen.getByRole("tab", { name: "History" }));
    await user.click(screen.getByRole("button", { name: "Load more results" }));
    expect(callbacks.onLoadMoreHistory).toHaveBeenCalledWith(pagedAthlete);

    rerender(
      <CoachWorkspace
        athletes={[pagedAthlete]}
        pendingInvites={[]}
        selectedAthlete={pagedAthlete}
        loadingAthleteId={null}
        loadingHistoryAthleteId={pagedAthlete.id}
        openingProgramId={null}
        refreshing={false}
        hasMoreAthletes={false}
        loadingMoreAthletes={false}
        athletesLoadError=""
        respondingInvite={null}
        {...callbacks}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Loading results…" }),
    ).toBeDisabled();
  });

  it("pages an athlete's run history without hiding it behind a fixed ceiling", async () => {
    const user = userEvent.setup();
    const pagedAthlete: AthleteSummary = {
      ...athlete,
      hasMoreProgramRuns: true,
      programRunCursor: {
        createdAt: "2026-08-01T10:00:00.000Z",
        id: "run-ended",
      },
    };
    const { callbacks } = renderWorkspace({
      athletes: [pagedAthlete],
      selectedAthlete: pagedAthlete,
    });

    await user.click(screen.getByRole("button", { name: "Load more training" }));
    expect(callbacks.onLoadMoreProgramRuns).toHaveBeenCalledWith(pagedAthlete);
  });

  it("keeps repeated runs with the same program revision isolated", () => {
    const otherRun: CoachAgendaEntry = {
      ...completedEntry,
      id: "completed-other-run",
      programRunId: "program-run-2",
      programRunWorkoutId: "run-workout-other",
      sessionId: "session-2",
    };

    expect(
      coachWorkspaceViewModel.agendaForProgram(
        { ...athlete, agenda: [completedEntry, otherRun] },
        program,
      ),
    ).toEqual([completedEntry]);
  });

  it("keeps the plan compact and opens the complete plan", async () => {
    const user = userEvent.setup();
    const extraAgenda: CoachAgendaEntry[] = Array.from(
      { length: 4 },
      (_, index) => ({
        ...upcomingEntry,
        id: `upcoming-${index + 1}`,
        programRunWorkoutId: `run-workout-${index + 2}`,
        workoutId: `workout-${index + 2}`,
        workoutTitle: `Upcoming workout ${index + 1}`,
        date: `2026-09-${String(index + 4).padStart(2, "0")}`,
      }),
    );
    const anotherCompleted: CoachAgendaEntry = {
      ...completedEntry,
      id: "completed-2",
      programRunWorkoutId: "run-workout-completed-2",
      workoutId: "workout-completed-2",
      workoutTitle: "Earlier completed workout",
      date: "2026-09-01",
      sessionId: "session-2",
    };
    const athleteWithPreview = {
      ...athlete,
      agenda: [anotherCompleted, completedEntry, ...extraAgenda],
    };
    const { callbacks } = renderWorkspace({
      athletes: [athleteWithPreview],
      selectedAthlete: athleteWithPreview,
    });

    expect(screen.queryByText("Upcoming workout 1")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", {
      name: "Open active Balanced strength training",
    }));
    expect(callbacks.onOpenAssignedProgram).toHaveBeenCalledWith(
      athleteWithPreview,
      program,
      undefined,
    );
  });

  it("keeps completed activity in the History tab", async () => {
    const user = userEvent.setup();
    const completedAgenda: CoachAgendaEntry[] = Array.from(
      { length: 5 },
      (_, index) => ({
        ...completedEntry,
        id: `completed-${index + 1}`,
        programRunWorkoutId: `completed-run-workout-${index + 1}`,
        workoutId: `completed-workout-${index + 1}`,
        workoutTitle: `Completed workout ${index + 1}`,
        date: `2026-08-${String(index + 20).padStart(2, "0")}`,
        sessionId: `session-${index + 1}`,
      }),
    );
    const historyAthlete: AthleteSummary = {
      ...athlete,
      agenda: completedAgenda,
    };
    renderWorkspace({
      athletes: [historyAthlete],
      selectedAthlete: historyAthlete,
    });

    expect(screen.queryByText("Completed workout 1")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "History" }));
    expect(
      screen.getByRole("tabpanel", { name: "Workout history" }),
    ).toBeVisible();
  });

  it("renders a complete coach empty state without a legacy workspace", () => {
    renderWorkspace({ athletes: [], selectedAthlete: null });

    expect(screen.getByText("No athletes yet")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Select an athlete" })).toBeVisible();
  });

  it("has no automated accessibility violations in the populated plan", async () => {
    const { container } = renderWorkspace();
    const results = await axe(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });
});
