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

  it("surfaces stale conflicts without discarding the exact failed mutation", async () => {
    const stale = new Error("Workout draft changed on another device");
    const writer = vi.fn().mockRejectedValue(stale);
    const onError = vi.fn();
    const coordinator = new SessionDraftCoordinator<string>(writer, {
      createToken: tokenFactory(),
      onError,
    });

    coordinator.stage("local");
    await expect(coordinator.flushLatest()).rejects.toBe(stale);
    expect(coordinator.status).toBe("error");
    expect(coordinator.hasUnsavedChanges).toBe(true);
    expect(onError).toHaveBeenCalledWith(stale);

    await expect(coordinator.flushLatest()).rejects.toBe(stale);
    expect(writer.mock.calls[1][0]).toEqual(writer.mock.calls[0][0]);
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
