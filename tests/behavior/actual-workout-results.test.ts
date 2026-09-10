import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { starterSetLogs, useActiveWorkoutForm } from "../../app/features/active-workout/useActiveWorkoutForm";
import { completeDemoWorkout, createDemoWorkoutSession } from "../../app/features/active-workout/demo-workout";
import { diffActiveWorkoutSnapshots } from "../../app/features/active-workout/useActiveWorkoutPersistence";
import { demoWorkspace } from "../../lib/demo-data";
import { buildSessionDraftPayload, LiftLogRepository, normalizeSessionDraftSnapshot, SessionRevisionConflictError } from "../../lib/repository";
import { distanceKilometresValue } from "../../lib/units";
import { ActiveWorkoutDraftStore } from "../../lib/active-workout-draft-storage";
import { activeWorkoutSnapshotsEqual, applyActiveWorkoutPatch, isActiveWorkoutDraftSnapshot } from "../../lib/active-workout-local-types";
import { mergeActiveWorkoutDraftSnapshots } from "../../lib/active-workout-draft-merge";
import { ActiveWorkoutLocalController } from "../../lib/active-workout-local-controller";
import { MemoryActiveWorkoutCache } from "../../lib/active-workout-cache";

function schedule() {
  const value = structuredClone(demoWorkspace.scheduledWorkouts[0]);
  value.workout.sections[0].items = [{
    ...value.workout.sections[0].items[0], id: "plank", title: "Plank", mode: "sets",
    fields: ["duration"], prescription: { sets: 3, durationMinutes: 0.5, reps: "12", loadKg: 50, targetRpe: "8" },
  }];
  value.workout.sections = [value.workout.sections[0]];
  return value;
}

function blankSnapshot() {
  return { setLogs: { plank: [{ reps: "", load: "", rpe: "", duration: "", distance: "", heartRate: "" }] }, resultLogs: {}, sessionRpe: "", sessionNote: "" };
}

describe("actual workout results", () => {
  it("starts every actual blank, preserves planned row counts, and never copies targets after a note edit", () => {
    const planned = schedule();
    const session = createDemoWorkoutSession(planned);
    expect(session.setLogs.plank).toEqual(Array.from({ length: 3 }, () => ({ reps: "", load: "", rpe: "", duration: "" })));
    expect(session.sessionRpe).toBe("");
    const { result } = renderHook(() => useActiveWorkoutForm(session, planned.workout));
    act(() => result.current.setSessionNote("Only a note"));
    const payload = buildSessionDraftPayload(session, result.current.setLogs, result.current.resultLogs, result.current.sessionRpe, result.current.sessionNote);
    expect(payload.sessionRpe).toBeNull();
    expect(payload.items[0].entries.every((entry) => Object.entries(entry).every(([key, value]) => key === "position" || value === null))).toBe(true);
  });

  it("keeps resumed real results without replacing them with new exercise defaults", () => {
    const planned = schedule();
    const session = createDemoWorkoutSession(planned);
    session.setLogs.plank = [{ reps: "0", load: "", rpe: "6", duration: "0.75" }];
    session.sessionRpe = "6";
    expect(starterSetLogs(planned.workout, session)).toBe(session.setLogs);
    const { result } = renderHook(() => useActiveWorkoutForm(session, planned.workout));
    expect(result.current.setLogs).toEqual(session.setLogs);
    expect(result.current.sessionRpe).toBe("6");
  });

  it("persists timed and distance sets in canonical units, masking stale untracked inputs", () => {
    const session = createDemoWorkoutSession(schedule());
    session.itemFields!.plank = ["duration", "distance", "heartRate", "load"];
    const payload = buildSessionDraftPayload(session, { plank: [
      { reps: "12", load: "0", rpe: "8", duration: "0.5", distance: distanceKilometresValue("1", "mi"), heartRate: "130" },
      { reps: "", load: " ", rpe: "", duration: "0", distance: "", heartRate: "" },
    ] }, {}, "", "");
    expect(payload.items[0].entries).toEqual([
      { position: 0, reps: null, loadKg: 0, durationSeconds: 30, distanceMetres: 1609.344, rounds: null, heartRate: 130, rpe: null },
      { position: 1, reps: null, loadKg: null, durationSeconds: 0, distanceMetres: null, rounds: null, heartRate: null, rpe: null },
    ]);
  });

  it("masks untracked single-result and interval values as well", () => {
    const session = createDemoWorkoutSession(schedule());
    const result = buildSessionDraftPayload(session, {}, { plank: { duration: "0.5", load: "20", rpe: "8" } }, "", "");
    expect(result.items[0].entries[0]).toMatchObject({ durationSeconds: 30, loadKg: null, rpe: null });
    const rounds = buildSessionDraftPayload(session, {}, { plank: { "round.0.duration": "30", "round.0.distance": "2", "round.0.rpe": "8" } }, "", "");
    expect(rounds.items[0].entries[0]).toMatchObject({ durationSeconds: 30, distanceMetres: null, rpe: null });
  });

  it("uses the same tracked actuals for demo history without target fallback", () => {
    const planned = schedule();
    const session = createDemoWorkoutSession(planned);
    const snapshot = blankSnapshot();
    snapshot.setLogs.plank[0] = { reps: "12", load: "20", rpe: "8", duration: "0.5", distance: "2", heartRate: "140" };
    const completed = completeDemoWorkout(session, planned, snapshot);
    expect(completed.items[0].entries).toEqual([{ position: 0, durationMinutes: 0.5 }]);
  });

  it("retains both the exercise cue and workout-specific instructions in demo history", () => {
    const planned = schedule();
    const movement = planned.workout.sections[0].items[0];
    movement.cue = "Keep a steady position.";
    movement.prescription.targetText = "2 + 1: two repetitions, then one hold.";
    const session = createDemoWorkoutSession(planned);
    const completed = completeDemoWorkout(session, planned, blankSnapshot());
    expect(completed.items[0].cue).toBe("Keep a steady position.\n2 + 1: two repetitions, then one hold.");
    expect(completed.items[0].entries[0].reps).toBeUndefined();
  });

  it("records interval completion only for the explicit completed marker in repository and demo history", () => {
    const planned = schedule();
    const movement = planned.workout.sections[0].items[0];
    movement.mode = "intervals";
    movement.fields = ["rounds", "duration"];
    movement.prescription = { rounds: 3, workSeconds: 30 };
    const session = createDemoWorkoutSession(planned);
    const resultLogs = { plank: {
      "round.0.completed": "0", "round.0.duration": "30",
      "round.1.completed": "1", "round.1.duration": "30",
      "round.2.completed": "", "round.2.duration": "30",
    } };
    const payload = buildSessionDraftPayload(session, {}, resultLogs, "", "");
    expect(payload.items[0].entries.map((entry) => entry.rounds)).toEqual([null, 1, null]);
    expect(payload.items[0].entries.map((entry) => entry.durationSeconds)).toEqual([30, 30, 30]);
    const completed = completeDemoWorkout(session, planned, { setLogs: {}, resultLogs, sessionRpe: "", sessionNote: "" });
    expect(completed.items[0].entries.map((entry) => entry.rounds)).toEqual([undefined, 1, undefined]);
    expect(completed.items[0].entries.map((entry) => entry.durationMinutes)).toEqual([0.5, 0.5, 0.5]);
  });

  it("journals, restores, and merges new set fields without losing blank-versus-zero", () => {
    const base = blankSnapshot();
    const local = structuredClone(base);
    local.setLogs.plank[0].duration = "0.5";
    local.setLogs.plank[0].distance = "0";
    const remote = structuredClone(base);
    remote.setLogs.plank[0].heartRate = "120";
    expect(isActiveWorkoutDraftSnapshot(local)).toBe(true);
    expect(activeWorkoutSnapshotsEqual(base, local)).toBe(false);
    const patches = diffActiveWorkoutSnapshots(base, local);
    expect(patches).toHaveLength(2);
    expect(patches.reduce(applyActiveWorkoutPatch, base)).toEqual(local);
    const merged = mergeActiveWorkoutDraftSnapshots(base, local, remote);
    expect(merged.conflicts).toEqual([]);
    expect(merged.snapshot.setLogs.plank[0]).toMatchObject({ duration: "0.5", distance: "0", heartRate: "120" });
    const store = new ActiveWorkoutDraftStore({ storage: window.localStorage });
    expect(store.save("results-test", "timed", 1, merged.snapshot, base)).toBe(true);
    expect(store.restore("results-test", "timed", 1)).toMatchObject({ status: "restored", draft: { snapshot: merged.snapshot } });
    store.clearAfterCompletion("results-test", "timed");
  });

  it("preserves old set drafts that omit optional metrics", () => {
    const legacy = { ...blankSnapshot(), setLogs: { plank: [{ reps: "5", load: "0", rpe: "" }] } };
    expect(isActiveWorkoutDraftSnapshot(legacy)).toBe(true);
    expect(activeWorkoutSnapshotsEqual(legacy, { ...legacy, setLogs: { plank: [{ ...legacy.setLogs.plank[0], duration: "", distance: "", heartRate: "" }] } })).toBe(true);
  });

  it("creates exactly one confirmed empty initial draft when finish explicitly requires it", async () => {
    const controller = new ActiveWorkoutLocalController({ cache: new MemoryActiveWorkoutCache(), userId: "actual-test", sessionId: "empty-session", createIdempotencyKey: () => "first-blank-write" });
    const blank = blankSnapshot();
    await controller.initialize({ session: { id: "empty-session", workoutId: "workout", programVersionId: "version" }, plan: {}, serverRevision: 0, serverSnapshot: blank });
    expect(await controller.preparePendingMutation()).toBeNull();
    const pending = await controller.preparePendingMutation({ requireInitialSave: true });
    expect(pending).toMatchObject({ expectedRevision: 0, snapshot: blank });
    expect(await controller.preparePendingMutation({ requireInitialSave: true })).toEqual(pending);
    await controller.acknowledgeMutation(pending!.idempotencyKey, 1);
    expect(await controller.preparePendingMutation({ requireInitialSave: true })).toBeNull();
    expect(controller.getSnapshot()).toMatchObject({ confirmedRevision: 1, confirmedSnapshot: blank, dirty: false });
    controller.dispose();
  });

  it("confirms server precision and masked fields exactly so a same-revision reload stays editable", async () => {
    const session = createDemoWorkoutSession(schedule());
    const cache = new MemoryActiveWorkoutCache();
    const controller = new ActiveWorkoutLocalController({ cache, userId: "normalization-test", sessionId: session.id, createIdempotencyKey: () => "rounded-write" });
    const blank = blankSnapshot();
    await controller.initialize({ session: { id: session.id, workoutId: session.workoutId, programVersionId: session.programVersionId }, plan: {}, serverRevision: 1, serverSnapshot: blank });
    await controller.applyPatch({ type: "set-set-field", itemId: "plank", index: 0, field: "duration", value: String(30.5 / 60) });
    await controller.applyPatch({ type: "set-set-field", itemId: "plank", index: 0, field: "load", value: "20" });
    const pending = (await controller.preparePendingMutation())!;
    const canonical = normalizeSessionDraftSnapshot(session, pending.snapshot);
    expect(canonical.setLogs.plank[0]).toEqual({ reps: "", load: "", rpe: "", duration: String(31 / 60) });
    await controller.acknowledgeMutation(pending.idempotencyKey, 2, canonical);
    expect(controller.getSnapshot()).toMatchObject({ dirty: false, confirmedSnapshot: canonical, snapshot: canonical });
    controller.dispose();
    const reloaded = new ActiveWorkoutLocalController({ cache, userId: "normalization-test", sessionId: session.id });
    await reloaded.hydrate();
    await expect(reloaded.reconcileAuthoritative(2, canonical, pending.idempotencyKey)).resolves.toMatchObject({ dirty: false, revisionConflict: null });
    reloaded.dispose();
  });

  it("keeps edits made during an in-flight normalization while storing the precise confirmed server base", async () => {
    const session = createDemoWorkoutSession(schedule());
    const controller = new ActiveWorkoutLocalController({ cache: new MemoryActiveWorkoutCache(), userId: "normalization-race", sessionId: session.id, createIdempotencyKey: () => "normalization-race-write" });
    await controller.initialize({ session: { id: session.id, workoutId: session.workoutId, programVersionId: session.programVersionId }, plan: {}, serverRevision: 1, serverSnapshot: blankSnapshot() });
    await controller.applyPatch({ type: "set-set-field", itemId: "plank", index: 0, field: "duration", value: String(30.5 / 60) });
    const pending = (await controller.preparePendingMutation())!;
    const canonical = normalizeSessionDraftSnapshot(session, pending.snapshot);
    await controller.applyPatch({ type: "set-set-field", itemId: "plank", index: 0, field: "duration", value: "0.75" });
    await controller.applyPatch({ type: "set-session-note", value: "Typed while saving" });
    const acknowledged = await controller.acknowledgeMutation(pending.idempotencyKey, 2, canonical);
    expect(acknowledged).toMatchObject({ dirty: true, revisionConflict: null, confirmedSnapshot: canonical, snapshot: { setLogs: { plank: [{ duration: "0.75" }] }, sessionNote: "Typed while saving" } });
    await expect(controller.reconcileAuthoritative(2, canonical, pending.idempotencyKey)).resolves.toMatchObject({ dirty: true, revisionConflict: null, snapshot: { sessionNote: "Typed while saving" } });
    controller.dispose();
  });

  it("recovers a normalized ambiguous write by its token without treating later local edits as a remote conflict", async () => {
    const session = createDemoWorkoutSession(schedule());
    const controller = new ActiveWorkoutLocalController({ cache: new MemoryActiveWorkoutCache(), userId: "ambiguous-normalization", sessionId: session.id, createIdempotencyKey: () => "ambiguous-rounded-write" });
    await controller.initialize({ session: { id: session.id, workoutId: session.workoutId, programVersionId: session.programVersionId }, plan: {}, serverRevision: 1, serverSnapshot: blankSnapshot() });
    await controller.applyPatch({ type: "set-set-field", itemId: "plank", index: 0, field: "duration", value: String(30.5 / 60) });
    const pending = (await controller.preparePendingMutation())!;
    const canonical = normalizeSessionDraftSnapshot(session, pending.snapshot);
    await controller.applyPatch({ type: "set-set-field", itemId: "plank", index: 0, field: "duration", value: "0.75" });
    const recovered = await controller.reconcileAuthoritative(2, canonical, pending.idempotencyKey);
    expect(recovered).toMatchObject({ confirmedRevision: 2, confirmedSnapshot: canonical, pendingMutation: null, revisionConflict: null, dirty: true, snapshot: { setLogs: { plank: [{ duration: "0.75" }] } } });
    controller.dispose();
  });

  it("reconciles an old pending write after an offline upgrade adds recording metadata without losing later edits", async () => {
    const session = createDemoWorkoutSession(schedule());
    const cache = new MemoryActiveWorkoutCache();
    const options = { cache, userId: "offline-upgrade", sessionId: session.id };
    const original = new ActiveWorkoutLocalController({ ...options, createIdempotencyKey: () => "old-client-token" });
    await original.initialize({ session: { id: session.id, workoutId: session.workoutId, programVersionId: session.programVersionId }, plan: {}, serverRevision: 1, serverSnapshot: blankSnapshot() });
    await original.applyPatch({ type: "set-session-note", value: "Committed before upgrade" });
    const pending = (await original.preparePendingMutation())!;
    await original.recordMutationAttempt(pending.idempotencyKey);
    // The server committed this snapshot, but its response was lost. A later
    // offline edit and the original pending token both survive the upgrade.
    await original.applyPatch({ type: "set-session-note", value: "Newer offline note" });
    original.dispose();
    const reloaded = new ActiveWorkoutLocalController({ ...options, createIdempotencyKey: () => "new-client-token" });
    await reloaded.hydrate();
    expect(await reloaded.preparePendingMutation()).toMatchObject({ ...pending, attemptCount: 1 });
    let requests = 0;
    const repository = new LiftLogRepository({ rpc: async (_name: string, args: { write_token: string; draft_payload: unknown }) => {
      requests += 1;
      expect(args.write_token).toBe(pending.idempotencyKey);
      expect(args.draft_payload).toMatchObject({ recordingSchema: 2, sessionNote: "Committed before upgrade" });
      return { data: null, error: { message: "Workout draft token was already used with a different payload" } };
    } } as never, "offline-upgrade", "Athlete");
    const error = await repository.saveSessionDraft(session, pending.snapshot.setLogs, pending.snapshot.resultLogs,
      pending.snapshot.sessionRpe, pending.snapshot.sessionNote, pending.expectedRevision, pending.idempotencyKey).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(SessionRevisionConflictError);
    // This is the same authoritative path the persistence hook invokes for
    // typed conflicts; the original committed write must not be replayed.
    const recovered = await reloaded.reconcileAuthoritative(2, pending.snapshot, pending.idempotencyKey);
    expect(recovered).toMatchObject({ confirmedRevision: 2, confirmedSnapshot: pending.snapshot,
      pendingMutation: null, revisionConflict: null, dirty: true, snapshot: { sessionNote: "Newer offline note" } });
    expect(await reloaded.preparePendingMutation()).toMatchObject({ expectedRevision: 2, idempotencyKey: "new-client-token", snapshot: { sessionNote: "Newer offline note" } });
    expect(requests).toBe(1);
    reloaded.dispose();
  });
});
