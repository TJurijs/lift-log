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
    mutable.loadCoachingAccessSummary = vi.fn().mockResolvedValue({
      coachConnections: [{ coachId: "c1" }],
      pendingCoachInvites: [{ id: "p1" }],
      outgoingCoachInvites: [{ id: "o1" }],
    });
    mutable.listCoachAthletes = vi.fn().mockResolvedValue({
      items: [{ id: "a1" }],
      hasMore: true,
      nextCursor: { displayName: "Athlete", id: "a1" },
    });

    await expect(repository.loadCoachingWorkspace()).resolves.toEqual({
      coachConnections: [{ coachId: "c1" }],
      coachedAthletes: [{ id: "a1" }],
      pendingCoachInvites: [{ id: "p1" }],
      outgoingCoachInvites: [{ id: "o1" }],
      coachAthleteCursor: { displayName: "Athlete", id: "a1" },
    });
    expect(mutable.listCoachAthletes).toHaveBeenCalledWith({ limit: 25 });
  });

  it("coalesces concurrent refreshes into one request group", async () => {
    const { repository, mutable } = repositoryWithLoaders();
    const athletes = deferred<{ items: never[]; hasMore: false }>();
    const loaders = {
      loadCoachingAccessSummary: vi.fn().mockResolvedValue({
        coachConnections: [],
        pendingCoachInvites: [],
        outgoingCoachInvites: [],
      }),
      listCoachAthletes: vi.fn(() => athletes.promise),
    };
    Object.assign(mutable, loaders);

    const first = repository.loadCoachingWorkspace();
    const second = repository.loadCoachingWorkspace();
    athletes.resolve({ items: [], hasMore: false });
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
      .mockResolvedValueOnce({ items: [], hasMore: false });
    Object.assign(mutable, {
      loadCoachingAccessSummary: vi.fn().mockResolvedValue({
        coachConnections: [],
        pendingCoachInvites: [],
        outgoingCoachInvites: [],
      }),
      listCoachAthletes: athletes,
    });

    await expect(repository.loadCoachingWorkspace()).rejects.toThrow("offline");
    await expect(repository.loadCoachingWorkspace()).resolves.toMatchObject({
      coachedAthletes: [],
    });
    expect(athletes).toHaveBeenCalledTimes(2);
  });
});
