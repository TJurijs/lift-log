import { describe, expect, it, vi } from "vitest";

import {
  SessionDraftCoordinator,
  type SessionDraftMutation,
} from "../../lib/session-draft-coordinator";
import { flushSessionDraftWithRecovery } from "../../lib/session-draft-recovery";

class RevisionConflict extends Error {}

function tokenFactory() {
  let next = 0;
  return () =>
    `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`;
}

function coordinatorFor<Snapshot>(
  write: (mutation: SessionDraftMutation<Snapshot>) => Promise<number>,
  initialRevision = 0,
) {
  return new SessionDraftCoordinator(write, {
    initialRevision,
    createToken: tokenFactory(),
    isRevisionConflict: (error) => error instanceof RevisionConflict,
  });
}

describe("flushSessionDraftWithRecovery", () => {
  it("reloads the authoritative revision and flushes a freshly prepared snapshot", async () => {
    const writes: Array<SessionDraftMutation<string>> = [];
    const coordinator = coordinatorFor<string>(async (mutation) => {
      writes.push(mutation);
      if (writes.length === 1) throw new RevisionConflict("stale");
      return mutation.expectedRevision + 1;
    });
    const loadAuthoritativeRevision = vi.fn().mockResolvedValue(15);
    const getLatestSnapshot = vi
      .fn()
      .mockReturnValueOnce("initial snapshot")
      .mockReturnValueOnce("latest snapshot after reload");

    await expect(
      flushSessionDraftWithRecovery({
        coordinator,
        getLatestSnapshot,
        isRevisionConflict: (error) => error instanceof RevisionConflict,
        loadAuthoritativeRevision,
      }),
    ).resolves.toBe(16);

    expect(loadAuthoritativeRevision).toHaveBeenCalledOnce();
    expect(getLatestSnapshot).toHaveBeenNthCalledWith(1, {
      recoveryAttempt: 0,
    });
    expect(getLatestSnapshot).toHaveBeenNthCalledWith(2, {
      authoritativeRevision: 15,
      recoveryAttempt: 1,
    });
    expect(writes).toHaveLength(2);
    expect(writes[1]).toMatchObject({
      expectedRevision: 15,
      snapshot: "latest snapshot after reload",
    });
    expect(writes[1].writeToken).not.toBe(writes[0].writeToken);
  });

  it("prepares the latest snapshot again on every bounded conflict retry", async () => {
    const conflicts = [
      new RevisionConflict("first stale revision"),
      new RevisionConflict("second stale revision"),
      new RevisionConflict("third stale revision"),
    ];
    const writes: Array<SessionDraftMutation<string>> = [];
    const coordinator = coordinatorFor<string>(async (mutation) => {
      writes.push(mutation);
      throw conflicts[writes.length - 1];
    });
    const loadAuthoritativeRevision = vi
      .fn()
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(8);
    const getLatestSnapshot = vi.fn(
      ({ recoveryAttempt }: { recoveryAttempt: number }) =>
        `latest snapshot ${recoveryAttempt}`,
    );

    await expect(
      flushSessionDraftWithRecovery({
        coordinator,
        getLatestSnapshot,
        isRevisionConflict: (error) => error instanceof RevisionConflict,
        loadAuthoritativeRevision,
        maxRevisionRecoveries: 2,
      }),
    ).rejects.toBe(conflicts[2]);

    expect(loadAuthoritativeRevision).toHaveBeenCalledTimes(2);
    expect(getLatestSnapshot).toHaveBeenCalledTimes(3);
    expect(writes.map(({ expectedRevision, snapshot }) => ({
      expectedRevision,
      snapshot,
    }))).toEqual([
      { expectedRevision: 0, snapshot: "latest snapshot 0" },
      { expectedRevision: 5, snapshot: "latest snapshot 1" },
      { expectedRevision: 8, snapshot: "latest snapshot 2" },
    ]);
    expect(coordinator.revisionResetRequired).toBe(true);
  });

  it("preserves ambiguous transport failures for exact-token replay", async () => {
    const responseLost = new Error("response lost");
    const writes: Array<SessionDraftMutation<string>> = [];
    const coordinator = coordinatorFor<string>(async (mutation) => {
      writes.push(mutation);
      if (writes.length === 1) throw responseLost;
      return mutation.expectedRevision + 1;
    });
    const loadAuthoritativeRevision = vi.fn().mockResolvedValue(50);

    await expect(
      flushSessionDraftWithRecovery({
        coordinator,
        getLatestSnapshot: () => "possibly committed snapshot",
        isRevisionConflict: (error) => error instanceof RevisionConflict,
        loadAuthoritativeRevision,
      }),
    ).rejects.toBe(responseLost);

    expect(loadAuthoritativeRevision).not.toHaveBeenCalled();
    expect(coordinator.revisionResetRequired).toBe(false);
    await expect(coordinator.flushLatest()).resolves.toBe(1);
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(writes[0]);
  });

  it("returns an authoritative-load transport error without consuming retries", async () => {
    const loadFailed = new Error("failed to fetch authoritative session");
    const coordinator = coordinatorFor<string>(async () => {
      throw new RevisionConflict("stale");
    });
    const loadAuthoritativeRevision = vi.fn().mockRejectedValue(loadFailed);
    const getLatestSnapshot = vi.fn().mockReturnValue("latest local snapshot");

    await expect(
      flushSessionDraftWithRecovery({
        coordinator,
        getLatestSnapshot,
        isRevisionConflict: (error) => error instanceof RevisionConflict,
        loadAuthoritativeRevision,
      }),
    ).rejects.toBe(loadFailed);

    expect(loadAuthoritativeRevision).toHaveBeenCalledOnce();
    expect(getLatestSnapshot).toHaveBeenCalledOnce();
    expect(coordinator.revisionResetRequired).toBe(true);
  });

  it("can reload authority before the first write after a stale completion handshake", async () => {
    const writes: Array<SessionDraftMutation<string>> = [];
    const coordinator = coordinatorFor<string>(async (mutation) => {
      writes.push(mutation);
      return mutation.expectedRevision + 1;
    }, 4);
    const loadAuthoritativeRevision = vi.fn().mockResolvedValue(9);
    const getLatestSnapshot = vi.fn().mockReturnValue("merged latest snapshot");

    await expect(
      flushSessionDraftWithRecovery({
        coordinator,
        getLatestSnapshot,
        isRevisionConflict: (error) => error instanceof RevisionConflict,
        loadAuthoritativeRevision,
        startWithAuthoritativeRevision: true,
      }),
    ).resolves.toBe(10);

    expect(loadAuthoritativeRevision).toHaveBeenCalledOnce();
    expect(getLatestSnapshot).toHaveBeenCalledOnce();
    expect(writes).toEqual([
      expect.objectContaining({
        expectedRevision: 9,
        snapshot: "merged latest snapshot",
      }),
    ]);
  });
});
