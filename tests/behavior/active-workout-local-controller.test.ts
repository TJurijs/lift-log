import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActiveWorkoutDraftSnapshot } from "../../lib/active-workout-draft-storage";
import {
  MemoryActiveWorkoutCache,
  WebStorageActiveWorkoutCache,
  createActiveWorkoutCache,
  type ActiveWorkoutCache,
} from "../../lib/active-workout-cache";
import {
  ActiveWorkoutLocalController,
} from "../../lib/active-workout-local-controller";

const START = Date.parse("2026-08-29T08:00:00.000Z");

function snapshot(): ActiveWorkoutDraftSnapshot {
  return {
    setLogs: { lift: [{ reps: "5", load: "40", rpe: "6" }] },
    resultLogs: { cardio: { duration: "10", distance: "2" } },
    sessionRpe: "6",
    sessionNote: "Base note",
  };
}

function identity(sessionId = "session-a") {
  return {
    id: sessionId,
    workoutId: `workout-${sessionId}`,
    programVersionId: "version-a",
    scheduledWorkoutId: `schedule-${sessionId}`,
    itemLogIds: { lift: `item-log-${sessionId}` },
  };
}

function clock() {
  let current = START;
  return () => {
    current += 1_000;
    return current;
  };
}

function controller(
  cache: ActiveWorkoutCache,
  options: {
    userId?: string;
    sessionId?: string;
    key?: string;
    compactAfterPatches?: number;
  } = {},
) {
  return new ActiveWorkoutLocalController({
    cache,
    userId: options.userId ?? "user-a",
    sessionId: options.sessionId ?? "session-a",
    now: clock(),
    createIdempotencyKey: () => options.key ?? "mutation-one",
    compactAfterPatches: options.compactAfterPatches ?? 100,
    compactAfterBytes: 1_000_000,
  });
}

async function initialize(
  target: ActiveWorkoutLocalController,
  sessionId = "session-a",
  revision = 1,
) {
  return target.initialize({
    session: identity(sessionId),
    plan: { title: "Strength A" },
    serverRevision: revision,
    serverSnapshot: snapshot(),
  });
}

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

describe("ActiveWorkoutLocalController durability", () => {
  it("survives an offline hard reload from incremental localStorage patches", async () => {
    const firstCache = new WebStorageActiveWorkoutCache(window.localStorage);
    const first = controller(firstCache);
    await initialize(first);
    const recordKey = Array.from({ length: window.localStorage.length }, (_, index) =>
      window.localStorage.key(index),
    ).find((key) => key?.endsWith(":record"));
    expect(recordKey).toBeTruthy();
    expect(recordKey).toMatch(/^liftlog:active-workout:v1:/);
    const compactedRecord = window.localStorage.getItem(recordKey!);

    await first.applyPatch({
      type: "set-set-field",
      itemId: "lift",
      index: 0,
      field: "load",
      value: "47.5",
    });
    await first.applyPatch({
      type: "set-session-note",
      value: "Saved with no connection",
    });

    // Per-keystroke writes did not serialize the full workout record again.
    expect(window.localStorage.getItem(recordKey!)).toBe(compactedRecord);
    expect(window.localStorage.length).toBe(3);

    const reloaded = controller(
      new WebStorageActiveWorkoutCache(window.localStorage),
    );
    const restored = await reloaded.hydrate();
    expect(restored?.snapshot.setLogs.lift[0].load).toBe("47.5");
    expect(restored?.snapshot.sessionNote).toBe("Saved with no connection");
    expect(restored).toMatchObject({ latestSequence: 2, dirty: true });
  });

  it("compacts a journal and restores the compacted snapshot", async () => {
    const cache = new WebStorageActiveWorkoutCache(window.localStorage);
    const first = controller(cache, { compactAfterPatches: 2 });
    await initialize(first);
    await first.applyPatch({ type: "set-session-rpe", value: "8" });
    await first.applyPatch({ type: "set-session-note", value: "Compacted" });

    const entry = await cache.load("user-a", "session-a");
    expect(entry?.journal).toEqual([]);
    expect(entry?.record.compactedThroughSequence).toBe(2);
    const reloaded = controller(cache);
    expect(await reloaded.hydrate()).toMatchObject({
      latestSequence: 2,
      dirty: true,
      snapshot: { sessionRpe: "8", sessionNote: "Compacted" },
    });
  });

  it("publishes to subscribers only after an edit is durable", async () => {
    const underlying = new MemoryActiveWorkoutCache();
    let releaseAppend!: () => void;
    let reportStarted!: () => void;
    const appendGate = new Promise<void>((resolve) => {
      releaseAppend = resolve;
    });
    const appendStarted = new Promise<void>((resolve) => {
      reportStarted = resolve;
    });
    const delayedCache: ActiveWorkoutCache = {
      kind: "memory",
      load: (userId, sessionId) => underlying.load(userId, sessionId),
      saveRecord: (record) => underlying.saveRecord(record),
      appendPatch: async (userId, sessionId, patch) => {
        reportStarted();
        await appendGate;
        await underlying.appendPatch(userId, sessionId, patch);
      },
      replace: (record, journal) => underlying.replace(record, journal),
      deleteSession: (userId, sessionId) =>
        underlying.deleteSession(userId, sessionId),
      deleteUser: (userId) => underlying.deleteUser(userId),
    };
    const target = controller(delayedCache);
    await initialize(target);
    const listener = vi.fn();
    target.subscribe(listener);

    const pending = target.applyPatch({ type: "set-session-rpe", value: "9" });
    await appendStarted;
    expect(target.getSnapshot()?.snapshot.sessionRpe).toBe("6");
    expect(listener).not.toHaveBeenCalled();
    releaseAppend();
    await pending;
    expect(target.getSnapshot()?.snapshot.sessionRpe).toBe("9");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent UI patches without losing a sequence", async () => {
    const target = controller(new MemoryActiveWorkoutCache());
    await initialize(target);
    await Promise.all([
      target.applyPatch({ type: "set-session-note", value: "Parallel note" }),
      target.applyPatch({ type: "set-session-rpe", value: "7" }),
    ]);
    expect(target.getSnapshot()).toMatchObject({
      latestSequence: 2,
      snapshot: { sessionNote: "Parallel note", sessionRpe: "7" },
    });
  });
});

describe("ActiveWorkoutLocalController mutations and revisions", () => {
  it("reuses the exact mutation envelope across reloads and retains later edits", async () => {
    const cache = new WebStorageActiveWorkoutCache(window.localStorage);
    const first = controller(cache, { key: "stable-token" });
    await initialize(first, "session-a", 7);
    await first.applyPatch({
      type: "set-set-field",
      itemId: "lift",
      index: 0,
      field: "load",
      value: "45",
    });
    const prepared = await first.preparePendingMutation();
    expect(prepared).toMatchObject({
      idempotencyKey: "stable-token",
      expectedRevision: 7,
      throughSequence: 1,
      attemptCount: 0,
    });
    await first.recordMutationAttempt("stable-token");
    await first.recordMutationFailure(
      "stable-token",
      { category: "offline", retryable: true, ambiguous: true },
      2_500,
    );

    const reloaded = controller(cache, { key: "next-token" });
    await reloaded.hydrate();
    expect(await reloaded.preparePendingMutation()).toMatchObject({
      idempotencyKey: "stable-token",
      attemptCount: 1,
      lastFailureCategory: "offline",
    });
    await reloaded.applyPatch({
      type: "set-session-note",
      value: "Typed while request was pending",
    });
    const acknowledged = await reloaded.acknowledgeMutation("stable-token", 8);
    expect(acknowledged).toMatchObject({
      confirmedRevision: 8,
      confirmedWriteToken: "stable-token",
      confirmedThroughSequence: 1,
      latestSequence: 2,
      dirty: true,
      snapshot: { sessionNote: "Typed while request was pending" },
    });
    expect(acknowledged.confirmedSnapshot.setLogs.lift[0].load).toBe("45");
    expect(acknowledged.confirmedSnapshot.sessionNote).toBe("Base note");
    expect(await reloaded.preparePendingMutation()).toMatchObject({
      idempotencyKey: "next-token",
      expectedRevision: 8,
      throughSequence: 2,
    });
  });

  it("recognizes an ambiguous request that committed and keeps post-request edits", async () => {
    const target = controller(new MemoryActiveWorkoutCache());
    await initialize(target);
    await target.applyPatch({
      type: "set-set-field",
      itemId: "lift",
      index: 0,
      field: "load",
      value: "45",
    });
    const mutation = await target.preparePendingMutation();
    await target.applyPatch({
      type: "set-session-note",
      value: "Newer local note",
    });
    const committedSnapshot = structuredClone(mutation!.snapshot);
    committedSnapshot.setLogs.lift[0].load = "45.0";
    const reconciled = await target.reconcileAuthoritative(
      2,
      committedSnapshot,
      mutation!.idempotencyKey,
    );
    expect(reconciled).toMatchObject({
      confirmedRevision: 2,
      confirmedWriteToken: "mutation-one",
      latestSequence: 2,
      confirmedThroughSequence: 1,
      dirty: true,
      pendingMutation: null,
      snapshot: { sessionNote: "Newer local note" },
    });
    expect(reconciled.snapshot.setLogs.lift[0].load).toBe("45.0");
  });

  it("rebases non-overlapping remote and local fields", async () => {
    const target = controller(new MemoryActiveWorkoutCache());
    await initialize(target);
    await target.applyPatch({
      type: "set-set-field",
      itemId: "lift",
      index: 0,
      field: "load",
      value: "45",
    });
    const remote = snapshot();
    remote.setLogs.lift[0].reps = "6";

    const state = await target.reconcileAuthoritative(2, remote);
    expect(state.snapshot.setLogs.lift[0]).toEqual({
      reps: "6",
      load: "45",
      rpe: "6",
    });
    expect(state).toMatchObject({
      confirmedRevision: 2,
      dirty: true,
      pendingMutation: null,
      revisionConflict: null,
    });
    expect((await target.preparePendingMutation())?.expectedRevision).toBe(2);
  });

  it("persists same-field conflicts and resolves them explicitly", async () => {
    const cache = new MemoryActiveWorkoutCache();
    const target = controller(cache);
    await initialize(target);
    await target.applyPatch({
      type: "set-set-field",
      itemId: "lift",
      index: 0,
      field: "load",
      value: "45",
    });
    await target.preparePendingMutation();
    const remote = snapshot();
    remote.setLogs.lift[0].load = "50";

    const conflicted = await target.reconcileAuthoritative(2, remote);
    expect(conflicted.pendingMutation).toBeNull();
    expect(conflicted.revisionConflict).toMatchObject({
      authoritativeRevision: 2,
      conflicts: ["setLogs[lift][0][load]"],
      rejectedMutation: { idempotencyKey: "mutation-one" },
    });
    const reloaded = controller(cache);
    expect((await reloaded.hydrate())?.revisionConflict?.conflicts).toEqual([
      "setLogs[lift][0][load]",
    ]);

    const resolved = await reloaded.resolveRevisionConflict("server");
    expect(resolved.snapshot.setLogs.lift[0].load).toBe("50");
    expect(resolved).toMatchObject({
      confirmedRevision: 2,
      dirty: false,
      revisionConflict: null,
    });
  });

  it("rejects stale acknowledgements and server snapshots without revision changes", async () => {
    const target = controller(new MemoryActiveWorkoutCache());
    await initialize(target, "session-a", 3);
    await target.applyPatch({ type: "set-session-rpe", value: "8" });
    await target.preparePendingMutation();
    await expect(target.acknowledgeMutation("wrong-token", 4)).rejects.toThrow(
      "does not match",
    );
    await expect(
      target.acknowledgeMutation("mutation-one", 5),
    ).rejects.toThrow("unexpected revision");
    const inconsistent = snapshot();
    inconsistent.sessionNote = "Changed without revision";
    await expect(target.reconcileAuthoritative(3, inconsistent)).rejects.toThrow(
      "without a revision increment",
    );
  });
});

describe("active workout cache isolation and cleanup", () => {
  it("clears one completion and only the signing-out user's sessions", async () => {
    const cache = new MemoryActiveWorkoutCache();
    const a1 = controller(cache, { sessionId: "session-1" });
    const a2 = controller(cache, { sessionId: "session-2" });
    const b1 = controller(cache, { userId: "user-b", sessionId: "session-1" });
    await initialize(a1, "session-1");
    await initialize(a2, "session-2");
    await initialize(b1, "session-1");

    await a1.clearAfterCompletion();
    expect(await cache.load("user-a", "session-1")).toBeNull();
    expect(await cache.load("user-a", "session-2")).not.toBeNull();
    expect(await cache.load("user-b", "session-1")).not.toBeNull();

    await a2.clearOnSignOut();
    expect(await cache.load("user-a", "session-2")).toBeNull();
    expect(await cache.load("user-b", "session-1")).not.toBeNull();
  });

  it("selects safe localStorage and memory fallbacks", () => {
    expect(
      createActiveWorkoutCache({ indexedDB: null, storage: window.localStorage })
        .kind,
    ).toBe("local-storage");
    expect(createActiveWorkoutCache({ indexedDB: null, storage: null }).kind).toBe(
      "memory",
    );
  });
});
