import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ActiveWorkoutDraftStore,
  activeWorkoutDraftStorageKey,
  type ActiveWorkoutDraftSnapshot,
} from "../../lib/active-workout-draft-storage";
import {
  MemoryActiveWorkoutCache,
  type ActiveWorkoutCache,
} from "../../lib/active-workout-cache";
import {
  importLegacyActiveWorkoutDraft,
} from "../../lib/active-workout-legacy-migration";
import { materializeActiveWorkoutEntry } from "../../lib/active-workout-local-types";

const NOW = Date.parse("2026-08-29T08:00:00.000Z");

function snapshot(): ActiveWorkoutDraftSnapshot {
  return {
    setLogs: { lift: [{ reps: "5", load: "40", rpe: "6" }] },
    resultLogs: {},
    sessionRpe: "6",
    sessionNote: "Base",
  };
}

function session(id = "session-a") {
  return {
    id,
    workoutId: "workout-a",
    programVersionId: "version-a",
    scheduledWorkoutId: "schedule-a",
  };
}

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

describe("legacy active workout import", () => {
  it("imports a revision-mismatched v1 draft exactly once and preserves its base", async () => {
    const base = snapshot();
    const local = snapshot();
    local.setLogs.lift[0].load = "45";
    const legacy = new ActiveWorkoutDraftStore({
      storage: window.localStorage,
      now: () => NOW,
    });
    expect(legacy.save("user-a", "session-a", 5, local, base)).toBe(true);
    const cache = new MemoryActiveWorkoutCache();

    const imported = await importLegacyActiveWorkoutDraft({
      cache,
      storage: window.localStorage,
      userId: "user-a",
      session: session(),
      serverRevision: 6,
      plan: { title: "Legacy plan" },
      now: () => NOW + 1_000,
    });
    expect(imported).toMatchObject({
      status: "imported",
      legacyStatus: "revision-mismatch",
      legacyRemoved: true,
      entry: {
        record: {
          confirmedRevision: 5,
          confirmedThroughSequence: 0,
          compactedThroughSequence: 1,
          legacyImport: { schemaVersion: 1 },
        },
      },
    });
    if (imported.status !== "imported") throw new Error("Expected import");
    expect(imported.entry.record.confirmedSnapshot.setLogs.lift[0].load).toBe(
      "40",
    );
    expect(imported.entry.record.compactedSnapshot.setLogs.lift[0].load).toBe(
      "45",
    );
    expect(
      window.localStorage.getItem(
        activeWorkoutDraftStorageKey("user-a", "session-a"),
      ),
    ).toBeNull();

    expect(
      await importLegacyActiveWorkoutDraft({
        cache,
        storage: window.localStorage,
        userId: "user-a",
        session: session(),
        serverRevision: 6,
        now: () => NOW + 2_000,
      }),
    ).toMatchObject({ status: "already-present" });
  });

  it("conservatively marks a base-less schema-v1 payload dirty", async () => {
    window.localStorage.setItem(
      activeWorkoutDraftStorageKey("user-a", "session-a"),
      JSON.stringify({
        schemaVersion: 1,
        userId: "user-a",
        sessionId: "session-a",
        baseRevision: 7,
        savedAt: new Date(NOW).toISOString(),
        snapshot: snapshot(),
      }),
    );
    const cache = new MemoryActiveWorkoutCache();
    const result = await importLegacyActiveWorkoutDraft({
      cache,
      storage: window.localStorage,
      userId: "user-a",
      session: session(),
      serverRevision: 7,
      now: () => NOW + 1_000,
    });
    if (result.status !== "imported") throw new Error("Expected import");
    const materialized = materializeActiveWorkoutEntry(result.entry);
    expect(materialized.latestSequence).toBe(1);
    expect(result.entry.record.confirmedThroughSequence).toBe(0);
  });

  it("does not remove the recoverable legacy key when the new cache write fails", async () => {
    const legacy = new ActiveWorkoutDraftStore({
      storage: window.localStorage,
      now: () => NOW,
    });
    legacy.save("user-a", "session-a", 1, snapshot());
    const underlying = new MemoryActiveWorkoutCache();
    const failingCache: ActiveWorkoutCache = {
      kind: "memory",
      load: (userId, sessionId) => underlying.load(userId, sessionId),
      saveRecord: (record) => underlying.saveRecord(record),
      appendPatch: (userId, sessionId, patch) =>
        underlying.appendPatch(userId, sessionId, patch),
      replace: async () => {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      },
      deleteSession: (userId, sessionId) =>
        underlying.deleteSession(userId, sessionId),
      deleteUser: (userId) => underlying.deleteUser(userId),
    };

    await expect(
      importLegacyActiveWorkoutDraft({
        cache: failingCache,
        storage: window.localStorage,
        userId: "user-a",
        session: session(),
        serverRevision: 1,
        now: () => NOW + 1_000,
      }),
    ).rejects.toThrow("Quota exceeded");
    expect(
      window.localStorage.getItem(
        activeWorkoutDraftStorageKey("user-a", "session-a"),
      ),
    ).not.toBeNull();
  });

  it("never imports a copied payload belonging to another user", async () => {
    const legacy = new ActiveWorkoutDraftStore({
      storage: window.localStorage,
      now: () => NOW,
    });
    legacy.save("user-a", "session-a", 1, snapshot());
    window.localStorage.setItem(
      activeWorkoutDraftStorageKey("user-b", "session-a"),
      window.localStorage.getItem(
        activeWorkoutDraftStorageKey("user-a", "session-a"),
      )!,
    );
    const cache = new MemoryActiveWorkoutCache();
    expect(
      await importLegacyActiveWorkoutDraft({
        cache,
        storage: window.localStorage,
        userId: "user-b",
        session: session(),
        serverRevision: 1,
        now: () => NOW + 1_000,
      }),
    ).toEqual({ status: "scope-mismatch" });
    expect(await cache.load("user-b", "session-a")).toBeNull();
  });
});
