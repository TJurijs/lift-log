import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LiftLogApp from "../../app/LiftLogApp";
import { ActiveWorkoutDraftStore } from "../../lib/active-workout-draft-storage";
import { demoViewer } from "../../lib/auth";
import { demoWorkspace } from "../../lib/demo-data";
import type { ActiveSession, WorkspaceData } from "../../lib/domain";
import {
  SessionRevisionConflictError,
  type LiftLogRepository,
} from "../../lib/repository";
import { loadCachedActiveWorkoutWorkspace } from "../../app/features/active-workout/useActiveWorkoutPersistence";

function activeWorkoutFixture() {
  const scheduled = demoWorkspace.scheduledWorkouts[0];
  const workout = scheduled.workout;
  const item = workout.sections
    .flatMap((section) => section.items)
    .find((candidate) => candidate.mode === "sets");
  if (!item) throw new Error("Expected a set-based demo exercise");

  const activeSession: ActiveSession = {
    id: "reload-session",
    draftRevision: 7,
    workoutId: workout.id,
    programVersionId: workout.programVersionId ?? scheduled.programVersionId,
    scheduledWorkoutId: scheduled.id,
    itemLogIds: { [item.id]: "session-item-log-1" },
    setLogs: {
      [item.id]: [{ reps: "5", load: "", rpe: "" }],
    },
    resultLogs: {},
    sessionRpe: "7",
    sessionNote: "",
  };
  const workspace: WorkspaceData = {
    ...demoWorkspace,
    activeSession,
    scheduledWorkouts: demoWorkspace.scheduledWorkouts.map((candidate) =>
      candidate.id === scheduled.id
        ? { ...candidate, status: "in_progress" }
        : candidate,
    ),
  };
  return { activeSession, item, workspace };
}

function snapshotOf(session: ActiveSession) {
  return {
    setLogs: session.setLogs,
    resultLogs: session.resultLogs,
    sessionRpe: session.sessionRpe,
    sessionNote: session.sessionNote,
  };
}

function repositoryFor(activeSession: ActiveSession) {
  const saveSessionDraft = vi.fn(
    async (
      _session: ActiveSession,
      _setLogs: ActiveSession["setLogs"],
      _resultLogs: ActiveSession["resultLogs"],
      _sessionRpe: string,
      _sessionNote: string,
      expectedRevision: number,
    ) => ({ revision: expectedRevision + 1 }),
  );
  return {
    repository: {
      reloadActiveSession: vi.fn().mockResolvedValue(activeSession),
      saveSessionDraft,
    } as unknown as LiftLogRepository,
    saveSessionDraft,
  };
}

function renderWorkout(
  workspace: WorkspaceData,
  repository: LiftLogRepository,
) {
  return render(
    <LiftLogApp
      viewer={demoViewer}
      onSignOut={vi.fn()}
      initialWorkspace={workspace}
      repository={repository}
    />,
  );
}

async function waitForWorkoutEditing() {
  await waitFor(() =>
    expect(screen.getByPlaceholderText("What felt good? Anything to adjust next time?")).toBeEnabled(),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
});

describe("active workout reload recovery", () => {
  it("opens an editable cached workspace offline and restores its unconfirmed entries", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const { activeSession, workspace } = activeWorkoutFixture();
    const firstRepository = repositoryFor(activeSession);
    const firstRender = renderWorkout(workspace, firstRepository.repository);
    await waitForWorkoutEditing();
    fireEvent.change(screen.getByRole("textbox", { name: "Session notes optional" }), {
      target: { value: "Entries saved while offline" },
    });
    window.dispatchEvent(new Event("pagehide"));
    firstRender.unmount();

    const cachedWorkspace = await loadCachedActiveWorkoutWorkspace(demoViewer);
    expect(cachedWorkspace).not.toBeNull();
    expect(cachedWorkspace?.activeSession?.draftRevision).toBe(activeSession.draftRevision);
    expect(cachedWorkspace?.activeSession?.sessionNote).toBe(activeSession.sessionNote);
    const secondRepository = repositoryFor(activeSession);
    renderWorkout(cachedWorkspace!, secondRepository.repository);

    await waitForWorkoutEditing();
    expect(screen.getByRole("textbox", { name: "Session notes optional" })).toHaveValue("Entries saved while offline");
    expect(screen.getByText("Saved on this device · reconnect to sync", { exact: true })).toBeVisible();
    expect(secondRepository.repository.reloadActiveSession).not.toHaveBeenCalled();
    expect(firstRepository.saveSessionDraft).not.toHaveBeenCalled();
    expect(secondRepository.saveSessionDraft).not.toHaveBeenCalled();
  });

  it("restores a newer local snapshot even when the server revision advanced", async () => {
    const { activeSession, item, workspace } = activeWorkoutFixture();
    const store = new ActiveWorkoutDraftStore({ storage: window.localStorage });
    store.save(
      demoViewer.id,
      activeSession.id,
      activeSession.draftRevision - 1,
      {
        setLogs: {
          [item.id]: [{ reps: "5", load: "72", rpe: "8" }],
        },
        resultLogs: {},
        sessionRpe: "8",
        sessionNote: "Recovered after reload",
      },
      snapshotOf(activeSession),
    );
    const { repository, saveSessionDraft } = repositoryFor(activeSession);

    renderWorkout(workspace, repository);

    await waitFor(() =>
      expect(
        screen.getByLabelText(`${item.title}, set 1, load in kg`),
      ).toHaveValue("72"),
    );
    await waitFor(() => expect(saveSessionDraft).toHaveBeenCalledOnce(), {
      timeout: 2_000,
    });
    expect(saveSessionDraft.mock.calls[0]?.[1]).toEqual({
      [item.id]: [{ reps: "5", load: "72", rpe: "8" }],
    });
    expect(saveSessionDraft.mock.calls[0]?.[5]).toBe(7);
  });

  it("persists the latest input on page hide and restores it after a reload", async () => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });
    const { activeSession, item, workspace } = activeWorkoutFixture();
    const firstRepository = repositoryFor(activeSession);
    const firstRender = renderWorkout(workspace, firstRepository.repository);
    const loadInput = screen.getByLabelText(
      `${item.title}, set 1, load in kg`,
    );
    await waitFor(() =>
      expect(
        window.localStorage.getItem(
          `liftlog:active-workout-pointer:v1:${encodeURIComponent(demoViewer.id)}`,
        ),
      ).not.toBeNull(),
    );

    fireEvent.change(loadInput, { target: { value: "55" } });
    const immediateMirror = new ActiveWorkoutDraftStore({
      storage: window.localStorage,
    }).restore(demoViewer.id, activeSession.id, activeSession.draftRevision);
    expect(immediateMirror.status).toBe("restored");
    if (immediateMirror.status === "restored") {
      expect(immediateMirror.draft.snapshot.setLogs[item.id]?.[0]?.load).toBe(
        "55",
      );
    }
    window.dispatchEvent(new Event("pagehide"));
    firstRender.unmount();

    const secondRepository = repositoryFor(activeSession);
    renderWorkout(workspace, secondRepository.repository);
    await waitFor(() =>
      expect(
        screen.getByLabelText(`${item.title}, set 1, load in kg`),
      ).toHaveValue("55"),
    );
    expect(firstRepository.saveSessionDraft).not.toHaveBeenCalled();
    expect(secondRepository.saveSessionDraft).not.toHaveBeenCalled();
  });

  it("rebases a stale save and still allows the recovered workout to finish", async () => {
    const { activeSession, item, workspace } = activeWorkoutFixture();
    const authoritativeSession = { ...activeSession, draftRevision: 15 };
    let saveCall = 0;
    const saveSessionDraft = vi.fn(
      async (
        _session: ActiveSession,
        _setLogs: ActiveSession["setLogs"],
        _resultLogs: ActiveSession["resultLogs"],
        _sessionRpe: string,
        _sessionNote: string,
        expectedRevision: number,
      ) => {
        saveCall += 1;
        if (saveCall === 1) throw new SessionRevisionConflictError();
        return { revision: expectedRevision + 1 };
      },
    );
    const reloadActiveSession = vi
      .fn()
      .mockResolvedValue(authoritativeSession);
    const completeSession = vi.fn().mockResolvedValue(undefined);
    const loadWorkspace = vi.fn().mockResolvedValue({
      ...workspace,
      activeSession: null,
      scheduledWorkouts: workspace.scheduledWorkouts.map((scheduled) =>
        scheduled.id === activeSession.scheduledWorkoutId
          ? { ...scheduled, status: "completed" }
          : scheduled,
      ),
    });
    const repository = {
      completeSession,
      loadWorkspace,
      reloadActiveSession,
      saveSessionDraft,
    } as unknown as LiftLogRepository;

    renderWorkout(workspace, repository);
    await waitForWorkoutEditing();
    fireEvent.change(
      screen.getByLabelText(`${item.title}, set 1, load in kg`),
      { target: { value: "72" } },
    );

    await waitFor(() => expect(saveSessionDraft).toHaveBeenCalledTimes(2), {
      timeout: 3_000,
    });
    expect(saveSessionDraft.mock.calls[0]?.[5]).toBe(7);
    expect(saveSessionDraft.mock.calls[1]?.[5]).toBe(15);
    expect(reloadActiveSession).toHaveBeenCalledWith(activeSession.id);

    fireEvent.click(
      screen.getByRole("button", { name: "Finish and save session" }),
    );
    await waitFor(() => expect(completeSession).toHaveBeenCalledOnce(), {
      timeout: 2_000,
    });
    expect(completeSession.mock.calls[0]?.[3]).toBe(16);
  });

  it("merges unrelated server edits and asks before resolving a same-field conflict", async () => {
    const { activeSession, item, workspace } = activeWorkoutFixture();
    const base = snapshotOf(activeSession);
    const local = structuredClone(base);
    local.setLogs[item.id][0].load = "45";
    const authoritativeSession: ActiveSession = {
      ...activeSession,
      draftRevision: 8,
      setLogs: {
        [item.id]: [{ reps: "6", load: "50", rpe: "" }],
      },
    };
    const authoritativeWorkspace = {
      ...workspace,
      activeSession: authoritativeSession,
    };
    const store = new ActiveWorkoutDraftStore({ storage: window.localStorage });
    store.save(
      demoViewer.id,
      activeSession.id,
      activeSession.draftRevision,
      local,
      base,
    );
    const { repository, saveSessionDraft } = repositoryFor(
      authoritativeSession,
    );

    renderWorkout(authoritativeWorkspace, repository);

    expect(
      await screen.findByRole("heading", { name: "Workout changed elsewhere" }),
    ).toBeVisible();
    expect(saveSessionDraft).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Keep this device" }),
    );

    await waitFor(() => expect(saveSessionDraft).toHaveBeenCalledOnce(), {
      timeout: 2_000,
    });
    expect(saveSessionDraft.mock.calls[0]?.[1]).toEqual({
      [item.id]: [{ reps: "6", load: "45", rpe: "" }],
    });
    expect(saveSessionDraft.mock.calls[0]?.[5]).toBe(8);
  });

  it("recovers a conflict raised by the Finish flush without another click", async () => {
    const { activeSession, item, workspace } = activeWorkoutFixture();
    const authoritativeSession = { ...activeSession, draftRevision: 15 };
    const saveSessionDraft = vi
      .fn()
      .mockRejectedValueOnce(new SessionRevisionConflictError())
      .mockImplementation(
        async (
          _session: ActiveSession,
          _setLogs: ActiveSession["setLogs"],
          _resultLogs: ActiveSession["resultLogs"],
          _sessionRpe: string,
          _sessionNote: string,
          expectedRevision: number,
        ) => ({ revision: expectedRevision + 1 }),
      );
    const completeSession = vi.fn().mockResolvedValue(undefined);
    const repository = {
      completeSession,
      loadWorkspace: vi.fn().mockResolvedValue({
        ...workspace,
        activeSession: null,
      }),
      reloadActiveSession: vi.fn().mockResolvedValue(authoritativeSession),
      saveSessionDraft,
    } as unknown as LiftLogRepository;

    renderWorkout(workspace, repository);
    await waitForWorkoutEditing();
    fireEvent.change(
      screen.getByLabelText(`${item.title}, set 1, load in kg`),
      { target: { value: "72" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Finish and save session" }),
    );

    await waitFor(() => expect(completeSession).toHaveBeenCalledOnce(), {
      timeout: 2_000,
    });
    expect(saveSessionDraft).toHaveBeenCalledTimes(2);
    expect(saveSessionDraft.mock.calls[1]?.[5]).toBe(15);
    expect(completeSession.mock.calls[0]?.[3]).toBe(16);
  });

  it("replays the same completion token after an ambiguous response", async () => {
    const { activeSession, workspace } = activeWorkoutFixture();
    const { saveSessionDraft } = repositoryFor(activeSession);
    const completeSession = vi
      .fn()
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockResolvedValueOnce(undefined);
    const repository = {
      completeSession,
      loadWorkspace: vi.fn().mockResolvedValue({
        ...workspace,
        activeSession: null,
      }),
      reloadActiveSession: vi.fn().mockResolvedValue(activeSession),
      saveSessionDraft,
    } as unknown as LiftLogRepository;

    renderWorkout(workspace, repository);
    await waitForWorkoutEditing();
    fireEvent.click(
      screen.getByRole("button", { name: "Finish and save session" }),
    );
    await waitFor(() => expect(completeSession).toHaveBeenCalledOnce());

    fireEvent.click(
      screen.getByRole("button", { name: "Finish and save session" }),
    );
    await waitFor(() => expect(completeSession).toHaveBeenCalledTimes(2));

    expect(saveSessionDraft).not.toHaveBeenCalled();
    expect(completeSession.mock.calls[1]?.[3]).toBe(
      completeSession.mock.calls[0]?.[3],
    );
    expect(completeSession.mock.calls[1]?.[4]).toBe(
      completeSession.mock.calls[0]?.[4],
    );
  });

  it("leaves the completed UI and clears recovery even if workspace refresh fails", async () => {
    const { activeSession, workspace } = activeWorkoutFixture();
    const { saveSessionDraft } = repositoryFor(activeSession);
    const repository = {
      completeSession: vi.fn().mockResolvedValue(undefined),
      loadWorkspace: vi.fn().mockRejectedValue(new Error("Failed to fetch")),
      reloadActiveSession: vi.fn().mockResolvedValue(activeSession),
      saveSessionDraft,
    } as unknown as LiftLogRepository;
    renderWorkout(workspace, repository);
    await waitFor(async () =>
      expect(await loadCachedActiveWorkoutWorkspace(demoViewer)).not.toBeNull(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Finish and save session" }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Finish and save session" }),
      ).not.toBeInTheDocument(),
    );
    expect(await loadCachedActiveWorkoutWorkspace(demoViewer)).toBeNull();
  });

  it("clears an abandoned active draft before an optional workspace refresh", async () => {
    const { activeSession, workspace } = activeWorkoutFixture();
    const repository = {
      loadWorkspace: vi.fn().mockRejectedValue(new Error("Failed to fetch")),
      reloadActiveSession: vi.fn().mockResolvedValue(activeSession),
      saveSessionDraft: vi.fn(),
      setScheduledWorkoutStatus: vi.fn().mockResolvedValue(undefined),
    } as unknown as LiftLogRepository;
    renderWorkout(workspace, repository);
    await waitForWorkoutEditing();
    fireEvent.click(
      screen.getByRole("button", { name: "Set back to planned" }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Finish and save session" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      repository.setScheduledWorkoutStatus,
    ).toHaveBeenCalledWith(activeSession.scheduledWorkoutId, "planned");
    expect(await loadCachedActiveWorkoutWorkspace(demoViewer)).toBeNull();
  });

  it("warns instead of claiming local recovery when browser storage fails", async () => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    const { activeSession, item, workspace } = activeWorkoutFixture();
    const { repository } = repositoryFor(activeSession);

    renderWorkout(workspace, repository);
    fireEvent.change(
      screen.getByLabelText(`${item.title}, set 1, load in kg`),
      { target: { value: "55" } },
    );

    expect(
      await screen.findByText(
        "Not saved yet · keep this page open and reconnect",
      ),
    ).toBeVisible();
  });
});
