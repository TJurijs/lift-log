import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appPath = new URL("../app/LiftLogApp.tsx", import.meta.url);
const programViewPath = new URL(
  "../app/features/programs/ProgramView.tsx",
  import.meta.url,
);
async function readAppSource() {
  const [app, programView] = await Promise.all([
    readFile(appPath, "utf8"),
    readFile(programViewPath, "utf8"),
  ]);
  return `${app}\n${programView}`;
}
const stylesPath = new URL("../app/globals.css", import.meta.url);
const repositoryPath = new URL("../lib/repository.ts", import.meta.url);
const migrationPath = new URL(
  "../supabase/migrations/202608230001_quick_workouts.sql",
  import.meta.url,
);
const runMigrationPath = new URL(
  "../supabase/migrations/202609020003_program_runs.sql",
  import.meta.url,
);
const runWizardPath = new URL(
  "../app/features/program-runs/ProgramRunWizard.tsx",
  import.meta.url,
);

test("quick workouts use the shared tree and the same run flow as programs", async () => {
  const [app, styles, repository, migration, flatWorkoutMigration, runMigration, runWizard] = await Promise.all([
    readAppSource(),
    readFile(stylesPath, "utf8"),
    readFile(repositoryPath, "utf8"),
    readFile(migrationPath, "utf8"),
    readFile(new URL("../supabase/migrations/202608290004_flat_workout_exercises.sql", import.meta.url), "utf8"),
    readFile(runMigrationPath, "utf8"),
    readFile(runWizardPath, "utf8"),
  ]);

  assert.match(app, /Create workout/);
  assert.match(app, /createQuickWorkout\(title: string\)/);
  assert.match(app, /contentType === "quick_workout"/);
  assert.match(
    app,
    /const workoutItems = sortDraftsFirst\([\s\S]*contentType === "quick_workout"/,
    "single workouts remain distinct reusable library items",
  );
  assert.doesNotMatch(app, /isQuickWorkout \? "One session" : "Training program"/);
  assert.match(
    app,
    /className=\{`builder-layout\$\{isQuickWorkout \? " quick-workout-builder" : ""\}`\}[\s\S]*\{!isQuickWorkout &&\s*\(\s*<aside[\s\S]*"workout-list panel"/,
    "a single quick workout must not render the redundant session selector",
  );
  assert.match(
    styles,
    /\.builder-layout\.quick-workout-builder\s*\{[\s\S]*grid-template-columns:\s*minmax\(340px, 1fr\)/,
    "a quick workout must use the full builder width without a persistent picker column",
  );
  assert.match(app, /Workout saved[^"\n]*future (?:runs|uses)/i);
  assert.doesNotMatch(app, /stays editable until you schedule or assign it/i);
  assert.match(app, /\{isQuickWorkout \? "Save workout" : "Save program"\}/);
  assert.match(app, /Assign to athletes/);
  assert.match(runWizard, /program or a standalone workout/);
  assert.match(runWizard, /mode: "self" \| "coach"/);
  assert.match(runWizard, /Assign and schedule/);
  assert.match(runWizard, /Set full schedule later/);
  assert.match(app, /repository\.createProgramRuns\(/);
  assert.match(repository, /async createProgramRuns[\s\S]*rpc\("create_program_runs"/);
  assert.match(
    runMigration,
    /create or replace function public\.create_program_runs[\s\S]*private\.materialize_program_run/,
    "standalone workouts use the same durable run model because they are one-workout programs",
  );
  assert.match(repository, /createBlankQuickWorkout\(title: string\)/);
  assert.match(repository, /create_blank_quick_workout/);
  assert.match(migration, /content_type in \('program', 'quick_workout'\)/);
  assert.match(migration, /create_blank_quick_workout/);
  assert.match(
    runMigration,
    /revoke all on function public\.assign_quick_workout_to_athletes\(uuid, uuid\[\], date, uuid\)[\s\S]*from public, anon, authenticated/i,
  );
  assert.doesNotMatch(
    repository,
    /assignQuickWorkoutToAthletes|assign_quick_workout_for_use/,
  );
  assert.match(migration, /insert into public\.workouts/);
  assert.match(flatWorkoutMigration, /'Exercises', 'main', 0/);
});
