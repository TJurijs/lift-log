import { describe, expect, it, vi } from "vitest";
import type { CompletedSessionDetail } from "../../lib/domain";
import { LiftLogRepository } from "../../lib/repository";

function makeRepository(viewerId = "viewer-1") {
  const repository = new LiftLogRepository(
    {} as ConstructorParameters<typeof LiftLogRepository>[0],
    viewerId,
    "Viewer",
  );
  return {
    repository,
    mutable: repository as unknown as Record<string, unknown>,
  };
}

const completed = {
  id: "session-1",
  workoutTitle: "Workout",
  date: "2026-08-24",
  durationMinutes: 45,
  rpe: 7,
  items: [],
} as CompletedSessionDetail;

describe("immutable repository caches", () => {
  it("coalesces exact published-version reads by stable identity", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        kind: "program",
        id: "program-1",
        programId: "program-1",
        athleteId: "viewer-1",
        createdById: "viewer-1",
        versionId: "version-1",
        versionStatus: "published",
        versionNumber: 1,
        title: "Program",
        description: "",
        sourceType: "self",
        contentType: "program",
        phases: [],
        weeks: [],
      },
      error: null,
    });
    const repository = new LiftLogRepository(
      { rpc } as never,
      "viewer-1",
      "Viewer",
    );

    await Promise.all([
      repository.loadProgramVersionForAthleteById("athlete-1", "program-1", "version-1"),
      repository.loadProgramVersionForAthleteById("athlete-1", "program-1", "version-1"),
    ]);
    await repository.loadProgramVersionForAthleteById(
      "athlete-1",
      "program-1",
      "version-1",
    );

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("get_program_version_detail", {
      target_program_id: "program-1",
      target_assignment_id: null,
      target_version_id: "version-1",
    });
  });

  it("caches immutable completed results per athlete and session", async () => {
    const { repository, mutable } = makeRepository();
    const load = vi.fn().mockResolvedValue(completed);
    mutable.loadCompletedSessionDetailUncached = load;

    await repository.loadCompletedSessionDetail("session-1", "athlete-1");
    await repository.loadCompletedSessionDetail("session-1", "athlete-1");
    await repository.loadCompletedSessionDetail("session-1", "athlete-2");

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("evicts rejected reads so reconnect can retry", async () => {
    const { repository, mutable } = makeRepository();
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(completed);
    mutable.loadCompletedSessionDetailUncached = load;

    await expect(
      repository.loadCompletedSessionDetail("session-1"),
    ).rejects.toThrow("offline");
    await expect(
      repository.loadCompletedSessionDetail("session-1"),
    ).resolves.toBe(completed);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("purges account-scoped cached data on dispose", async () => {
    const { repository, mutable } = makeRepository();
    const load = vi.fn().mockResolvedValue(completed);
    mutable.loadCompletedSessionDetailUncached = load;

    await repository.loadCompletedSessionDetail("session-1");
    repository.dispose();
    await repository.loadCompletedSessionDetail("session-1");

    expect(load).toHaveBeenCalledTimes(2);
  });
});
