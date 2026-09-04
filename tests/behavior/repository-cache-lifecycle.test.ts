import { afterEach, describe, expect, it, vi } from "vitest";
import { LiftLogRepository } from "../../lib/repository";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function bootstrap(displayName: string) {
  return {
    data: {
      profile: {
        id: "viewer-1", firstName: "Test", lastName: "Viewer", displayName,
        liftlogId: "test-viewer", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      activeSession: null, activeWorkout: null, nextWorkouts: [],
    },
    error: null,
  };
}

function repositoryFor(client: unknown) {
  return new LiftLogRepository(client as never, "viewer-1", "Viewer");
}

function mutationBuilder(result: unknown, onMutation = () => {}) {
  const builder = {
    update: () => { onMutation(); return builder; },
    insert: () => { onMutation(); return builder; },
    delete: () => { onMutation(); return builder; },
    eq: () => builder,
    is: () => builder,
    select: () => builder,
    single: async () => result,
    maybeSingle: async () => result,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
  return builder;
}

afterEach(() => { vi.restoreAllMocks(); });

describe("repository cache lifecycle", () => {
  it("refreshes coalesced bootstrap readers across a successful mutation", async () => {
    const oldResponse = deferred<ReturnType<typeof bootstrap>>();
    let bootstrapReads = 0;
    const rpc = vi.fn((name: string) => {
      if (name === "get_workspace_bootstrap") {
        bootstrapReads += 1;
        return bootstrapReads === 1 ? oldResponse.promise : Promise.resolve(bootstrap("Fresh"));
      }
      return Promise.resolve({ data: "program-1", error: null });
    });
    const repository = repositoryFor({ rpc });
    const first = repository.loadBootstrap();
    const follower = repository.loadBootstrap();

    await repository.createBlankProgram("viewer-1", "New program");
    oldResponse.resolve(bootstrap("Stale"));

    const results = await Promise.all([first, follower]);
    expect(results.map((result) => result.profile.displayName)).toEqual(["Fresh", "Fresh"]);
    expect(bootstrapReads).toBe(2);
    await repository.loadBootstrap();
    expect(bootstrapReads).toBe(3); // Bootstrap coalesces but never retains mutable state.
  });

  it("does not sync a disposed account's timezone after its bootstrap arrives", async () => {
    const oldResponse = deferred<ReturnType<typeof bootstrap>>();
    const rpc = vi.fn(() => oldResponse.promise);
    const from = vi.fn();
    const repository = repositoryFor({ rpc, from });
    const read = repository.loadBootstrap();
    const settled = Promise.allSettled([read]);
    repository.dispose();
    const result = bootstrap("Old account");
    result.data.profile.timezone = "Changed/Timezone";
    oldResponse.resolve(result);

    expect(await settled).toEqual([
      { status: "rejected", reason: expect.objectContaining({ message: "This data workspace is no longer active" }) },
    ]);
    expect(from).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("refreshes a pending coaching overview after cancelling an invitation", async () => {
    const repository = repositoryFor({ rpc: vi.fn().mockResolvedValue({ data: null, error: null }) });
    const pending = deferred<{ coachConnections: never[]; pendingCoachInvites: never[]; outgoingCoachInvites: Array<{ id: string }> }>();
    const mutable = repository as unknown as Record<string, unknown>;
    const access = vi.fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue({ coachConnections: [], pendingCoachInvites: [], outgoingCoachInvites: [] });
    mutable.loadCoachingAccessSummary = access;
    mutable.listCoachAthletes = vi.fn().mockResolvedValue({ items: [], hasMore: false });
    const first = repository.loadCoachingWorkspace();
    const follower = repository.loadCoachingWorkspace();

    await repository.cancelCoachInvite("invite-1");
    pending.resolve({ coachConnections: [], pendingCoachInvites: [], outgoingCoachInvites: [{ id: "invite-1" }] });

    const results = await Promise.all([first, follower]);
    expect(results.every((result) => result.outgoingCoachInvites.length === 0)).toBe(true);
    expect(access).toHaveBeenCalledTimes(2);
  });

  it.each(["create", "update", "delete"])("refreshes the exercise workspace after a successful %s", async (operation) => {
    let changed = false;
    const row = {
      id: "exercise-1", scope: "personal", owner_id: "viewer-1", name: "Updated exercise",
      category: "Custom", cue: "", default_entry_mode: "sets", default_tracking_fields: ["reps"],
    };
    const builder = mutationBuilder({ data: row, error: null, count: 1 }, () => { changed = true; });
    const rpc = vi.fn(async (_name: string, args: { scope_filter: string }) => ({
      data: args.scope_filter === "personal" && !(changed && operation === "delete")
        ? [{ ...row, name: changed ? "Updated exercise" : "Original exercise" }] : [],
      error: null,
    }));
    const repository = repositoryFor({ rpc, from: () => builder });
    expect((await repository.loadExerciseWorkspace()).personalExercises[0].name).toBe("Original exercise");

    const input = { name: "Updated exercise", category: "Custom", cue: "", mode: "sets" as const, fields: ["reps" as const] };
    if (operation === "create") await repository.createPersonalExercise(input);
    if (operation === "update") await repository.updatePersonalExercise("exercise-1", input);
    if (operation === "delete") await repository.deletePersonalExercise("exercise-1");

    const fresh = await repository.loadExerciseWorkspace();
    expect(fresh.personalExercises.map((exercise) => exercise.name))
      .toEqual(operation === "delete" ? [] : ["Updated exercise"]);
    expect(rpc).toHaveBeenCalledTimes(4);
  });

  it("drops cached athlete results when coaching access ends", async () => {
    const builder = mutationBuilder({ data: [{ id: "relationship-1" }], error: null });
    const repository = repositoryFor({ from: () => builder });
    const mutable = repository as unknown as Record<string, unknown>;
    const load = vi.fn().mockResolvedValueOnce({ id: "session-1", items: [] }).mockResolvedValue(null);
    mutable.loadCompletedSessionDetailUncached = load;
    expect(await repository.loadCompletedSessionDetail("session-1", "athlete-1")).not.toBeNull();

    await repository.endCoachRelationship("relationship-1");

    expect(await repository.loadCompletedSessionDetail("session-1", "athlete-1")).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it.each(["create", "rename", "delete", "copy"])("refreshes program listings after %s without relying on the UI to clear caches", async (operation) => {
    let changed = false;
    const row = {
      id: "program-1", program_id: "program-1", athlete_id: "viewer-1", version_id: "version-1",
      title: "Original program", created_by_id: "viewer-1", created_at: "2026-09-04T12:00:00Z",
      version_status: "draft", kind: "program",
    };
    const rpc = vi.fn(async (name: string) => {
      if (name === "list_program_summaries") return {
        data: changed && operation === "delete" ? [] : [{ ...row, title: changed ? "Updated program" : row.title }],
        error: null,
      };
      changed = true;
      return { data: "program-1", error: null };
    });
    const repository = repositoryFor({
      rpc,
      from: () => mutationBuilder({ data: { id: "program-1" }, error: null }, () => { changed = true; }),
    });
    expect((await repository.listProgramSummaries()).items[0].title).toBe("Original program");

    if (operation === "create") await repository.createBlankProgram("viewer-1", "Updated program");
    if (operation === "rename") await repository.updateProgramTitle("program-1", "Updated program");
    if (operation === "delete") await repository.deleteOwnProgram("program-1");
    if (operation === "copy") await repository.copyProgramToOwn("program-1");

    expect((await repository.listProgramSummaries()).items.map((program) => program.title))
      .toEqual(operation === "delete" ? [] : ["Updated program"]);
  });

  it.each(["title", "description"])("does not report a successful %s update when no row was written", async (field) => {
    const repository = repositoryFor({ from: () => mutationBuilder({ data: null, error: null }) });
    await expect(field === "title"
      ? repository.updateProgramTitle("missing", "New title")
      : repository.updateProgramDescription("missing", "New description"))
      .rejects.toThrow(field === "title" ? "Could not save the program name" : "Could not save the program description");
  });

  it("refreshes selected-version pointers while retaining exact immutable snapshots", async () => {
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    let selectedVersion = "version-1";
    const rpc = vi.fn(async (_name: string, args: { target_version_id: string | null }) => ({
      data: {
        kind: "program", id: "program-1", programId: "program-1", athleteId: "viewer-1",
        createdById: "viewer-1", versionId: args.target_version_id ?? selectedVersion,
        versionStatus: "published", versionNumber: 1, title: "Program", description: "",
        sourceType: "self", contentType: "program", phases: [], weeks: [],
      },
      error: null,
    }));
    const repository = repositoryFor({ rpc });
    await repository.getProgramVersionDetail({ programId: "program-1" });
    await repository.getProgramVersionDetail({ programId: "program-1", versionId: "version-1" });
    now += 31_000;
    selectedVersion = "version-2";

    expect((await repository.getProgramVersionDetail({ programId: "program-1" }))?.versionId).toBe("version-2");
    expect((await repository.getProgramVersionDetail({ programId: "program-1", versionId: "version-1" }))?.versionId).toBe("version-1");
    expect(rpc).toHaveBeenCalledTimes(3);
  });
});
