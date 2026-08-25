import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("../app/LiftLogApp.tsx", import.meta.url);
const repositoryUrl = new URL("../lib/repository.ts", import.meta.url);
const migrationUrl = new URL(
  "../supabase/migrations/202608220012_complete_sessions_on_scheduled_date.sql",
  import.meta.url,
);
const statusMigrationUrl = new URL(
  "../supabase/migrations/202608220013_skip_or_restore_scheduled_workouts.sql",
  import.meta.url,
);

test("Next workouts opens a full read-only workout preview before starting", async () => {
  const app = await readFile(appUrl, "utf8");

  assert.match(app, /title="Next workouts"/);
  assert.match(app, /function NextWorkoutsView/);
  assert.match(app, /schedules=\{upcomingWorkouts\}/);
  assert.match(app, /onOpen=\{openWorkoutPreview\}/);
  assert.match(app, /onStart=\{\(schedule\) => void startWorkout\(schedule\)\}/);
  assert.match(app, /workoutPreviewSchedule/);
  assert.match(app, /viewMode=\{!activeSession\}/);
  assert.match(app, /Workout preview/);
  assert.match(app, /Next workouts/);
  assert.match(app, /Set back to planned/);
  assert.match(app, /Skip workout/);
  assert.match(app, /viewScheduledPlan\(workoutPreviewSchedule\)/);
  assert.match(app, /loadOwnScheduledProgramVersionById/);
  assert.match(app, /previewProgram\?\.contentType !== "quick_workout"/);
  assert.match(app, /viewMode && onViewProgram/);
  assert.match(app, /View program/);
  assert.doesNotMatch(app, />\s*Edit plan\s*</);
  assert.match(app, /Every workout scheduled from today onward/);
});

test("new scheduling only offers unscheduled workouts from current finalized versions", async () => {
  const app = await readFile(appUrl, "utf8");

  assert.match(app, /schedulableVersionIds=\{schedulablePrograms\.map/);
  assert.match(app, /const schedulableVersions = new Set\(schedulableVersionIds\)/);
  assert.match(app, /editingId[\s\S]*schedule\.id === editingId/);
  assert.match(
    app,
    /!schedule\.plannedDate &&[\s\S]*schedulableVersions\.has\(schedule\.programVersionId\)/,
  );
});

test("skipping or restoring a scheduled workout abandons an active draft safely", async () => {
  const [repository, migration] = await Promise.all([
    readFile(repositoryUrl, "utf8"),
    readFile(statusMigrationUrl, "utf8"),
  ]);

  assert.match(repository, /async setScheduledWorkoutStatus\(/);
  assert.match(repository, /set_scheduled_workout_status/);
  assert.match(migration, /target_status not in \('planned', 'skipped'\)/i);
  assert.match(
    migration,
    /update public\.workout_sessions[\s\S]*set status = 'abandoned'[\s\S]*status = 'in_progress'/i,
  );
  assert.match(migration, /set status = target_status/i);
});

test("starting and resetting a workout keep the occurrence state coherent", async () => {
  const app = await readFile(appUrl, "utf8");

  assert.match(
    app,
    /candidate\.id === schedule\.id[\s\S]*status: "in_progress"/,
  );
  assert.match(
    app,
    /activeSession\?\.scheduledWorkoutId === targetSchedule\.id[\s\S]*"resetToPlanned"/,
  );
});

test("finishing a scheduled workout keeps its planned calendar date", async () => {
  const [repository, migration] = await Promise.all([
    readFile(repositoryUrl, "utf8"),
    readFile(migrationUrl, "utf8"),
  ]);

  assert.match(
    repository,
    /date: session\.completed_for_date \?\? localDateOnly\(start\)/,
  );
  assert.match(migration, /add column if not exists completed_for_date date/i);
  assert.match(
    migration,
    /completed_for_date = coalesce\(scheduled_date, current_date\)/i,
  );
});
