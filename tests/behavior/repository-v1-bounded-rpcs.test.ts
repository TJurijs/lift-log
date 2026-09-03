import { describe, expect, it, vi } from "vitest";

import { LiftLogRepository } from "../../lib/repository";

const profile = {
  id: "viewer-1",
  firstName: "View",
  lastName: "Er",
  displayName: "View Er",
  liftlogId: "view-er",
  weekStartsOnSunday: false,
  weightUnit: "kg",
  distanceUnit: "km",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
};

function workoutPayload(
  id = "workout-1",
  item: Record<string, unknown> = {
    id: "item-1",
    sourceExerciseId: "exercise-1",
    exerciseCategory: "Weightlifting",
    name: "Snatch",
    cue: "Stay over the bar",
    entryMode: "sets",
    trackingFields: ["reps", "load", "rpe"],
    position: 0,
    prescribedEntries: [
      {
        id: "entry-1",
        position: 0,
        repsMin: 2,
        repsMax: 2,
        loadKg: 70,
        targetRpeMin: 8,
        targetRpeMax: 8,
      },
    ],
  },
) {
  return {
    id,
    title: "Snatch",
    scheduleLabel: "Day 1",
    position: 0,
    estimatedMinutes: 60,
    sections: [
      {
        id: "section-1",
        title: "Main work",
        kind: "main",
        position: 0,
        items: [item],
      },
    ],
  };
}

function repositoryWithRpc(rpc: ReturnType<typeof vi.fn>) {
  const from = vi.fn(() => {
    throw new Error("bounded gateways must not fan out through tables");
  });
  return {
    repository: new LiftLogRepository(
      { rpc, from } as never,
      "viewer-1",
      "View Er",
    ),
    from,
  };
}

describe("v1 bounded repository RPCs", () => {
  it("finishes a changed timezone sync before bootstrap exposes upcoming data", async () => {
    const currentTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const rpc = vi.fn().mockResolvedValue({
      data: {
        profile: {
          ...profile,
          timezone: currentTimezone === "UTC" ? "Europe/Riga" : "UTC",
        },
        activeSession: null,
        activeWorkout: null,
        nextWorkouts: [],
      },
      error: null,
    });
    let finishTimezoneUpdate!: (value: { error: null }) => void;
    const timezoneUpdate = new Promise<{ error: null }>((resolve) => {
      finishTimezoneUpdate = resolve;
    });
    const eq = vi.fn(() => timezoneUpdate);
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));
    const repository = new LiftLogRepository(
      { rpc, from } as never,
      "viewer-1",
      "View Er",
    );
    let resolved = false;

    const bootstrap = repository.loadBootstrap().then((workspace) => {
      resolved = true;
      return workspace;
    });
    await vi.waitFor(() => expect(eq).toHaveBeenCalled());
    expect(resolved).toBe(false);

    finishTimezoneUpdate({ error: null });
    await bootstrap;

    expect(from).toHaveBeenCalledWith("profiles");
    expect(update).toHaveBeenCalledWith({ timezone: currentTimezone });
    expect(eq).toHaveBeenCalledWith("id", "viewer-1");
    expect(resolved).toBe(true);
  });

  it("uses the saved estimate in lightweight next-workout summaries", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        profile,
        activeSession: null,
        activeWorkout: null,
        nextWorkouts: [{
          id: "schedule-1",
          programVersionId: "version-1",
          workoutId: "workout-1",
          workoutTitle: "Jerk technique",
          estimatedMinutes: 95,
          programTitle: "Balanced Weightlifting",
          plannedDate: "2026-09-03",
          sequenceNumber: 2,
          status: "planned",
        }],
      },
      error: null,
    });
    const { repository } = repositoryWithRpc(rpc);

    const workspace = await repository.loadBootstrap();

    expect(workspace.scheduledWorkouts[0].workout.durationMinutes).toBe(95);
  });

  it("bootstraps profile, active recovery, and six-or-fewer next rows in one RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        profile,
        activeSession: {
          id: "session-1",
          draftRevision: 4,
          draftWriteToken: "write-1",
          assignmentId: "assignment-1",
          programVersionId: "version-1",
          workoutId: "workout-1",
          scheduledWorkoutId: "schedule-1",
          sessionRpe: 8,
          sessionNote: "Felt good",
          itemLogIds: { "item-1": "log-1" },
          items: [
            {
              itemLogId: "log-1",
              sourceWorkoutItemId: "item-1",
              entryMode: "sets",
              entries: [{ position: 0, reps: 2, loadKg: 70, rpe: 8 }],
            },
          ],
        },
        activeWorkout: workoutPayload(),
        nextWorkouts: [
          {
            id: "schedule-1",
            assignmentId: "assignment-1",
            programVersionId: "version-1",
            workoutId: "workout-1",
            workoutTitle: "Snatch",
            programTitle: "Weightlifting",
            plannedDate: "2026-08-29",
            sequenceNumber: 1,
            status: "in_progress",
          },
        ],
      },
      error: null,
    });
    const { repository, from } = repositoryWithRpc(rpc);

    const workspace = await repository.loadBootstrap();

    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("get_workspace_bootstrap");
    expect(from).not.toHaveBeenCalled();
    expect(workspace.programCatalog).toEqual([]);
    expect(workspace.activeSession).toMatchObject({
      id: "session-1",
      draftRevision: 4,
      draftWriteToken: "write-1",
      assignmentId: "assignment-1",
      setLogs: { "item-1": [{ reps: "2", load: "70", rpe: "8" }] },
    });
    expect(workspace.scheduledWorkouts[0]).toMatchObject({
      id: "schedule-1",
      detailsLoaded: true,
      workout: { sections: [{ items: [{ prescription: { sets: 1 } }] }] },
    });
  });

  it("restores result load and per-round interval duration from active-session entries", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        profile,
        activeSession: {
          id: "session-1",
          draftRevision: 4,
          programVersionId: "version-1",
          workoutId: "workout-1",
          itemLogIds: {
            "result-item": "result-log",
            "interval-item": "interval-log",
          },
          items: [
            {
              itemLogId: "result-log",
              sourceWorkoutItemId: "result-item",
              entryMode: "result",
              entries: [
                {
                  position: 0,
                  durationSeconds: 75,
                  distanceMetres: 2500,
                  loadKg: 48.5,
                  heartRate: 150,
                  rpe: 7.5,
                },
              ],
            },
            {
              itemLogId: "interval-log",
              sourceWorkoutItemId: "interval-item",
              entryMode: "intervals",
              entries: [
                {
                  position: 0,
                  durationSeconds: 45,
                  distanceMetres: 250,
                  rounds: 1,
                  heartRate: 142,
                  rpe: 6,
                },
                {
                  position: 1,
                  durationSeconds: 75,
                  distanceMetres: 270,
                  rounds: null,
                  heartRate: 148,
                  rpe: 7,
                },
              ],
            },
          ],
        },
        activeWorkout: workoutPayload(),
        nextWorkouts: [],
      },
      error: null,
    });
    const { repository } = repositoryWithRpc(rpc);

    const workspace = await repository.loadBootstrap();

    expect(workspace.activeSession?.resultLogs).toEqual({
      "result-item": {
        rounds: "",
        duration: "1.25",
        distance: "2.5",
        load: "48.5",
        heartRate: "150",
        rpe: "7.5",
      },
      "interval-item": {
        "round.0.completed": "1",
        "round.0.duration": "45",
        "round.0.distance": "0.25",
        "round.0.heartRate": "142",
        "round.0.rpe": "6",
        "round.1.completed": "",
        "round.1.duration": "75",
        "round.1.distance": "0.27",
        "round.1.heartRate": "148",
        "round.1.rpe": "7",
      },
    });
  });

  it("uses descending keyset program summaries and preserves assignment identity", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          kind: "assignment",
          id: "assignment-1",
          program_id: "program-1",
          assignment_id: "assignment-1",
          customized_program_id: null,
          athlete_id: "viewer-1",
          version_id: "version-1",
          version_status: "published",
          title: "Assigned plan",
          description: "Shared immutable content",
          source_type: "coach",
          content_type: "program",
          created_by_id: "coach-1",
          created_at: "2026-08-29T10:00:00Z",
          week_count: 10,
          workout_count: 40,
        },
        {
          kind: "program",
          id: "program-2",
          program_id: "program-2",
          assignment_id: null,
          athlete_id: "viewer-1",
          version_id: "version-2",
          version_status: "draft",
          title: "Draft",
          description: "",
          source_type: "self",
          content_type: "quick_workout",
          created_by_id: "viewer-1",
          created_at: "2026-08-28T10:00:00Z",
          week_count: 1,
          workout_count: 1,
        },
        {
          kind: "program",
          id: "program-3",
          program_id: "program-3",
          athlete_id: "viewer-1",
          version_id: "version-3",
          version_status: "published",
          title: "Sentinel",
          created_by_id: "viewer-1",
          created_at: "2026-08-27T10:00:00Z",
          week_count: 1,
          workout_count: 1,
        },
      ],
      error: null,
    });
    const { repository, from } = repositoryWithRpc(rpc);

    const page = await repository.listProgramSummaries({ limit: 2 });

    expect(rpc).toHaveBeenCalledWith("list_program_summaries", {
      page_limit: 3,
      after_created_at: null,
      after_id: null,
    });
    expect(from).not.toHaveBeenCalled();
    expect(page).toMatchObject({
      hasMore: true,
      nextCursor: {
        createdAt: "2026-08-28T10:00:00Z",
        id: "program-2",
      },
    });
    expect(page.items[0]).toMatchObject({
      id: "program-1",
      assignmentId: "assignment-1",
      weekCount: 10,
      workoutCount: 40,
      detailsLoaded: false,
    });
  });

  it("loads one selected program tree through the detail RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        kind: "assignment",
        id: "assignment-1",
        programId: "program-1",
        assignmentId: "assignment-1",
        athleteId: "viewer-1",
        createdById: "coach-1",
        versionId: "version-1",
        versionNumber: 3,
        versionStatus: "published",
        title: "Weightlifting",
        description: "Three days",
        sourceType: "self",
        contentType: "program",
        phases: [{ id: "phase-1", name: "Build", position: 0 }],
        weeks: [
          {
            id: "week-1",
            weekIndex: 1,
            label: "Week 1",
            workouts: [workoutPayload()],
          },
        ],
      },
      error: null,
    });
    const { repository, from } = repositoryWithRpc(rpc);

    const program = await repository.getProgramVersionDetail({
      assignmentId: "assignment-1",
      versionId: "version-1",
    });

    expect(rpc).toHaveBeenCalledWith("get_program_version_detail", {
      target_program_id: null,
      target_assignment_id: "assignment-1",
      target_version_id: "version-1",
    });
    expect(from).not.toHaveBeenCalled();
    expect(program).toMatchObject({
      id: "program-1",
      assignmentId: "assignment-1",
      sourceType: "coach",
      phase: "Build",
      detailsLoaded: true,
      weeks: [
        {
          workouts: [
            {
              sections: [
                {
                  items: [
                    {
                      category: "Weightlifting",
                      prescription: { reps: "2", targetRpe: "8" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    await expect(
      repository.loadProgramDetail(
        "viewer-1",
        "program-1",
        "version-1",
        "assignment-1",
      ),
    ).resolves.toBe(program);
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("preserves a result-mode prescribed load while mapping program detail", async () => {
    const carry = workoutPayload("workout-carry", {
      id: "item-carry",
      sourceExerciseId: "exercise-carry",
      name: "Farmer carry",
      cue: "Walk tall",
      entryMode: "result",
      trackingFields: ["distance", "load", "rpe"],
      position: 0,
      prescribedEntries: [
        {
          id: "entry-carry",
          position: 0,
          distanceMetres: 100,
          loadKg: 48,
          targetRpeMin: 8,
          targetRpeMax: 8,
        },
      ],
    });
    const rpc = vi.fn().mockResolvedValue({
      data: {
        kind: "assignment",
        id: "assignment-1",
        programId: "program-1",
        assignmentId: "assignment-1",
        athleteId: "viewer-1",
        createdById: "coach-1",
        versionId: "version-1",
        versionNumber: 3,
        versionStatus: "published",
        title: "Carries",
        description: "Loaded conditioning",
        sourceType: "self",
        contentType: "program",
        phases: [{ id: "phase-1", name: "Build", position: 0 }],
        weeks: [
          {
            id: "week-1",
            weekIndex: 1,
            label: "Week 1",
            workouts: [carry],
          },
        ],
      },
      error: null,
    });
    const { repository } = repositoryWithRpc(rpc);

    const program = await repository.getProgramVersionDetail({
      assignmentId: "assignment-1",
      versionId: "version-1",
    });

    expect(
      program?.weeks[0]?.workouts[0]?.sections[0]?.items[0],
    ).toMatchObject({
      fields: ["distance", "load", "rpe"],
      prescription: {
        distance: 0.1,
        distanceUnit: "km",
        loadKg: 48,
        targetRpe: "8",
        entries: [{ distance: 0.1, loadKg: 48, targetRpe: "8" }],
      },
    });
  });

  it("loads a bounded frequent-workout list with usage metadata", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          kind: "assignment",
          program_id: "program-1",
          assignment_id: "assignment-1",
          program_version_id: "version-1",
          workout_id: "workout-1",
          program_title: "Daily strength",
          workout_title: "Full body",
          content_type: "quick_workout",
          is_quick_workout: true,
          week_index: 1,
          week_label: "Week 1",
          workout_position: 0,
          schedule_label: "Workout 1",
          estimated_minutes: 45,
          usage_count: "4",
          last_used_at: "2026-08-28T18:30:00Z",
          latest_occurrence_id: "schedule-4",
          latest_planned_date: null,
          latest_status: "planned",
          latest_sequence_number: 4,
        },
      ],
      error: null,
    });
    const { repository, from } = repositoryWithRpc(rpc);

    await expect(repository.listFrequentSchedulableWorkouts(99)).resolves.toEqual([
      expect.objectContaining({
        kind: "assignment",
        programId: "program-1",
        assignmentId: "assignment-1",
        programVersionId: "version-1",
        workoutId: "workout-1",
        workoutTitle: "Full body",
        contentType: "quick_workout",
        isQuickWorkout: true,
        usageCount: 4,
        lastUsedAt: "2026-08-28T18:30:00Z",
        latestOccurrence: {
          id: "schedule-4",
          plannedDate: undefined,
          status: "planned",
          sequenceNumber: 4,
        },
      }),
    ]);
    expect(rpc).toHaveBeenCalledWith("list_frequent_schedulable_workouts", {
      page_limit: 12,
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("uses exact bounded cursor arguments for scheduling, calendar, history, exercise, and coach lists", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const { repository, from } = repositoryWithRpc(rpc);

    await repository.listSchedulableWorkouts({
      limit: 20,
      cursor: {
        programTitle: "Plan",
        weekIndex: 2,
        workoutPosition: 3,
        id: "workout-3",
      },
    });
    await repository.listCalendarOccurrences("2026-08-01", "2026-08-31", {
      limit: 20,
      cursor: { plannedDate: "2026-08-20", id: "schedule-20" },
    });
    await repository.listCompletedSessionSummaries({
      limit: 20,
      cursor: { startedAt: "2026-08-20T10:00:00Z", id: "session-20" },
    });
    await repository.searchExercises({
      query: "sn",
      scope: "global",
      disciplines: ["weightlifting"],
      categories: ["Weightlifting"],
      modes: ["sets"],
      tracking: ["reps", "load"],
      limit: 20,
      cursor: { name: "Snatch", id: "exercise-20" },
    });
    await repository.listCoachAthletes({
      limit: 20,
      cursor: { displayName: "Athlete", id: "athlete-20" },
    });

    expect(rpc.mock.calls).toEqual([
      [
        "list_schedulable_workouts",
        {
          page_limit: 21,
          after_program_title: "Plan",
          after_week_index: 2,
          after_workout_position: 3,
          after_id: "workout-3",
        },
      ],
      [
        "list_calendar_occurrences",
        {
          range_start: "2026-08-01",
          range_end: "2026-08-31",
          page_limit: 21,
          after_planned_date: "2026-08-20",
          after_id: "schedule-20",
        },
      ],
      [
        "list_completed_session_summaries",
        {
          page_limit: 21,
          before_started_at: "2026-08-20T10:00:00Z",
          before_id: "session-20",
        },
      ],
      [
        "search_exercises",
        {
          search_text: "sn",
          scope_filter: "global",
          discipline_filters: ["weightlifting"],
          category_filters: ["Weightlifting"],
          mode_filters: ["sets"],
          tracking_filters: ["reps", "load"],
          page_limit: 21,
          after_name: "Snatch",
          after_id: "exercise-20",
        },
      ],
      [
        "list_coach_athletes",
        {
          page_limit: 21,
          after_display_name: "Athlete",
          after_id: "athlete-20",
        },
      ],
    ]);
    expect(from).not.toHaveBeenCalled();
  });

  it("loads a calendar range with exactly two range-bounded summary RPCs", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "list_calendar_occurrences") {
        return {
          data: [
            {
              id: "schedule-1",
              program_id: "program-1",
              program_version_id: "version-1",
              program_title: "Weightlifting",
              workout_id: "workout-1",
              workout_title: "Snatch",
              planned_date: "2026-08-20",
              sequence_number: 2,
              status: "planned",
            },
          ],
          error: null,
        };
      }
      if (name === "list_calendar_session_summaries") {
        return {
          data: [
            {
              id: "session-1",
              assignment_id: "assignment-1",
              scheduled_workout_id: "schedule-0",
              program_version_id: "version-1",
              workout_id: "workout-1",
              workout_title: "Snatch",
              started_at: "2026-08-18T10:00:00Z",
              completed_at: "2026-08-18T10:45:00Z",
              completed_for_date: "2026-08-18",
              session_rpe: "8",
            },
            { id: "malformed-session" },
          ],
          error: null,
        };
      }
      throw new Error(`unexpected RPC ${name}`);
    });
    const { repository, from } = repositoryWithRpc(rpc);

    await expect(
      repository.loadCalendarRange("2026-08-01", "2026-08-31"),
    ).resolves.toMatchObject({
      scheduledWorkouts: [
        {
          id: "schedule-1",
          plannedDate: "2026-08-20",
          detailsLoaded: false,
        },
      ],
      completedSessions: [
        {
          id: "session-1",
          date: "2026-08-18",
          durationMinutes: 45,
          rpe: 8,
        },
      ],
    });
    expect(rpc.mock.calls).toEqual([
      [
        "list_calendar_occurrences",
        {
          range_start: "2026-08-01",
          range_end: "2026-08-31",
          page_limit: 101,
          after_planned_date: null,
          after_id: null,
        },
      ],
      [
        "list_calendar_session_summaries",
        {
          range_start: "2026-08-01",
          range_end: "2026-08-31",
          page_limit: 100,
        },
      ],
    ]);
    expect(from).not.toHaveBeenCalled();
  });

  it("preserves run provenance when an athlete schedules a coach-created run", async () => {
    const occurrence = {
      id: "schedule-coach-run",
      assignment_id: null,
      program_run_id: "run-coach",
      program_run_workout_id: "slot-coach",
      program_id: "program-1",
      program_version_id: "version-1",
      program_title: "Coach plan",
      workout_id: "workout-1",
      workout_title: "Snatch",
      planned_date: "2026-09-10",
      sequence_number: 1,
      status: "planned",
      scheduled_by_id: "viewer-1",
      source_type: "coach",
    };
    const rpc = vi.fn(async (name: string) => {
      if (name === "get_workspace_bootstrap") {
        return {
          data: {
            profile,
            activeSession: null,
            activeWorkout: null,
            nextWorkouts: [{
              ...occurrence,
              programVersionId: occurrence.program_version_id,
              workoutId: occurrence.workout_id,
              workoutTitle: occurrence.workout_title,
              programTitle: occurrence.program_title,
              plannedDate: occurrence.planned_date,
              sequenceNumber: occurrence.sequence_number,
              programRunId: occurrence.program_run_id,
              programRunWorkoutId: occurrence.program_run_workout_id,
              scheduledById: occurrence.scheduled_by_id,
              sourceType: occurrence.source_type,
            }],
          },
          error: null,
        };
      }
      if (name === "list_calendar_occurrences") {
        return {
          data: [
            occurrence,
            {
              ...occurrence,
              id: "schedule-old-coach",
              program_run_id: "run-old-coach",
              source_type: undefined,
              scheduled_by_id: "coach-1",
            },
            {
              ...occurrence,
              id: "schedule-self",
              program_run_id: "run-self",
              source_type: "self",
            },
          ],
          error: null,
        };
      }
      if (name === "get_scheduled_workout_detail") {
        return {
          data: {
            ...occurrence,
            athleteId: "viewer-1",
            scheduledById: "viewer-1",
            sourceType: "coach",
            programId: "program-1",
            programVersionId: "version-1",
            programTitle: "Coach plan",
            workoutId: "workout-1",
            plannedDate: "2026-09-10",
            sequenceNumber: 1,
            workout: workoutPayload(),
          },
          error: null,
        };
      }
      throw new Error(`unexpected RPC ${name}`);
    });
    const { repository } = repositoryWithRpc(rpc);

    const bootstrap = await repository.loadBootstrap();
    expect(bootstrap.scheduledWorkouts[0]).toMatchObject({
      programRunId: "run-coach",
      sourceType: "coach",
    });

    const calendar = await repository.listCalendarOccurrences(
      "2026-09-01",
      "2026-09-30",
    );
    expect(calendar.items.map((item) => item.sourceType)).toEqual([
      "coach",
      "coach",
      "self",
    ]);

    await expect(
      repository.loadScheduledWorkoutDetail("schedule-coach-run"),
    ).resolves.toMatchObject({ sourceType: "coach" });
  });

  it("loads coaching startup in two bounded RPCs and exposes the athlete cursor", async () => {
    const athleteRows = Array.from({ length: 26 }, (_, index) => ({
      id: `athlete-${index + 1}`,
      relationship_id: `relationship-${index + 1}`,
      display_name: `Athlete ${String(index + 1).padStart(2, "0")}`,
      assigned_program_count: index,
    }));
    const rpc = vi.fn(async (name: string) => {
      if (name === "get_coaching_access_summary") {
        return {
          data: {
            coachConnections: [
              {
                relationshipId: "relationship-coach-1",
                coachId: "coach-1",
                coachName: "Coach One",
                connectedSince: "2026-08-01T10:00:00Z",
              },
            ],
            pendingCoachInvites: [
              {
                id: "pending-1",
                athleteId: "viewer-1",
                athleteName: "View Er",
                createdAt: "2026-08-20T10:00:00Z",
                expiresAt: "2026-09-20T10:00:00Z",
              },
            ],
            outgoingCoachInvites: [
              {
                id: "outgoing-1",
                coachId: "viewer-1",
                coachName: "View Er",
                createdAt: "2026-08-21T10:00:00Z",
                expiresAt: "2026-09-21T10:00:00Z",
              },
            ],
          },
          error: null,
        };
      }
      if (name === "list_coach_athletes") {
        return { data: athleteRows, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    });
    const { repository, from } = repositoryWithRpc(rpc);

    const workspace = await repository.loadCoachingWorkspace();

    expect(rpc.mock.calls).toEqual([
      ["get_coaching_access_summary"],
      [
        "list_coach_athletes",
        {
          page_limit: 26,
          after_display_name: null,
          after_id: null,
        },
      ],
    ]);
    expect(workspace).toMatchObject({
      coachConnections: [
        {
          relationshipId: "relationship-coach-1",
          coachId: "coach-1",
          name: "Coach One",
          initials: "CO",
          connectedSince: "2026-08-01",
        },
      ],
      pendingCoachInvites: [
        {
          id: "pending-1",
          athleteInitials: "VE",
        },
      ],
      outgoingCoachInvites: [
        {
          id: "outgoing-1",
          coachInitials: "VE",
        },
      ],
      coachAthleteCursor: {
        displayName: "Athlete 25",
        id: "athlete-25",
      },
    });
    expect(workspace.coachedAthletes).toHaveLength(25);
    expect(from).not.toHaveBeenCalled();
  });

  it("starts a scheduled workout through the bounded session contract", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "start_scheduled_workout") {
        return { data: "session-1", error: null };
      }
      if (name === "get_workspace_bootstrap") {
        return {
          data: {
            profile,
            activeSession: {
              id: "session-1",
              draftRevision: 0,
              programVersionId: "version-1",
              workoutId: "workout-1",
              scheduledWorkoutId: "schedule-1",
              items: [],
            },
            activeWorkout: workoutPayload(),
            nextWorkouts: [],
          },
          error: null,
        };
      }
      return { data: null, error: null };
    });
    const { repository, from } = repositoryWithRpc(rpc);

    await expect(repository.startOrResumeSession("schedule-1")).resolves.toMatchObject({
      id: "session-1",
      scheduledWorkoutId: "schedule-1",
    });

    expect(rpc.mock.calls).toEqual([
      [
        "start_scheduled_workout",
        { target_scheduled_workout_id: "schedule-1" },
      ],
      ["get_workspace_bootstrap"],
    ]);
    expect(from).not.toHaveBeenCalled();
  });
});
