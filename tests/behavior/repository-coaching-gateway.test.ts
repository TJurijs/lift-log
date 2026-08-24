import { describe, expect, it, vi } from "vitest";
import { LiftLogRepository } from "../../lib/repository";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function repositoryWithLoaders() {
  const repository = new LiftLogRepository(
    {} as ConstructorParameters<typeof LiftLogRepository>[0],
    "viewer-1",
    "Viewer",
  );
  const mutable = repository as unknown as Record<string, unknown>;
  return { repository, mutable };
}

describe("coaching workspace gateway", () => {
  it("returns only the bounded coaching read model", async () => {
    const { repository, mutable } = repositoryWithLoaders();
    mutable.loadCoachConnections = vi.fn().mockResolvedValue([{ coachId: "c1" }]);
    mutable.loadCoachedAthletes = vi.fn().mockResolvedValue([{ id: "a1" }]);
    mutable.loadPendingCoachInvites = vi.fn().mockResolvedValue([{ id: "p1" }]);
    mutable.loadOutgoingCoachInvites = vi.fn().mockResolvedValue([{ id: "o1" }]);

    await expect(repository.loadCoachingWorkspace()).resolves.toEqual({
      coachConnections: [{ coachId: "c1" }],
      coachedAthletes: [{ id: "a1" }],
      pendingCoachInvites: [{ id: "p1" }],
      outgoingCoachInvites: [{ id: "o1" }],
    });
  });

  it("coalesces concurrent refreshes into one request group", async () => {
    const { repository, mutable } = repositoryWithLoaders();
    const athletes = deferred<never[]>();
    const loaders = {
      loadCoachConnections: vi.fn().mockResolvedValue([]),
      loadCoachedAthletes: vi.fn(() => athletes.promise),
      loadPendingCoachInvites: vi.fn().mockResolvedValue([]),
      loadOutgoingCoachInvites: vi.fn().mockResolvedValue([]),
    };
    Object.assign(mutable, loaders);

    const first = repository.loadCoachingWorkspace();
    const second = repository.loadCoachingWorkspace();
    athletes.resolve([]);
    await expect(Promise.all([first, second])).resolves.toEqual([
      {
        coachConnections: [],
        coachedAthletes: [],
        pendingCoachInvites: [],
        outgoingCoachInvites: [],
      },
      {
        coachConnections: [],
        coachedAthletes: [],
        pendingCoachInvites: [],
        outgoingCoachInvites: [],
      },
    ]);

    Object.values(loaders).forEach((loader) => expect(loader).toHaveBeenCalledTimes(1));
  });

  it("allows a clean retry after a failed refresh", async () => {
    const { repository, mutable } = repositoryWithLoaders();
    const athletes = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([]);
    Object.assign(mutable, {
      loadCoachConnections: vi.fn().mockResolvedValue([]),
      loadCoachedAthletes: athletes,
      loadPendingCoachInvites: vi.fn().mockResolvedValue([]),
      loadOutgoingCoachInvites: vi.fn().mockResolvedValue([]),
    });

    await expect(repository.loadCoachingWorkspace()).rejects.toThrow("offline");
    await expect(repository.loadCoachingWorkspace()).resolves.toMatchObject({
      coachedAthletes: [],
    });
    expect(athletes).toHaveBeenCalledTimes(2);
  });
});
