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
    ) as unknown as {
      loadCoachedAthletes: () => Promise<Array<Record<string, unknown>>>;
    };

    const rows = await repository.loadCoachedAthletes();

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "list_authored_coach_athlete_overviews",
      { target_limit: 250 },
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
        id: "athlete-1",
        relationshipId: "relationship-1",
        displayName: "Athlete One",
        assignedProgramCount: 1,
        assignedPrograms: [
          {
            id: "program-1",
            versionId: "version-1",
            title: "Snapshot title",
            assignedAt: "2026-08-20",
            status: "in_progress",
            totalWorkouts: 4,
            scheduledWorkouts: 3,
            scheduledPercent: 75,
            completedWorkouts: 2,
            completionPercent: 50,
            workoutProgress: [
              "completed",
              "completed",
              "scheduled",
              "unscheduled",
            ],
          },
        ],
        agenda: [
          {
            id: "session:session-1",
            kind: "completed",
            status: "completed",
            programId: "program-1",
            programVersionId: "version-1",
            programTitle: "Snapshot title",
            workoutId: "workout-1",
            workoutTitle: "Workout one",
            date: "2026-08-22",
            rpe: "8",
            sessionId: "session-1",
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
    expect(rpc).toHaveBeenCalledWith("get_authored_coach_athlete_detail", {
      target_athlete_id: "athlete-1",
      target_program_limit: 250,
      target_upcoming_limit: 6,
      target_completed_limit: 6,
      target_progress_limit: 104,
    });
    expect(from).not.toHaveBeenCalled();
    expect(detail).toMatchObject({
      id: "athlete-1",
      detailsLoaded: true,
      assignedProgramCount: 1,
      assignedPrograms: [
        {
          id: "program-1",
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
          "supabase/migrations/202608240008_bounded_coach_workspace_overview.sql",
        ),
        "utf8",
      ),
    ]);

    expect(source).toContain('rpc("get_own_profile")');
    expect(source).toContain('rpc("list_connected_profile_summaries")');
    expect(source).toContain('rpc("get_own_session_notes"');
    expect(source).toContain('"list_authored_coach_athlete_overviews"');
    expect(source).not.toMatch(/\.from\("profiles"\)\s*\.select\(/);
    expect(source).not.toContain("athlete_note");
    expect(source).toContain("title: version.title || row.title");
    expect(source).toContain("description: version.description ?? row.description");
    expect(overviewMigration).toContain("'programTitle', authored.program_title");
  });
});
