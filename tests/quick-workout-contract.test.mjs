import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appPath = new URL("../app/LiftLogApp.tsx", import.meta.url);
const repositoryPath = new URL("../lib/repository.ts", import.meta.url);
const migrationPath = new URL(
  "../supabase/migrations/202608230001_quick_workouts.sql",
  import.meta.url,
);

test("quick workouts use the shared workout tree and can be scheduled or assigned", async () => {
  const [app, repository, migration] = await Promise.all([
    readFile(appPath, "utf8"),
    readFile(repositoryPath, "utf8"),
    readFile(migrationPath, "utf8"),
  ]);

  assert.match(app, /Create workout/);
  assert.match(app, /createQuickWorkout\(title: string\)/);
  assert.match(app, /contentType === "quick_workout"/);
  assert.match(app, /setProgramAvailability\(program\.id, true\)/);
  assert.match(app, /Assign to athletes/);
  assert.match(app, /Assign & schedule/);
  assert.match(app, /assignQuickWorkoutToAthletes/);
  assert.match(repository, /createBlankQuickWorkout\(title: string\)/);
  assert.match(repository, /create_blank_quick_workout/);
  assert.match(migration, /content_type in \('program', 'quick_workout'\)/);
  assert.match(migration, /create_blank_quick_workout/);
  assert.match(migration, /assign_quick_workout_to_athletes/);
  assert.match(migration, /target_planned_date date/);
  assert.match(migration, /insert into public\.workouts/);
  assert.match(migration, /Warm up.*Main work.*Cooldown/s);
});
