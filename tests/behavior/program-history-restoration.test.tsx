import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import LiftLogApp from "../../app/LiftLogApp";
import { demoViewer } from "../../lib/auth";
import { demoWorkspace, initialProgram } from "../../lib/demo-data";
import type { Program, ProgramRunDetail } from "../../lib/domain";
import { pushAppDetailHistory } from "../../lib/app-route";
import type { LiftLogRepository } from "../../lib/repository";

function repositoryForHistoryRestore(overrides: Record<string, unknown> = {}) {
  return {
    listProgramSummaries: vi.fn().mockResolvedValue({
      items: [initialProgram],
      hasMore: false,
    }),
    listProgramRuns: vi.fn().mockResolvedValue({
      items: [],
      hasMore: false,
    }),
    loadProgramDetail: vi.fn().mockResolvedValue(initialProgram),
    loadProgramForRun: vi.fn().mockResolvedValue(initialProgram),
    loadProgramRunDetail: vi.fn().mockResolvedValue(null),
    searchExercises: vi.fn().mockResolvedValue({
      items: [],
      hasMore: false,
    }),
    ...overrides,
  } as unknown as LiftLogRepository;
}

function renderApp(repository: LiftLogRepository, workspace = demoWorkspace) {
  return render(
    <LiftLogApp
      viewer={demoViewer}
      initialWorkspace={workspace}
      repository={repository}
      onSignOut={vi.fn()}
    />,
  );
}

afterEach(() => {
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("program detail browser-history restoration", () => {
  it.each(["Programs", "Exercises"])("keeps %s open when an earlier program request finishes", async (destination) => {
    window.history.replaceState({}, "", "/#/program");
    vi.stubGlobal("scrollTo", vi.fn());
    const user = userEvent.setup();
    const summary: Program = { ...initialProgram, detailsLoaded: false, weeks: [] };
    let resolveDetail!: (program: Program) => void;
    const loadProgramDetail = vi.fn(() => new Promise<Program>((resolve) => { resolveDetail = resolve; }));
    const repository = repositoryForHistoryRestore({
      loadProgramDetail,
      listProgramSummaries: vi.fn().mockResolvedValue({ items: [summary], hasMore: false }),
    });
    renderApp(repository, {
      ...demoWorkspace,
      programCatalog: [summary],
      activeProgram: null,
      draftProgram: null,
      schedulablePrograms: [],
    });

    const programTitle = await screen.findByText(initialProgram.title);
    await user.click(programTitle.closest("button")!);
    await waitFor(() => expect(loadProgramDetail).toHaveBeenCalledOnce());
    const navigation = screen.getByRole("navigation", { name: "Main navigation" });
    await user.click(within(navigation).getByRole("button", { name: destination }));
    await act(async () => { resolveDetail(initialProgram); });

    expect(await screen.findByRole("heading", { level: 1, name: destination })).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "Program name" })).not.toBeInTheDocument();
    expect(window.location.hash).toBe(destination === "Programs" ? "#/program" : "#/exercises");
  });

  it("reloads the exact template revision from a restored history entry", async () => {
    window.history.replaceState({}, "", "/#/program");
    vi.stubGlobal("scrollTo", vi.fn());
    const loadProgramDetail = vi.fn().mockResolvedValue(initialProgram);
    const repository = repositoryForHistoryRestore({ loadProgramDetail });
    renderApp(repository);

    pushAppDetailHistory("program", "program", {
      data: {
        kind: "program",
        programId: initialProgram.id,
        programVersionId: initialProgram.versionId,
        athleteId: initialProgram.athleteId,
        workoutId: initialProgram.weeks[0].workouts[0].id,
        returnView: "program",
      },
    });
    window.dispatchEvent(new PopStateEvent("popstate"));

    await waitFor(() =>
      expect(loadProgramDetail).toHaveBeenCalledWith(
        initialProgram.athleteId,
        initialProgram.id,
        initialProgram.versionId,
        undefined,
      ),
    );
    expect(
      await screen.findByRole("textbox", { name: "Program name" }),
    ).toHaveValue(initialProgram.title);

    act(() => window.history.back());
    expect(
      await screen.findByRole("heading", { level: 1, name: "Programs" }),
    ).toBeVisible();
    loadProgramDetail.mockClear();

    act(() => window.history.forward());
    await waitFor(() => expect(loadProgramDetail).toHaveBeenCalledOnce());
    expect(
      await screen.findByRole("textbox", { name: "Program name" }),
    ).toHaveValue(initialProgram.title);
  });

  it("reloads exact immutable run content and progress from its history entry", async () => {
    window.history.replaceState({}, "", "/#/program");
    vi.stubGlobal("scrollTo", vi.fn());
    const firstWorkout = initialProgram.weeks[0].workouts[0];
    const run: ProgramRunDetail = {
      id: "run-history-1",
      athleteId: initialProgram.athleteId,
      createdById: initialProgram.athleteId,
      programId: initialProgram.id,
      programVersionId: initialProgram.versionId,
      title: initialProgram.title,
      contentType: initialProgram.contentType,
      status: "in_progress",
      totalWorkouts: 1,
      scheduledWorkouts: 1,
      completedWorkouts: 0,
      completionPercent: 0,
      createdAt: "2026-09-03T08:00:00.000Z",
      workouts: [
        {
          id: "run-workout-history-1",
          runId: "run-history-1",
          workoutId: firstWorkout.id,
          title: firstWorkout.title,
          position: 0,
          estimatedMinutes: firstWorkout.durationMinutes,
          status: "scheduled",
          plannedDate: "2026-09-05",
          prescriptionOverrides: {},
        },
      ],
    };
    const loadProgramForRun = vi.fn().mockResolvedValue(initialProgram);
    const loadProgramRunDetail = vi.fn().mockResolvedValue(run);
    const repository = repositoryForHistoryRestore({
      loadProgramForRun,
      loadProgramRunDetail,
    });
    renderApp(repository);

    pushAppDetailHistory("program", "program", {
      data: {
        kind: "program",
        programId: initialProgram.id,
        programVersionId: initialProgram.versionId,
        athleteId: initialProgram.athleteId,
        programRunId: run.id,
        workoutId: firstWorkout.id,
        returnView: "today",
      },
    });
    window.dispatchEvent(new PopStateEvent("popstate"));

    await waitFor(() => {
      expect(loadProgramForRun).toHaveBeenCalledWith(run.id);
      expect(loadProgramRunDetail).toHaveBeenCalledWith(run.id);
    });
    expect(await screen.findByText("0 of 1")).toBeVisible();
    expect(screen.getByText("In progress")).toBeVisible();
  });
});
