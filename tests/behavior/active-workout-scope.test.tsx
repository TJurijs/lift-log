import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  useActiveWorkoutPersistence,
  type UseActiveWorkoutPersistenceOptions,
} from "../../app/features/active-workout/useActiveWorkoutPersistence";
import {
  ActiveWorkoutLocalController,
  materializeActiveWorkoutEntry,
  WebStorageActiveWorkoutCache,
} from "../../lib/active-workout-local";
import { ActiveWorkoutDraftStore } from "../../lib/active-workout-draft-storage";
import { demoWorkspace } from "../../lib/demo-data";
import type { ActiveSession } from "../../lib/domain";
import { SessionRevisionConflictError, type LiftLogRepository } from "../../lib/repository";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function fixture(sessionId: string) {
  const schedule = demoWorkspace.scheduledWorkouts[0];
  const session: ActiveSession = {
    id: sessionId,
    draftRevision: 0,
    workoutId: schedule.workout.id,
    programVersionId: schedule.programVersionId,
    scheduledWorkoutId: schedule.id,
    itemLogIds: {},
    setLogs: {},
    resultLogs: {},
    sessionRpe: "",
    sessionNote: sessionId,
  };
  const saveSessionDraft = vi.fn().mockResolvedValue({ revision: 1 });
  const reloadActiveSession = vi.fn().mockResolvedValue(session);
  const options: UseActiveWorkoutPersistenceOptions = {
    userId: "scope-test-user",
    session,
    workout: schedule.workout,
    schedule,
    profile: demoWorkspace.profile,
    repository: { saveSessionDraft, reloadActiveSession } as unknown as LiftLogRepository,
    snapshot: {
      setLogs: session.setLogs,
      resultLogs: session.resultLogs,
      sessionRpe: session.sessionRpe,
      sessionNote: session.sessionNote,
    },
    onApplySnapshot: vi.fn(),
    onSessionRefresh: vi.fn(),
    onRevisionConfirmed: vi.fn(),
    onSyncError: vi.fn(),
  };
  return { options, saveSessionDraft, reloadActiveSession };
}

async function savedNote(sessionId: string) {
  const entry = await new WebStorageActiveWorkoutCache(window.localStorage).load("scope-test-user", sessionId);
  return entry ? materializeActiveWorkoutEntry(entry).snapshot.sessionNote : undefined;
}

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});

describe("active workout operation scope", () => {
  it("shows saving throughout debounce and restores saved only after acknowledgement", async () => {
    const current = fixture("save-status");
    const acknowledgement = deferred<{ revision: number }>();
    current.saveSessionDraft.mockReturnValue(acknowledgement.promise);
    const { result, rerender } = renderHook(useActiveWorkoutPersistence, { initialProps: current.options });
    await waitFor(() => expect(result.current.editable).toBe(true));
    expect(result.current.status).toBe("saved");

    rerender({ ...current.options, snapshot: { ...current.options.snapshot } });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.status).toBe("saved");
    expect(current.saveSessionDraft).not.toHaveBeenCalled();

    rerender({ ...current.options, snapshot: { ...current.options.snapshot, sessionNote: "Unconfirmed edit" } });
    await waitFor(async () => expect(await savedNote("save-status")).toBe("Unconfirmed edit"));
    expect(result.current.status).toBe("saving");
    expect(current.saveSessionDraft).not.toHaveBeenCalled();

    let flush!: Promise<number>;
    act(() => { flush = result.current.flush(); });
    await waitFor(() => expect(current.saveSessionDraft).toHaveBeenCalledOnce());
    expect(result.current.status).toBe("saving");
    await act(async () => { acknowledgement.resolve({ revision: 1 }); await flush; });
    expect(result.current.status).toBe("saved");
  });

  it("keeps the newest synchronous recovery copy until that edit is durable", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const current = fixture("queued-local-edits");
    const firstWrite = deferred<void>();
    const secondWrite = deferred<void>();
    const applyPatch = ActiveWorkoutLocalController.prototype.applyPatch;
    const patchSpy = vi.spyOn(ActiveWorkoutLocalController.prototype, "applyPatch")
      .mockImplementation(async function (this: ActiveWorkoutLocalController, change) {
        if (change.type === "set-session-note") {
          await (change.value === "First edit" ? firstWrite : secondWrite).promise;
        }
        return applyPatch.call(this, change);
      });
    const { result, rerender } = renderHook(useActiveWorkoutPersistence, { initialProps: current.options });
    await waitFor(() => expect(result.current.editable).toBe(true));
    const store = new ActiveWorkoutDraftStore({ storage: window.localStorage });

    rerender({ ...current.options, snapshot: { ...current.options.snapshot, sessionNote: "First edit" } });
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    rerender({ ...current.options, snapshot: { ...current.options.snapshot, sessionNote: "Newest edit" } });
    await act(async () => { firstWrite.resolve(); });
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(2));

    expect(await savedNote("queued-local-edits")).toBe("First edit");
    expect(store.restore(current.options.userId, "queued-local-edits", 0)).toMatchObject({
      status: "restored",
      draft: { snapshot: { sessionNote: "Newest edit" } },
    });

    await act(async () => { secondWrite.resolve(); });
    await waitFor(async () => expect(await savedNote("queued-local-edits")).toBe("Newest edit"));
    expect(store.restore(current.options.userId, "queued-local-edits", 0)).toEqual({ status: "missing" });
    patchSpy.mockRestore();
  });

  it("keeps a newer confirmed cache revision when bootstrap raced an acknowledged save", async () => {
    const current = fixture("stale-bootstrap");
    const session = current.options.session!;
    const controller = new ActiveWorkoutLocalController({
      userId: current.options.userId,
      sessionId: session.id,
      cache: new WebStorageActiveWorkoutCache(window.localStorage),
    });
    await controller.initialize({
      session: {
        id: session.id,
        workoutId: session.workoutId,
        programVersionId: session.programVersionId,
        scheduledWorkoutId: session.scheduledWorkoutId,
        itemLogIds: session.itemLogIds,
      },
      serverRevision: 0,
      serverSnapshot: current.options.snapshot,
    });
    await controller.applyPatch({ type: "set-session-note", value: "New confirmed entries" });
    const mutation = await controller.preparePendingMutation();
    await controller.acknowledgeMutation(mutation!.idempotencyKey, 1);
    controller.dispose();

    const { result } = renderHook(useActiveWorkoutPersistence, { initialProps: current.options });

    await waitFor(() => expect(result.current.editable).toBe(true));
    expect(current.options.onApplySnapshot).toHaveBeenLastCalledWith(expect.objectContaining({ sessionNote: "New confirmed entries" }));
    expect(current.options.onSyncError).not.toHaveBeenCalled();
    expect(current.saveSessionDraft).not.toHaveBeenCalled();
  });

  it("mirrors the controller's confirmed snapshot and revision after saving", async () => {
    const current = fixture("confirmed-mirror-base");
    const { result, rerender } = renderHook(useActiveWorkoutPersistence, { initialProps: current.options });
    await waitFor(() => expect(result.current.editable).toBe(true));
    const savedSnapshot = { ...current.options.snapshot, sessionNote: "Server-confirmed note" };
    rerender({ ...current.options, snapshot: savedSnapshot });
    await act(async () => { await result.current.flush(); });

    // The shell updates the session's revision without replacing its original
    // form fields. The controller owns the exact snapshot confirmed by the save.
    const write = deferred<void>();
    const applyPatch = ActiveWorkoutLocalController.prototype.applyPatch;
    const patchSpy = vi.spyOn(ActiveWorkoutLocalController.prototype, "applyPatch")
      .mockImplementation(async function (this: ActiveWorkoutLocalController, change) {
        await write.promise;
        return applyPatch.call(this, change);
      });
    rerender({
      ...current.options,
      session: { ...current.options.session!, draftRevision: 1 },
      snapshot: { ...savedSnapshot, sessionNote: "Next unsaved note" },
    });
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));

    const mirrored = new ActiveWorkoutDraftStore({ storage: window.localStorage })
      .restore(current.options.userId, "confirmed-mirror-base", 1);
    expect(mirrored).toMatchObject({
      status: "restored",
      draft: { baseRevision: 1, baseSnapshot: savedSnapshot, snapshot: { sessionNote: "Next unsaved note" } },
    });
    await act(async () => { write.resolve(); });
    patchSpy.mockRestore();
  });

  it("blocks a second writer and restores the first tab's offline edits after takeover", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const first = fixture("shared-workout");
    const second = fixture("shared-workout");
    const firstTab = renderHook(useActiveWorkoutPersistence, { initialProps: first.options });
    await waitFor(() => expect(firstTab.result.current.editable).toBe(true));
    firstTab.rerender({ ...first.options, snapshot: { ...first.options.snapshot, sessionNote: "First tab's offline entries" } });
    await waitFor(async () => expect(await savedNote("shared-workout")).toBe("First tab's offline entries"));

    const secondTab = renderHook(useActiveWorkoutPersistence, { initialProps: second.options });
    await waitFor(() => expect(secondTab.result.current.editingBlockedReason).toMatch(/another tab/));
    expect(secondTab.result.current.editable).toBe(false);
    secondTab.rerender({ ...second.options, snapshot: { ...second.options.snapshot, sessionNote: "Unaccepted second-tab change" } });
    await act(async () => { await Promise.resolve(); });
    expect(await savedNote("shared-workout")).toBe("First tab's offline entries");
    expect(second.options.onApplySnapshot).not.toHaveBeenCalled();
    await expect(secondTab.result.current.flush()).rejects.toMatchObject({ name: "AbortError" });
    await expect(secondTab.result.current.clearAfterCompletion("shared-workout")).rejects.toMatchObject({ name: "AbortError" });
    expect(await savedNote("shared-workout")).toBe("First tab's offline entries");

    firstTab.unmount();
    act(() => secondTab.result.current.retryEditing());
    await waitFor(() => expect(secondTab.result.current.editable).toBe(true));
    expect(second.options.onApplySnapshot).toHaveBeenLastCalledWith(expect.objectContaining({ sessionNote: "First tab's offline entries" }));
    expect(secondTab.result.current.editingBlockedReason).toBeNull();
    expect(first.saveSessionDraft).not.toHaveBeenCalled();
    expect(second.saveSessionDraft).not.toHaveBeenCalled();
  });

  it("releases a failed initialization's lease so another tab can recover", async () => {
    const first = fixture("initialization-failure");
    const second = fixture("initialization-failure");
    vi.spyOn(ActiveWorkoutLocalController.prototype, "initialize").mockRejectedValueOnce(new Error("Cache unavailable"));
    const firstTab = renderHook(useActiveWorkoutPersistence, { initialProps: first.options });
    await waitFor(() => expect(firstTab.result.current.editingBlockedReason).toMatch(/saved data could not be opened/));

    const secondTab = renderHook(useActiveWorkoutPersistence, { initialProps: second.options });
    await waitFor(() => expect(secondTab.result.current.editable).toBe(true));
    firstTab.rerender({ ...first.options, snapshot: { ...first.options.snapshot, sessionNote: "Rejected after failure" } });
    await act(async () => { await Promise.resolve(); });

    expect(await savedNote("initialization-failure")).toBe("initialization-failure");
    act(() => firstTab.result.current.retryEditing());
    await waitFor(() => expect(firstTab.result.current.editingBlockedReason).toMatch(/another tab/));
    expect(secondTab.result.current.editable).toBe(true);
  });

  it("keeps the writer lease until an in-flight save from the closing tab settles", async () => {
    const first = fixture("closing-workout");
    const second = fixture("closing-workout");
    const save = deferred<{ revision: number }>();
    first.saveSessionDraft.mockReturnValue(save.promise);
    const firstTab = renderHook(useActiveWorkoutPersistence, { initialProps: first.options });
    await waitFor(() => expect(firstTab.result.current.editable).toBe(true));
    firstTab.rerender({ ...first.options, snapshot: { ...first.options.snapshot, sessionNote: "Saving before takeover" } });
    let flush!: Promise<unknown>;
    act(() => { flush = firstTab.result.current.flush().catch((error: unknown) => error); });
    await waitFor(() => expect(first.saveSessionDraft).toHaveBeenCalledTimes(1));
    firstTab.unmount();

    const secondTab = renderHook(useActiveWorkoutPersistence, { initialProps: second.options });
    await act(async () => { await Promise.resolve(); });
    expect(secondTab.result.current.editable).toBe(false);
    expect(second.options.onApplySnapshot).not.toHaveBeenCalled();
    await act(async () => { save.resolve({ revision: 1 }); });

    expect(await flush).toMatchObject({ name: "AbortError" });
    await waitFor(() => expect(secondTab.result.current.editable).toBe(true));
    expect(second.options.onApplySnapshot).toHaveBeenLastCalledWith(expect.objectContaining({ sessionNote: "Saving before takeover" }));
  });

  it("keeps a cancelled initialization's entries separate from the next workout", async () => {
    const first = fixture("initializing-workout");
    const next = fixture("next-workout");
    const initialization = deferred<void>();
    const initialize = ActiveWorkoutLocalController.prototype.initialize;
    const initializeSpy = vi.spyOn(ActiveWorkoutLocalController.prototype, "initialize").mockImplementation(async function (this: ActiveWorkoutLocalController, seed) {
      if (seed.session.id === first.options.session?.id) await initialization.promise;
      return initialize.call(this, seed);
    });
    const { rerender } = renderHook(useActiveWorkoutPersistence, { initialProps: first.options });
    await waitFor(() => expect(initializeSpy).toHaveBeenCalledTimes(1));

    rerender(next.options);
    await waitFor(() => expect(next.options.onApplySnapshot).toHaveBeenCalled());
    await act(async () => { initialization.resolve(); });

    await waitFor(async () => expect(await savedNote("initializing-workout")).toBe("initializing-workout"));
    expect(await savedNote("next-workout")).toBe("next-workout");
    expect(first.options.onApplySnapshot).not.toHaveBeenCalled();
    expect(next.options.onSyncError).not.toHaveBeenCalled();
  });

  it("does not reconcile a late save conflict against a different workout", async () => {
    const first = fixture("saving-workout");
    const next = fixture("replacement-workout");
    const save = deferred<{ revision: number }>();
    first.saveSessionDraft.mockReturnValue(save.promise);
    const { result, rerender } = renderHook(useActiveWorkoutPersistence, { initialProps: first.options });
    await waitFor(() => expect(first.options.onApplySnapshot).toHaveBeenCalled());
    rerender({ ...first.options, snapshot: { ...first.options.snapshot, sessionNote: "Unsynced first workout" } });
    let flush!: Promise<unknown>;
    act(() => { flush = result.current.flush().catch((error: unknown) => error); });
    await waitFor(() => expect(first.saveSessionDraft).toHaveBeenCalledTimes(1));

    rerender(next.options);
    await waitFor(() => expect(next.options.onApplySnapshot).toHaveBeenCalled());
    await act(async () => { save.reject(new SessionRevisionConflictError()); });

    expect(await flush).toMatchObject({ name: "AbortError" });
    expect(next.reloadActiveSession).not.toHaveBeenCalled();
    expect(next.options.onRevisionConfirmed).not.toHaveBeenCalled();
    expect(next.options.onSyncError).not.toHaveBeenCalled();
    expect(await savedNote("replacement-workout")).toBe("replacement-workout");
  });

  it("does not disable a new workout when the completed workout finishes clearing", async () => {
    const first = fixture("finishing-workout");
    const next = fixture("after-completion");
    const deletion = deferred<void>();
    const clear = WebStorageActiveWorkoutCache.prototype.deleteSession;
    const clearSpy = vi.spyOn(WebStorageActiveWorkoutCache.prototype, "deleteSession")
      .mockImplementation(async function (this: WebStorageActiveWorkoutCache, userId, sessionId) {
        if (sessionId === "finishing-workout") await deletion.promise;
        return clear.call(this, userId, sessionId);
      });
    const { result, rerender } = renderHook(useActiveWorkoutPersistence, { initialProps: first.options });
    await waitFor(() => expect(result.current.editable).toBe(true));
    let completing!: Promise<void>;
    act(() => { completing = result.current.clearAfterCompletion("finishing-workout"); });
    await waitFor(() => expect(clearSpy).toHaveBeenCalledTimes(1));

    rerender(next.options);
    await waitFor(() => expect(result.current.editable).toBe(true));
    await act(async () => { deletion.resolve(); await completing; });

    expect(result.current.editable).toBe(true);
    expect(next.options.onSyncError).not.toHaveBeenCalled();
    expect(await savedNote("after-completion")).toBe("after-completion");
    clearSpy.mockRestore();
  });

  it("retains the writer lease until completion cleanup settles", async () => {
    const first = fixture("completion-lease");
    const next = fixture("completion-lease");
    const deletion = deferred<void>();
    const clear = WebStorageActiveWorkoutCache.prototype.deleteSession;
    const clearSpy = vi.spyOn(WebStorageActiveWorkoutCache.prototype, "deleteSession")
      .mockImplementationOnce(async function (this: WebStorageActiveWorkoutCache, userId, sessionId) {
        await deletion.promise;
        return clear.call(this, userId, sessionId);
      });
    const firstTab = renderHook(useActiveWorkoutPersistence, { initialProps: first.options });
    await waitFor(() => expect(firstTab.result.current.editable).toBe(true));
    let completing!: Promise<void>;
    act(() => { completing = firstTab.result.current.clearAfterCompletion("completion-lease"); });
    await waitFor(() => expect(clearSpy).toHaveBeenCalledTimes(1));
    firstTab.unmount();

    const nextTab = renderHook(useActiveWorkoutPersistence, { initialProps: next.options });
    await act(async () => { await Promise.resolve(); });
    expect(nextTab.result.current.editable).toBe(false);
    expect(next.options.onApplySnapshot).not.toHaveBeenCalled();
    await act(async () => { deletion.resolve(); await completing; });

    await waitFor(() => expect(nextTab.result.current.editable).toBe(true));
    expect(await savedNote("completion-lease")).toBe("completion-lease");
    expect(next.options.onSyncError).not.toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it("flushes continuing edits without treating successful writes as conflicts", async () => {
    const current = fixture("continuing-workout");
    const saves = Array.from({ length: 4 }, () => deferred<{ revision: number }>());
    let saveIndex = 0;
    current.saveSessionDraft.mockImplementation(() => saves[saveIndex++].promise);
    const { result, rerender } = renderHook(useActiveWorkoutPersistence, { initialProps: current.options });
    await waitFor(() => expect(current.options.onApplySnapshot).toHaveBeenCalled());
    rerender({ ...current.options, snapshot: { ...current.options.snapshot, sessionNote: "Edit 1" } });
    let flush!: Promise<unknown>;
    act(() => { flush = result.current.flush().catch((error: unknown) => error); });
    await waitFor(() => expect(current.saveSessionDraft).toHaveBeenCalledTimes(1));

    for (let index = 1; index < saves.length; index += 1) {
      rerender({ ...current.options, snapshot: { ...current.options.snapshot, sessionNote: `Edit ${index + 1}` } });
      await waitFor(async () => expect(await savedNote("continuing-workout")).toBe(`Edit ${index + 1}`));
      await act(async () => { saves[index - 1].resolve({ revision: index }); });
      await waitFor(() => expect(current.saveSessionDraft).toHaveBeenCalledTimes(index + 1));
    }
    await act(async () => { saves[3].resolve({ revision: 4 }); });

    expect(await flush).toBe(4);
    expect(result.current.status).toBe("saved");
    expect(current.reloadActiveSession).not.toHaveBeenCalled();
    expect(current.saveSessionDraft.mock.calls.map((call) => call[5])).toEqual([0, 1, 2, 3]);
    expect(current.saveSessionDraft.mock.calls[3][4]).toBe("Edit 4");
  });
});
