import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { LiftLogRepository } from "../../lib/repository";

describe("repository data boundary", () => {
  it("loads bounded coach identities in one call without the athlete graph", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({
      data: [
        {
          id: "athlete-1",
          relationship_id: "relationship-1",
          display_name: "Athlete One",
          assigned_program_count: "1",
        },
      ],
      error: null,
    });
    const from = vi.fn(() => {
      throw new Error("the coach overview must not fan out through tables");
    });
    const repository = new LiftLogRepository(
      { rpc, from } as never,
      "coach-1",
      "Coach One",
    );

    const rows = (await repository.listCoachAthletes({ limit: 25 })).items;

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "list_coach_athletes",
      {
        page_limit: 26,
        after_display_name: null,
        after_id: null,
      },
    );
    expect(from).not.toHaveBeenCalled();
    expect(rows).toEqual([
      expect.objectContaining({
        id: "athlete-1",
        relationshipId: "relationship-1",
        name: "Athlete One",
        initials: "AO",
        assignedProgramCount: 1,
        detailsLoaded: false,
        assignedPrograms: [],
        agenda: [],
      }),
    ]);
  });

  it("loads only the selected athlete's bounded detail", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({
      data: {
        athlete: {
          id: "athlete-1",
          relationshipId: "relationship-1",
          displayName: "Athlete One",
        },
        assignedProgramCount: 1,
        programs: [
          {
            kind: "assignment",
            id: "assignment-1",
            assignmentId: "assignment-1",
            programId: "program-1",
            versionId: "version-1",
            title: "Snapshot title",
            assignedAt: "2026-08-20",
            totalWorkouts: 4,
            scheduledWorkouts: 3,
            completedWorkouts: 2,
            nextWorkout: {
              id: "schedule-1",
              workoutTitle: "Workout one",
              plannedDate: "2026-08-23",
              status: "in_progress",
            },
          },
        ],
        upcoming: [],
        completed: [
          {
            id: "session-1",
            programId: "program-1",
            programVersionId: "version-1",
            programTitle: "Snapshot title",
            workoutId: "workout-1",
            workoutTitle: "Workout one",
            completedForDate: "2026-08-22",
            sessionRpe: "8",
            athleteNote: "must not enter the view model",
          },
        ],
      },
      error: null,
    });
    const from = vi.fn(() => {
      throw new Error("selected coach detail must remain an RPC projection");
    });
    const repository = new LiftLogRepository(
      { rpc, from } as never,
      "coach-1",
      "Coach One",
    );

    const detail = await repository.loadCoachedAthleteDetail("athlete-1");

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("get_coach_athlete_detail", {
      target_athlete_id: "athlete-1",
      program_limit: 25,
      upcoming_limit: 6,
      completed_limit: 6,
    });
    expect(from).not.toHaveBeenCalled();
    expect(detail).toMatchObject({
      id: "athlete-1",
      detailsLoaded: true,
      assignedProgramCount: 1,
      assignedPrograms: [
        {
          id: "assignment-1",
          assignmentId: "assignment-1",
          programId: "program-1",
          title: "Snapshot title",
          completionPercent: 50,
        },
      ],
      agenda: [{ id: "session:session-1", rpe: 8 }],
    });
    expect(detail?.agenda[0]).not.toHaveProperty("athleteNote");
  });

  it("maps coach-safe session JSON without exposing injected private notes", async () => {
    const rpc = vi.fn(async (name: string, arguments_: Record<string, unknown>) => {
      expect(name).toBe("get_authored_coach_session_detail");
      expect(arguments_).toEqual({ target_session_id: "session-1" });
      return {
        data: {
          id: "session-1",
          programVersionId: "version-1",
          workoutId: "workout-1",
          scheduledWorkoutId: "schedule-1",
          workoutTitle: "Historical workout",
          startedAt: "2026-08-24T10:00:00.000Z",
          completedAt: "2026-08-24T10:45:00.000Z",
          completedForDate: "2026-08-24",
          sessionRpe: "8",
          sessionNote: "must not cross the coach boundary",
          items: [
            {
              id: "item-1",
              title: "Back squat",
              cue: "Brace",
              mode: "sets",
              fields: ["reps", "load", "rpe", "not-a-field"],
              position: 0,
              note: "private item note",
              entries: [
                {
                  id: "entry-1",
                  position: 0,
                  reps: "5",
                  loadKg: "100",
                  durationSeconds: null,
                  distanceMetres: null,
                  rounds: null,
                  heartRate: null,
                  rpe: "8",
                  note: "private entry note",
                },
              ],
            },
          ],
        },
        error: null,
      };
    });
    const from = vi.fn(() => {
      throw new Error("coach detail must not read session tables directly");
    });
    const repository = new LiftLogRepository(
      { rpc, from } as never,
      "coach-1",
      "Coach One",
    );

    const detail = await repository.loadCompletedSessionDetail(
      "session-1",
      "athlete-1",
    );

    expect(detail).toMatchObject({
      id: "session-1",
      workoutTitle: "Historical workout",
      durationMinutes: 45,
      rpe: 8,
      items: [
        {
          id: "item-1",
          fields: ["reps", "load", "rpe"],
          entries: [{ position: 0, reps: 5, loadKg: 100, rpe: 8 }],
        },
      ],
    });
    expect(detail).not.toHaveProperty("note");
    expect(detail?.items[0]).not.toHaveProperty("note");
    expect(detail?.items[0]?.entries[0]).not.toHaveProperty("note");
    expect(from).not.toHaveBeenCalled();
  });

  it("keeps mutable labels and private profile/note columns out of read mappings", async () => {
    const [source, overviewMigration] = await Promise.all([
      readFile(resolve(process.cwd(), "lib/repository.ts"), "utf8"),
      readFile(
        resolve(
          process.cwd(),
          "supabase/migrations/202608290001_v1_performance_data_architecture.sql",
        ),
        "utf8",
      ),
    ]);

    expect(source).toContain('rpc("get_workspace_bootstrap")');
    expect(source).toContain('rpc("get_coaching_access_summary")');
    expect(source).toContain('rpc("get_own_session_notes"');
    expect(source).toContain('rpc("list_coach_athletes"');
    expect(source).toContain('rpc("get_coach_athlete_detail"');
    expect(source).not.toContain("target_program_limit: 250");
    expect(source).not.toContain("target_progress_limit");
    expect(source).not.toMatch(/\.from\("profiles"\)\s*\.select\(/);
    expect(source).not.toContain("athlete_note");
    expect(overviewMigration).toContain("public.get_coach_athlete_detail");
    expect(overviewMigration).toContain("public.get_coaching_access_summary");
    expect(overviewMigration).not.toContain("'athleteNote'");
  });
});
