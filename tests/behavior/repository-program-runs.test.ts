import { describe, expect, it, vi } from "vitest";

import { LiftLogRepository } from "../../lib/repository";

function repositoryWithRpc(rpc: ReturnType<typeof vi.fn>) {
  const from = vi.fn(() => {
    throw new Error("program-run gateways must not fan out through tables");
  });
  return {
    repository: new LiftLogRepository(
      { rpc, from } as never,
      "viewer-1",
      "Viewer One",
    ),
    from,
  };
}

describe("program-run repository gateways", () => {
  it("invalidates every cached run detail after an occurrence mutation", async () => {
    const runPayload = (runId: string) => ({
      id: runId,
      athleteId: "viewer-1",
      createdById: "viewer-1",
      programId: "program-1",
      programVersionId: "version-1",
      title: "Plan",
      status: "not_started",
      totalWorkouts: 0,
      scheduledWorkouts: 0,
      completedWorkouts: 0,
      completionPercent: 0,
      createdAt: "2026-09-01T09:00:00Z",
      workouts: [],
    });
    const rpc = vi.fn(async (name: string, parameters?: Record<string, unknown>) => {
      if (name === "get_program_run_detail") {
        return {
          data: runPayload(String(parameters?.target_run_id)),
          error: null,
        };
      }
      if (name === "schedule_workout") return { data: null, error: null };
      throw new Error(`Unexpected RPC ${name}`);
    });
    const { repository } = repositoryWithRpc(rpc);

    await repository.loadProgramRunDetail("run-1");
    await repository.loadProgramRunDetail("run-1");
    await repository.loadProgramRunDetail("run-2");
    expect(
      rpc.mock.calls.filter(([name]) => name === "get_program_run_detail"),
    ).toHaveLength(2);

    await repository.scheduleWorkout("schedule-1", "2026-09-07");
    await repository.loadProgramRunDetail("run-1");
    await repository.loadProgramRunDetail("run-2");

    expect(
      rpc.mock.calls.filter(([name]) => name === "get_program_run_detail"),
    ).toHaveLength(4);
  });

  it("creates self and coach runs through one idempotent batch payload", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          athlete_id: "athlete-1",
          run_id: "run-1",
          program_id: "program-1",
          program_version_id: "version-1",
          created: true,
        },
        {
          athlete_id: "athlete-2",
          run_id: "run-2",
          program_id: "program-1",
          program_version_id: "version-1",
          created: true,
        },
      ],
      error: null,
    });
    const { repository, from } = repositoryWithRpc(rpc);

    await expect(
      repository.createProgramRuns(
        "program-1",
        ["athlete-1", "athlete-1", "athlete-2"],
        [
          { workoutId: "workout-1", plannedDate: "2026-09-07" },
          { workoutId: "workout-2" },
        ],
        "request-1",
      ),
    ).resolves.toEqual([
      {
        athleteId: "athlete-1",
        runId: "run-1",
        programId: "program-1",
        programVersionId: "version-1",
        created: true,
      },
      {
        athleteId: "athlete-2",
        runId: "run-2",
        programId: "program-1",
        programVersionId: "version-1",
        created: true,
      },
    ]);
    expect(rpc).toHaveBeenCalledWith("create_program_runs", {
      target_program_id: "program-1",
      target_athlete_ids: ["athlete-1", "athlete-2"],
      target_workout_dates: [
        { workoutId: "workout-1", plannedDate: "2026-09-07" },
        { workoutId: "workout-2", plannedDate: null },
      ],
      target_idempotency_key: "request-1",
      target_repeated_from_run_id: null,
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("maps complete run aggregates independently of the bounded Next payload", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          id: "run-40",
          athlete_id: "athlete-1",
          created_by_id: "coach-1",
          program_id: "program-1",
          program_version_id: "version-1",
          title: "Ten-week plan",
          status: "in_progress",
          total_workouts: 40,
          scheduled_workouts: 6,
          completed_workouts: 11,
          completion_percent: 28,
          next_workout_id: "slot-12",
          next_workout_title: "Workout 12",
          next_workout_date: null,
          next_workout_status: "unscheduled",
          repeated_from_run_id: null,
          created_at: "2026-09-01T09:00:00Z",
          ended_at: null,
        },
      ],
      error: null,
    });
    const { repository, from } = repositoryWithRpc(rpc);

    await expect(repository.listProgramRuns("athlete-1")).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: "run-40",
          status: "in_progress",
          totalWorkouts: 40,
          scheduledWorkouts: 6,
          completedWorkouts: 11,
          completionPercent: 28,
          nextWorkout: {
            id: "slot-12",
            title: "Workout 12",
            status: "unscheduled",
          },
        }),
      ],
      hasMore: false,
    });
    expect(rpc).toHaveBeenCalledWith("list_program_run_summaries", {
      target_athlete_id: "athlete-1",
      page_limit: 26,
      after_created_at: null,
      after_id: null,
      creator_scope: "all",
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("keeps older backends usable while the additive run RPC rolls out", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: "PGRST202",
        message: "Could not find the function public.list_program_run_summaries",
      },
    });
    const { repository } = repositoryWithRpc(rpc);

    await expect(repository.listProgramRuns()).resolves.toEqual({
      items: [],
      hasMore: false,
    });
  });

  it("returns and forwards an immutable run-created keyset cursor", async () => {
    const rows = Array.from({ length: 26 }, (_, index) => ({
      id: `run-${String(index + 1).padStart(2, "0")}`,
      athlete_id: "viewer-1",
      created_by_id: "viewer-1",
      program_id: "program-1",
      program_version_id: "version-1",
      title: `Run ${index + 1}`,
      status: "ended",
      total_workouts: 3,
      scheduled_workouts: 3,
      completed_workouts: 2,
      completion_percent: 67,
      created_at: `2026-08-${String(26 - index).padStart(2, "0")}T10:00:00.000Z`,
      ended_at: `2026-08-${String(26 - index).padStart(2, "0")}T10:00:00.000Z`,
      finished_at: `2026-08-${String(26 - index).padStart(2, "0")}T10:00:00.000Z`,
    }));
    const rpc = vi.fn().mockResolvedValue({ data: rows, error: null });
    const { repository } = repositoryWithRpc(rpc);

    const page = await repository.listProgramRuns(undefined, { limit: 25 });

    expect(page.items).toHaveLength(25);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toEqual({
      createdAt: "2026-08-02T10:00:00.000Z",
      id: "run-25",
    });
    if (!page.nextCursor) throw new Error("expected another run-summary page");

    await repository.listProgramRuns(undefined, {
      limit: 25,
      cursor: page.nextCursor,
    });
    expect(rpc).toHaveBeenLastCalledWith("list_program_run_summaries", {
      target_athlete_id: null,
      page_limit: 26,
      after_created_at: "2026-08-02T10:00:00.000Z",
      after_id: "run-25",
      creator_scope: "all",
    });
  });

  it("pages coach-authored runs independently from self-created history", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const { repository } = repositoryWithRpc(rpc);

    await repository.listProgramRuns(undefined, { creatorScope: "coach" });

    expect(rpc).toHaveBeenCalledWith("list_program_run_summaries", {
      target_athlete_id: null,
      page_limit: 26,
      after_created_at: null,
      after_id: null,
      creator_scope: "coach",
    });
  });

  it("loads the immutable revision selected by a run rather than the latest draft", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        kind: "run",
        id: "run-1",
        programRunId: "run-1",
        programId: "program-1",
        athleteId: "viewer-1",
        createdById: "coach-1",
        versionId: "version-used",
        versionNumber: 2,
        versionStatus: "published",
        title: "Assigned revision",
        description: "The preserved plan",
        planningMode: "sequence",
        sourceType: "coach",
        contentType: "program",
        phases: [],
        weeks: [],
      },
      error: null,
    });
    const { repository } = repositoryWithRpc(rpc);

    await expect(repository.loadProgramForRun("run-1")).resolves.toEqual(
      expect.objectContaining({
        id: "program-1",
        programRunId: "run-1",
        versionId: "version-used",
        versionStatus: "published",
        sourceType: "coach",
      }),
    );
    expect(rpc).toHaveBeenCalledWith("get_program_run_program_detail", {
      target_run_id: "run-1",
    });
  });

  it("repeats into a new run without reusing the source identity", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        athleteId: "viewer-1",
        runId: "run-new",
        programId: "program-1",
        programVersionId: "version-1",
        created: true,
      },
      error: null,
    });
    const { repository } = repositoryWithRpc(rpc);

    await expect(
      repository.repeatProgramRun(
        "run-old",
        [{ workoutId: "workout-1", plannedDate: "2026-10-01" }],
        "repeat-request",
      ),
    ).resolves.toMatchObject({ runId: "run-new", created: true });
    expect(rpc).toHaveBeenCalledWith("repeat_program_run", {
      target_run_id: "run-old",
      target_workout_dates: [
        { workoutId: "workout-1", plannedDate: "2026-10-01" },
      ],
      target_idempotency_key: "repeat-request",
    });
  });

  it("bulk-schedules future slots and keeps an omitted date explicit", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: { runId: "run-1" }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    const { repository, from } = repositoryWithRpc(rpc);

    await expect(
      repository.scheduleProgramRunWorkouts(
        "run-1",
        [
          { workoutId: "workout-1", plannedDate: "2026-09-07" },
          { workoutId: "workout-2" },
        ],
        "schedule-request",
      ),
    ).resolves.toBeNull();
    expect(rpc).toHaveBeenNthCalledWith(1, "schedule_program_run_workouts", {
      target_run_id: "run-1",
      target_workout_dates: [
        { workoutId: "workout-1", plannedDate: "2026-09-07" },
        { workoutId: "workout-2", plannedDate: null },
      ],
      target_idempotency_key: "schedule-request",
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "get_program_run_detail", {
      target_run_id: "run-1",
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("maps and orders every materialized workout in run detail", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        id: "run-1",
        athleteId: "viewer-1",
        createdById: "viewer-1",
        programId: "program-1",
        programVersionId: "version-1",
        title: "Plan",
        status: "in_progress",
        totalWorkouts: 2,
        scheduledWorkouts: 1,
        completedWorkouts: 0,
        completionPercent: 0,
        createdAt: "2026-09-01T09:00:00Z",
        workouts: [
          {
            id: "slot-2",
            runId: "run-1",
            workoutId: "workout-2",
            title: "Second",
            position: 1,
            estimatedMinutes: 45,
            status: "scheduled",
            plannedDate: "2026-09-10",
            scheduledWorkoutId: "schedule-2",
            sessionId: "session-2",
            completedAt: "2026-09-10T10:00:00Z",
            completedForDate: "2026-09-10",
            sessionRpe: "8",
            prescriptionOverrides: { loadKg: 70 },
          },
          {
            id: "slot-1",
            runId: "run-1",
            workoutId: "workout-1",
            title: "First",
            position: 0,
            estimatedMinutes: 60,
            status: "unscheduled",
            prescriptionOverrides: {},
          },
        ],
      },
      error: null,
    });
    const { repository, from } = repositoryWithRpc(rpc);

    await expect(repository.loadProgramRunDetail("run-1")).resolves.toMatchObject({
      id: "run-1",
      workouts: [
        { id: "slot-1", position: 0, status: "unscheduled" },
        {
          id: "slot-2",
          position: 1,
          plannedDate: "2026-09-10",
          sessionId: "session-2",
          completedForDate: "2026-09-10",
          sessionRpe: 8,
          prescriptionOverrides: { loadKg: 70 },
        },
      ],
    });
    expect(rpc).toHaveBeenCalledWith("get_program_run_detail", {
      target_run_id: "run-1",
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("pages every upcoming occurrence with a stable date and id cursor", async () => {
    const row = (id: string, date: string) => ({
      id,
      athlete_id: "viewer-1",
      scheduled_by_id: "coach-1",
      program_run_id: "run-1",
      program_run_workout_id: `slot-${id}`,
      program_id: "program-1",
      program_version_id: "version-1",
      program_title: "Ten-week plan",
      workout_id: `workout-${id}`,
      workout_title: `Workout ${id}`,
      planned_date: date,
      sequence_number: Number(id),
      estimated_minutes: 60,
      status: id === "2" ? "skipped" : "planned",
      source_type: "coach",
    });
    const rpc = vi.fn().mockResolvedValue({
      data: [
        row("1", "2026-09-10"),
        row("2", "2026-09-11"),
        row("3", "2026-09-12"),
      ],
      error: null,
    });
    const { repository, from } = repositoryWithRpc(rpc);

    await expect(
      repository.listUpcomingScheduledWorkouts({
        limit: 2,
        cursor: { plannedDate: "2026-09-09", id: "cursor-0" },
      }),
    ).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: "1",
          programRunId: "run-1",
          sourceType: "coach",
          plannedDate: "2026-09-10",
          workout: expect.objectContaining({ durationMinutes: 60 }),
        }),
        expect.objectContaining({ id: "2", status: "skipped" }),
      ],
      hasMore: true,
      nextCursor: { plannedDate: "2026-09-11", id: "2" },
    });
    expect(rpc).toHaveBeenCalledWith("list_upcoming_scheduled_workouts", {
      page_limit: 3,
      after_planned_date: "2026-09-09",
      after_id: "cursor-0",
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("duplicates the exact immutable revision selected by a run", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: "program-copy",
      error: null,
    });
    const { repository, from } = repositoryWithRpc(rpc);

    await expect(repository.copyProgramRunToOwn("run-1")).resolves.toBe(
      "program-copy",
    );
    expect(rpc).toHaveBeenCalledWith("copy_program_run_to_own", {
      target_run_id: "run-1",
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("ends a run through the history-preserving command", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const { repository } = repositoryWithRpc(rpc);

    await expect(repository.endProgramRun("run-1")).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith("end_program_run", {
      target_run_id: "run-1",
    });
  });

  it("pages authored coach history with a stable cursor and preserves run identities", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          id: "session-3",
          programRunId: "run-2",
          programRunWorkoutId: "run-workout-3",
          programId: "program-1",
          programVersionId: "version-1",
          programTitle: "Balanced strength",
          workoutId: "workout-3",
          workoutTitle: "Third workout",
          completedForDate: "2026-09-03",
          completedAt: "2026-09-03T11:00:00.000Z",
          startedAt: "2026-09-03T10:00:00.000Z",
          sessionRpe: "8",
        },
        {
          id: "session-2",
          program_run_id: "run-1",
          program_run_workout_id: "run-workout-2",
          program_id: "program-1",
          program_version_id: "version-1",
          program_title: "Balanced strength",
          workout_id: "workout-2",
          workout_title: "Second workout",
          completed_for_date: "2026-09-02",
          completed_at: "2026-09-02T11:00:00.000Z",
          started_at: "2026-09-02T10:00:00.000Z",
          session_rpe: 7,
        },
        {
          id: "session-1",
          programId: "program-1",
          programVersionId: "version-1",
          programTitle: "Balanced strength",
          workoutTitle: "First workout",
          completedForDate: "2026-09-01",
          startedAt: "2026-09-01T10:00:00.000Z",
        },
      ],
      error: null,
    });
    const { repository, from } = repositoryWithRpc(rpc);

    await expect(
      repository.listCoachCompletedHistory("athlete-1", {
        limit: 2,
        cursor: {
          startedAt: "2026-09-04T10:00:00.000Z",
          id: "session-4",
        },
      }),
    ).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: "session:session-3",
          programRunId: "run-2",
          programRunWorkoutId: "run-workout-3",
          workoutId: "workout-3",
          date: "2026-09-03",
          rpe: 8,
        }),
        expect.objectContaining({
          id: "session:session-2",
          programRunId: "run-1",
          programRunWorkoutId: "run-workout-2",
          workoutId: "workout-2",
          date: "2026-09-02",
          rpe: 7,
        }),
      ],
      hasMore: true,
      nextCursor: {
        startedAt: "2026-09-02T10:00:00.000Z",
        id: "session-2",
      },
    });
    expect(rpc).toHaveBeenCalledWith(
      "list_authored_coach_session_summaries",
      {
        target_athlete_id: "athlete-1",
        target_limit: 3,
        target_before_started_at: "2026-09-04T10:00:00.000Z",
        target_before_id: "session-4",
      },
    );
    expect(from).not.toHaveBeenCalled();
  });
});
