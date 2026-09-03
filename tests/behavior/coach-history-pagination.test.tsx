import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import LiftLogApp from "../../app/LiftLogApp";
import { demoViewer } from "../../lib/auth";
import { demoWorkspace } from "../../lib/demo-data";
import type { AthleteSummary, CoachAgendaEntry } from "../../lib/domain";
import type { LiftLogRepository } from "../../lib/repository";

const firstResult: CoachAgendaEntry = {
  id: "session:newer",
  programRunId: "run-1",
  programRunWorkoutId: "run-workout-newer",
  kind: "completed",
  status: "completed",
  programId: "program-1",
  programVersionId: "version-1",
  programTitle: "Balanced strength",
  workoutId: "workout-newer",
  workoutTitle: "Newer workout",
  date: "2026-09-03",
  sessionId: "newer",
};

const olderResult: CoachAgendaEntry = {
  ...firstResult,
  id: "session:older",
  programRunWorkoutId: "run-workout-older",
  workoutId: "workout-older",
  workoutTitle: "Older workout",
  date: "2026-09-02",
  sessionId: "older",
};

const cursor = {
  startedAt: "2026-09-03T10:00:00.000Z",
  id: "newer",
};

const athlete: AthleteSummary = {
  id: "athlete-1",
  name: "Elina Athlete",
  initials: "EA",
  detailsLoaded: true,
  assignedProgramCount: 0,
  assignedPrograms: [],
  programRuns: [],
  agenda: [firstResult],
  historyCursor: cursor,
  hasMoreHistory: true,
};

afterEach(() => {
  window.history.replaceState(null, "", window.location.pathname);
  vi.unstubAllGlobals();
});

describe("coach history pagination flow", () => {
  it("requests the stored cursor, merges unique results, and removes the terminal action", async () => {
    window.history.replaceState(null, "", `${window.location.pathname}#/coaching`);
    vi.stubGlobal("scrollTo", vi.fn());
    const loadCoachingWorkspace = vi.fn().mockResolvedValue({
      coachConnections: [],
      pendingCoachInvites: [],
      outgoingCoachInvites: [],
      coachedAthletes: [athlete],
    });
    const listCoachCompletedHistory = vi.fn().mockResolvedValue({
      items: [firstResult, olderResult],
      hasMore: false,
    });
    const repository = {
      loadCoachingWorkspace,
      listCoachCompletedHistory,
    } as unknown as LiftLogRepository;
    const initialWorkspace = {
      ...demoWorkspace,
      coachingAccess: {
        hasCoach: false,
        coachedAthleteCount: 1,
        pendingInviteCount: 0,
      },
      coachConnections: [],
      pendingCoachInvites: [],
      outgoingCoachInvites: [],
      coachedAthletes: [athlete],
    };
    const user = userEvent.setup();

    render(
      <LiftLogApp
        viewer={demoViewer}
        initialWorkspace={initialWorkspace}
        repository={repository}
        onSignOut={vi.fn()}
      />,
    );

    await waitFor(() => expect(loadCoachingWorkspace).toHaveBeenCalledOnce());
    await user.click(screen.getByRole("tab", { name: "My athletes" }));
    await user.click(await screen.findByRole("tab", { name: "History" }));
    await user.click(screen.getByRole("button", { name: "Load more results" }));

    await waitFor(() =>
      expect(listCoachCompletedHistory).toHaveBeenCalledWith("athlete-1", {
        limit: 25,
        cursor,
      }),
    );
    expect(await screen.findByText("Older workout")).toBeVisible();
    expect(screen.getAllByText("Newer workout")).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: "Load more results" }),
    ).not.toBeInTheDocument();
  });

  it("returns to the exact athlete History tab and restores results on Forward", async () => {
    window.history.replaceState(null, "", `${window.location.pathname}#/coaching`);
    vi.stubGlobal("scrollTo", vi.fn());
    const loadCompletedSessionDetail = vi.fn().mockResolvedValue({
      id: "newer",
      programRunId: firstResult.programRunId,
      programRunWorkoutId: firstResult.programRunWorkoutId,
      programVersionId: firstResult.programVersionId,
      workoutId: firstResult.workoutId,
      workoutTitle: firstResult.workoutTitle,
      date: firstResult.date,
      durationMinutes: 52,
      rpe: 8,
      items: [],
    });
    const repository = {
      loadCoachingWorkspace: vi.fn().mockResolvedValue({
        coachConnections: [],
        pendingCoachInvites: [],
        outgoingCoachInvites: [],
        coachedAthletes: [athlete],
      }),
      loadCompletedSessionDetail,
      listProgramSummaries: vi.fn().mockResolvedValue({
        items: [],
        hasMore: false,
      }),
      listProgramRuns: vi.fn().mockResolvedValue({
        items: [],
        hasMore: false,
      }),
    } as unknown as LiftLogRepository;
    const user = userEvent.setup();
    render(
      <LiftLogApp
        viewer={demoViewer}
        initialWorkspace={{
          ...demoWorkspace,
          coachingAccess: {
            hasCoach: false,
            coachedAthleteCount: 1,
            pendingInviteCount: 0,
          },
          coachConnections: [],
          pendingCoachInvites: [],
          outgoingCoachInvites: [],
          coachedAthletes: [athlete],
        }}
        repository={repository}
        onSignOut={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "My athletes" }));
    await user.click(await screen.findByRole("tab", { name: "History" }));
    await user.click(screen.getByRole("button", { name: /Newer workout/ }));

    expect(
      await screen.findByRole("heading", { name: "Workout results", level: 1 }),
    ).toBeVisible();
    await waitFor(() =>
      expect(loadCompletedSessionDetail).toHaveBeenCalledWith("newer", "athlete-1"),
    );

    act(() => window.history.back());
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "History" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    expect(
      screen.getByRole("tabpanel", { name: "Workout history" }),
    ).toBeVisible();

    act(() => window.history.forward());
    expect(
      await screen.findByRole("heading", { name: "Workout results", level: 1 }),
    ).toBeVisible();
  });
});
