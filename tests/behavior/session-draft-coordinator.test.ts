import { describe, expect, it, vi } from "vitest";

import {
  SessionDraftCoordinator,
  SessionDraftCoordinatorClosedError,
  SessionDraftOfflineError,
  type SessionDraftMutation,
} from "../../lib/session-draft-coordinator";

function controlledPromise<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
}

async function drainMicrotasks() {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

function tokenFactory() {
  let next = 0;
  return () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`;
}

describe("SessionDraftCoordinator", () => {
  it("debounces staged work and coalesces to the newest complete snapshot", async () => {
    const writes: Array<SessionDraftMutation<string>> = [];
    const coordinator = new SessionDraftCoordinator<string>(
      async (mutation) => {
        writes.push(mutation);
        return mutation.expectedRevision + 1;
      },
      { initialRevision: 4, createToken: tokenFactory() },
    );

    coordinator.stage("first");
    coordinator.stage("newest");
    await drainMicrotasks();
    expect(writes).toEqual([]);

    const revision = await coordinator.flushLatest();
    expect(revision).toBe(5);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      expectedRevision: 4,
      snapshot: "newest",
    });
    expect(coordinator.status).toBe("saved");
  });

  it("never overlaps writes and advances each expected revision from confirmation", async () => {
    const first = controlledPromise<number>();
    const second = controlledPromise<number>();
    const writes: Array<SessionDraftMutation<string>> = [];
    let active = 0;
    let maximumActive = 0;
    const coordinator = new SessionDraftCoordinator<string>(
      (mutation) => {
        writes.push(mutation);
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        return (writes.length === 1 ? first.promise : second.promise).finally(
          () => {
            active -= 1;
          },
        );
      },
      { initialRevision: 7, createToken: tokenFactory() },
    );

    coordinator.enqueue("older");
    await drainMicrotasks();
    coordinator.enqueue("newest");
    expect(writes).toHaveLength(1);

    first.resolve(8);
    await drainMicrotasks();
    expect(writes).toHaveLength(2);
    expect(writes[1]).toMatchObject({ expectedRevision: 8, snapshot: "newest" });

    second.resolve(9);
    await expect(coordinator.flushLatest()).resolves.toBe(9);
    expect(maximumActive).toBe(1);
  });

  it("retains offline changes and saves them on reconnect", async () => {
    const writes: Array<SessionDraftMutation<string>> = [];
    const statuses: string[] = [];
    const coordinator = new SessionDraftCoordinator<string>(
      async (mutation) => {
        writes.push(mutation);
        return mutation.expectedRevision + 1;
      },
      {
        online: false,
        createToken: tokenFactory(),
        onStatusChange: (status) => statuses.push(status),
      },
    );

    coordinator.stage("typed while offline");
    await expect(coordinator.flushLatest()).rejects.toBeInstanceOf(
      SessionDraftOfflineError,
    );
    expect(writes).toEqual([]);
    expect(coordinator.status).toBe("unsaved-offline");

    coordinator.setOnline(true);
    await expect(coordinator.flushLatest()).resolves.toBe(1);
    expect(writes[0].snapshot).toBe("typed while offline");
    expect(statuses).toContain("saved");
  });

  it("resolves an in-flight flush that succeeds after the browser goes offline", async () => {
    const saved = controlledPromise<number>();
    const writer = vi.fn(() => saved.promise);
    const coordinator = new SessionDraftCoordinator<string>(writer, {
      createToken: tokenFactory(),
    });

    const flushed = coordinator.flushLatest("already sent");
    await drainMicrotasks();
    coordinator.setOnline(false);
    saved.resolve(1);

    await expect(flushed).resolves.toBe(1);
    expect(coordinator.status).toBe("saved");
    expect(coordinator.hasUnsavedChanges).toBe(false);

    coordinator.setOnline(true);
    await drainMicrotasks();
    expect(writer).toHaveBeenCalledOnce();
  });

  it("keeps a flush pending for newer offline work until reconnect", async () => {
    const first = controlledPromise<number>();
    const writes: Array<SessionDraftMutation<string>> = [];
    const coordinator = new SessionDraftCoordinator<string>(
      (mutation) => {
        writes.push(mutation);
        return writes.length === 1
          ? first.promise
          : Promise.resolve(mutation.expectedRevision + 1);
      },
      { createToken: tokenFactory() },
    );

    const flushed = coordinator.flushLatest("already sent");
    const onFlushed = vi.fn();
    void flushed.then(onFlushed);
    await drainMicrotasks();

    coordinator.setOnline(false);
    coordinator.stage("typed while offline");
    first.resolve(1);
    await drainMicrotasks();

    expect(onFlushed).not.toHaveBeenCalled();
    expect(coordinator.status).toBe("unsaved-offline");
    expect(writes).toHaveLength(1);

    coordinator.setOnline(true);
    await expect(flushed).resolves.toBe(2);
    expect(writes).toHaveLength(2);
    expect(writes[1]).toMatchObject({
      expectedRevision: 1,
      snapshot: "typed while offline",
    });
  });

  it("replays the exact token after a lost response before saving newer work", async () => {
    const calls: Array<SessionDraftMutation<string>> = [];
    const failure = new Error("response lost");
    const coordinator = new SessionDraftCoordinator<string>(
      async (mutation) => {
        calls.push(mutation);
        if (calls.length === 1) throw failure;
        return mutation.expectedRevision + 1;
      },
      { initialRevision: 10, createToken: tokenFactory() },
    );

    coordinator.enqueue("possibly committed");
    await expect(coordinator.flushLatest()).rejects.toBe(failure);
    coordinator.stage("newer local state");

    await expect(coordinator.flushLatest()).resolves.toBe(12);
    expect(calls).toHaveLength(3);
    expect(calls[1]).toEqual(calls[0]);
    expect(calls[2]).toMatchObject({
      expectedRevision: 11,
      snapshot: "newer local state",
    });
    expect(calls[2].writeToken).not.toBe(calls[0].writeToken);
  });

  it("gates deterministic failures until a deliberately staged snapshot replaces them", async () => {
    const deterministic = new Error("payload is invalid");
    const calls: Array<SessionDraftMutation<string>> = [];
    const coordinator = new SessionDraftCoordinator<string>(
      async (mutation) => {
        calls.push(mutation);
        if (calls.length === 1) throw deterministic;
        return mutation.expectedRevision + 1;
      },
      {
        createToken: tokenFactory(),
        isAmbiguousFailure: () => false,
      },
    );

    await expect(coordinator.flushLatest("invalid snapshot")).rejects.toBe(
      deterministic,
    );
    await expect(coordinator.flushLatest()).rejects.toBe(deterministic);
    coordinator.save();
    coordinator.setOnline(false);
    coordinator.setOnline(true);
    await drainMicrotasks();
    expect(calls).toHaveLength(1);

    await expect(coordinator.flushLatest("fixed snapshot")).resolves.toBe(1);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({
      expectedRevision: 0,
      snapshot: "fixed snapshot",
    });
    expect(calls[1].writeToken).not.toBe(calls[0].writeToken);
  });

  it("rejects revision jumps without advancing confirmed state or retrying forever", async () => {
    const calls: Array<SessionDraftMutation<string>> = [];
    const coordinator = new SessionDraftCoordinator<string>(
      async (mutation) => {
        calls.push(mutation);
        return calls.length === 1
          ? mutation.expectedRevision + 2
          : mutation.expectedRevision + 1;
      },
      { initialRevision: 4, createToken: tokenFactory() },
    );

    await expect(coordinator.flushLatest("invalid response")).rejects.toThrow(
      "Workout autosave returned an invalid revision",
    );
    expect(coordinator.confirmedRevision).toBe(4);
    coordinator.save();
    await drainMicrotasks();
    expect(calls).toHaveLength(1);

    await expect(coordinator.flushLatest("try with a fresh token")).resolves.toBe(
      5,
    );
    expect(calls[1]).toMatchObject({
      expectedRevision: 4,
      snapshot: "try with a fresh token",
    });
  });

  it("turns token-generation failures into a recoverable rejected flush", async () => {
    const tokenError = new Error("secure token source unavailable");
    const onError = vi.fn();
    let tokenAttempt = 0;
    const writer = vi.fn(
      async (mutation: SessionDraftMutation<string>) =>
        mutation.expectedRevision + 1,
    );
    const coordinator = new SessionDraftCoordinator<string>(writer, {
      createToken: () => {
        tokenAttempt += 1;
        if (tokenAttempt === 1) throw tokenError;
        return `00000000-0000-4000-8000-${String(tokenAttempt).padStart(12, "0")}`;
      },
      onError,
    });

    await expect(coordinator.flushLatest("first attempt")).rejects.toBe(
      tokenError,
    );
    expect(coordinator.status).toBe("error");
    expect(writer).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(tokenError);

    await expect(coordinator.flushLatest("deliberate retry")).resolves.toBe(1);
    expect(writer).toHaveBeenCalledOnce();
  });

  it("reports status callback errors without stranding a successful flush", async () => {
    const statusError = new Error("status observer failed");
    const onError = vi.fn();
    const coordinator = new SessionDraftCoordinator<string>(
      async (mutation) => mutation.expectedRevision + 1,
      {
        createToken: tokenFactory(),
        onError,
        onStatusChange: () => {
          throw statusError;
        },
      },
    );

    await expect(coordinator.flushLatest("safe snapshot")).resolves.toBe(1);
    expect(coordinator.status).toBe("saved");
    expect(onError).toHaveBeenCalledWith(statusError);
  });

  it("rejects a synchronously thrown write instead of stranding its flush", async () => {
    const writeError = new Error("writer failed before returning a promise");
    const coordinator = new SessionDraftCoordinator<string>(
      () => {
        throw writeError;
      },
      {
        createToken: tokenFactory(),
        isAmbiguousFailure: () => false,
      },
    );

    await expect(coordinator.flushLatest("snapshot")).rejects.toBe(writeError);
    expect(coordinator.status).toBe("error");
  });

  it("pauses deterministic revision conflicts until an authoritative rebase", async () => {
    const stale = new Error("Workout draft changed on another device");
    const calls: Array<SessionDraftMutation<string>> = [];
    const writer = vi.fn(async (mutation: SessionDraftMutation<string>) => {
      calls.push(mutation);
      if (calls.length === 1) throw stale;
      return mutation.expectedRevision + 1;
    });
    const onError = vi.fn();
    const coordinator = new SessionDraftCoordinator<string>(writer, {
      createToken: tokenFactory(),
      isRevisionConflict: (error) => error === stale,
      onError,
    });

    coordinator.stage("local before conflict");
    await expect(coordinator.flushLatest()).rejects.toBe(stale);
    expect(coordinator.status).toBe("error");
    expect(coordinator.hasUnsavedChanges).toBe(true);
    expect(coordinator.revisionResetRequired).toBe(true);
    expect(onError).toHaveBeenCalledWith(stale);

    coordinator.stage("newest local state");
    await expect(coordinator.flushLatest()).rejects.toBe(stale);
    expect(writer).toHaveBeenCalledOnce();

    coordinator.rebase(15);
    await expect(coordinator.flushLatest()).resolves.toBe(16);
    expect(coordinator.revisionResetRequired).toBe(false);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({
      expectedRevision: 15,
      snapshot: "newest local state",
    });
    expect(calls[1].writeToken).not.toBe(calls[0].writeToken);
  });

  it("keeps the conflicted snapshot pending when no newer snapshot is staged", async () => {
    const stale = new Error("stale revision");
    const calls: Array<SessionDraftMutation<string>> = [];
    const coordinator = new SessionDraftCoordinator<string>(
      async (mutation) => {
        calls.push(mutation);
        if (calls.length === 1) throw stale;
        return mutation.expectedRevision + 1;
      },
      {
        initialRevision: 2,
        createToken: tokenFactory(),
        isRevisionConflict: (error) => error === stale,
      },
    );

    await expect(coordinator.flushLatest("unsaved local state")).rejects.toBe(
      stale,
    );
    coordinator.rebase(9);
    await expect(coordinator.flushLatest()).resolves.toBe(10);

    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({
      expectedRevision: 9,
      snapshot: "unsaved local state",
    });
    expect(calls[1].writeToken).not.toBe(calls[0].writeToken);
  });

  it("refuses to rebase an ambiguous write that requires exact-token replay", async () => {
    const responseLost = new Error("response lost");
    const coordinator = new SessionDraftCoordinator<string>(
      vi.fn().mockRejectedValue(responseLost),
      { createToken: tokenFactory() },
    );

    await expect(coordinator.flushLatest("possibly committed")).rejects.toBe(
      responseLost,
    );
    expect(() => coordinator.rebase(5)).toThrow(
      "Cannot rebase an ambiguous workout save",
    );
  });

  it("waits for the latest acknowledgement before a finish can continue", async () => {
    const saved = controlledPromise<number>();
    const coordinator = new SessionDraftCoordinator<string>(
      () => saved.promise,
      { createToken: tokenFactory() },
    );
    const flushed = coordinator.flushLatest("finish snapshot");
    const onFlushed = vi.fn();
    void flushed.then(onFlushed);

    await drainMicrotasks();
    expect(onFlushed).not.toHaveBeenCalled();
    saved.resolve(1);
    await expect(flushed).resolves.toBe(1);
    expect(onFlushed).toHaveBeenCalledOnce();
  });

  it("rejects pending finish work when closed", async () => {
    const pending = controlledPromise<number>();
    const coordinator = new SessionDraftCoordinator<string>(
      () => pending.promise,
      { createToken: tokenFactory() },
    );
    const flushed = coordinator.flushLatest("draft");
    coordinator.close();

    await expect(flushed).rejects.toBeInstanceOf(
      SessionDraftCoordinatorClosedError,
    );
  });
});
