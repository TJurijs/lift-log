import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ACTIVE_WORKOUT_DRAFT_MAX_AGE_MS,
  ActiveWorkoutDraftStore,
  activeWorkoutDraftStorageKey,
  type ActiveWorkoutDraftSnapshot,
} from "../../lib/active-workout-draft-storage";

const SAVED_AT = Date.parse("2026-08-25T14:54:44.000Z");

function snapshot(): ActiveWorkoutDraftSnapshot {
  return {
    setLogs: {
      "item-1": [
        { reps: "3", load: "40", rpe: "6" },
        { reps: "3", load: "60", rpe: "8" },
      ],
    },
    resultLogs: {
      "item-2": { duration: "10", "round.0.rpe": "7" },
    },
    sessionRpe: "7",
    sessionNote: "Felt controlled.",
  };
}

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

describe("ActiveWorkoutDraftStore", () => {
  it("restores a valid user- and session-scoped snapshot after reload", () => {
    const savingStore = new ActiveWorkoutDraftStore({
      storage: window.localStorage,
      now: () => SAVED_AT,
    });
    expect(savingStore.save("user-a", "session-a", 15, snapshot())).toBe(true);

    const reloadedStore = new ActiveWorkoutDraftStore({
      storage: window.localStorage,
      now: () => SAVED_AT + 60_000,
    });
    expect(reloadedStore.restore("user-a", "session-a", 15)).toEqual({
      status: "restored",
      draft: {
        schemaVersion: 1,
        userId: "user-a",
        sessionId: "session-a",
        baseRevision: 15,
        baseSnapshot: snapshot(),
        savedAt: "2026-08-25T14:54:44.000Z",
        snapshot: snapshot(),
      },
    });
  });

  it("preserves an exact confirmed base snapshot separately from newer local edits", () => {
    const store = new ActiveWorkoutDraftStore({
      storage: window.localStorage,
      now: () => SAVED_AT,
    });
    const localSnapshot = snapshot();
    localSnapshot.setLogs["item-1"][0].load = "45";
    const baseSnapshot = snapshot();

    expect(
      store.save("user-a", "session-a", 15, localSnapshot, baseSnapshot),
    ).toBe(true);
    expect(store.restore("user-a", "session-a", 15)).toEqual({
      status: "restored",
      draft: expect.objectContaining({
        snapshot: localSnapshot,
        baseSnapshot,
      }),
    });
  });

  it("restores a legacy schema-v1 record without a base snapshot", () => {
    const key = activeWorkoutDraftStorageKey("user-a", "legacy-session");
    window.localStorage.setItem(
      key,
      JSON.stringify({
        schemaVersion: 1,
        userId: "user-a",
        sessionId: "legacy-session",
        baseRevision: 7,
        savedAt: "2026-08-25T14:54:44.000Z",
        snapshot: snapshot(),
      }),
    );
    const store = new ActiveWorkoutDraftStore({
      storage: window.localStorage,
      now: () => SAVED_AT,
    });

    expect(store.restore("user-a", "legacy-session", 7)).toEqual({
      status: "restored",
      draft: {
        schemaVersion: 1,
        userId: "user-a",
        sessionId: "legacy-session",
        baseRevision: 7,
        savedAt: "2026-08-25T14:54:44.000Z",
        snapshot: snapshot(),
      },
    });
  });

  it("returns false for invalid or oversized user snapshots", () => {
    const store = new ActiveWorkoutDraftStore({
      storage: window.localStorage,
      now: () => SAVED_AT,
    });
    const invalidSnapshot = {
      ...snapshot(),
      sessionRpe: "11",
    } as ActiveWorkoutDraftSnapshot;
    expect(store.save("user-a", "invalid", 1, invalidSnapshot)).toBe(false);
    expect(
      window.localStorage.getItem(
        activeWorkoutDraftStorageKey("user-a", "invalid"),
      ),
    ).toBeNull();

    const oversizedSnapshot: ActiveWorkoutDraftSnapshot = {
      setLogs: {
        "item-1": Array.from({ length: 5_000 }, () => ({
          reps: "1".repeat(128),
          load: "2".repeat(128),
          rpe: "3".repeat(128),
        })),
      },
      resultLogs: {},
      sessionRpe: "",
      sessionNote: "",
    };
    expect(store.save("user-a", "oversized", 1, oversizedSnapshot)).toBe(
      false,
    );
    expect(
      window.localStorage.getItem(
        activeWorkoutDraftStorageKey("user-a", "oversized"),
      ),
    ).toBeNull();
  });

  it("returns false when storage rejects the write because quota is exhausted", () => {
    const quotaStorage: Storage = {
      length: 0,
      clear() {},
      getItem() {
        return null;
      },
      key() {
        return null;
      },
      removeItem() {},
      setItem() {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      },
    };
    const store = new ActiveWorkoutDraftStore({
      storage: quotaStorage,
      now: () => SAVED_AT,
    });

    expect(store.save("user-a", "session-a", 1, snapshot())).toBe(false);
  });

  it("rejects and removes corrupt or unsupported payloads", () => {
    const store = new ActiveWorkoutDraftStore({
      storage: window.localStorage,
      now: () => SAVED_AT,
    });
    const corruptKey = activeWorkoutDraftStorageKey("user-a", "corrupt");
    window.localStorage.setItem(corruptKey, "{not-json");
    expect(store.restore("user-a", "corrupt", 0)).toEqual({
      status: "corrupt",
    });
    expect(window.localStorage.getItem(corruptKey)).toBeNull();

    const oldKey = activeWorkoutDraftStorageKey("user-a", "old-version");
    window.localStorage.setItem(oldKey, JSON.stringify({ schemaVersion: 0 }));
    expect(store.restore("user-a", "old-version", 0)).toEqual({
      status: "unsupported-version",
    });
    expect(window.localStorage.getItem(oldKey)).toBeNull();

    const malformedKey = activeWorkoutDraftStorageKey(
      "user-a",
      "malformed-shape",
    );
    window.localStorage.setItem(
      malformedKey,
      JSON.stringify({
        schemaVersion: 1,
        userId: "user-a",
        sessionId: "malformed-shape",
        baseRevision: 0,
        savedAt: "2026-08-25T14:54:44.000Z",
        snapshot: {
          setLogs: { "item-1": [{ reps: 5, load: "40", rpe: "6" }] },
          resultLogs: {},
          sessionRpe: "7",
          sessionNote: "",
        },
      }),
    );
    expect(store.restore("user-a", "malformed-shape", 0)).toEqual({
      status: "corrupt",
    });
    expect(window.localStorage.getItem(malformedKey)).toBeNull();
  });

  it("rejects expired drafts but retains a valid revision-mismatched draft", () => {
    const savingStore = new ActiveWorkoutDraftStore({
      storage: window.localStorage,
      now: () => SAVED_AT,
    });
    savingStore.save("user-a", "expired", 5, snapshot());
    savingStore.save("user-a", "revision-conflict", 5, snapshot());

    const expiredStore = new ActiveWorkoutDraftStore({
      storage: window.localStorage,
      now: () => SAVED_AT + ACTIVE_WORKOUT_DRAFT_MAX_AGE_MS + 1,
    });
    expect(expiredStore.restore("user-a", "expired", 5)).toEqual({
      status: "expired",
    });

    expect(savingStore.restore("user-a", "revision-conflict", 6)).toEqual({
      status: "revision-mismatch",
      draft: expect.objectContaining({
        userId: "user-a",
        sessionId: "revision-conflict",
        baseRevision: 5,
        snapshot: snapshot(),
      }),
    });
  });

  it("never restores another user's draft, even if a payload is copied", () => {
    const store = new ActiveWorkoutDraftStore({
      storage: window.localStorage,
      now: () => SAVED_AT,
    });
    store.save("user-a", "session-a", 2, snapshot());

    expect(store.restore("user-b", "session-a", 2)).toEqual({
      status: "missing",
    });

    const userAKey = activeWorkoutDraftStorageKey("user-a", "session-a");
    const userBKey = activeWorkoutDraftStorageKey("user-b", "session-a");
    window.localStorage.setItem(
      userBKey,
      window.localStorage.getItem(userAKey) ?? "",
    );
    expect(store.restore("user-b", "session-a", 2)).toEqual({
      status: "scope-mismatch",
    });
    expect(window.localStorage.getItem(userBKey)).toBeNull();
    expect(store.restore("user-a", "session-a", 2).status).toBe("restored");
  });

  it("clears one completed session and only the signing-out user's drafts", () => {
    const store = new ActiveWorkoutDraftStore({
      storage: window.localStorage,
      now: () => SAVED_AT,
    });
    store.save("user-a", "session-1", 1, snapshot());
    store.save("user-a", "session-2", 1, snapshot());
    store.save("user-b", "session-1", 1, snapshot());

    expect(store.clearAfterCompletion("user-a", "session-1")).toBe(true);
    expect(store.restore("user-a", "session-1", 1).status).toBe("missing");
    expect(store.restore("user-a", "session-2", 1).status).toBe("restored");

    expect(store.clearOnSignOut("user-a")).toBe(1);
    expect(store.restore("user-a", "session-2", 1).status).toBe("missing");
    expect(store.restore("user-b", "session-1", 1).status).toBe("restored");
  });
});
