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
