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

test("quick workouts use the shared workout tree and can be scheduled or assigned", async () => {
  const [app, styles, repository, migration, flatWorkoutMigration] = await Promise.all([
    readAppSource(),
    readFile(stylesPath, "utf8"),
    readFile(repositoryPath, "utf8"),
    readFile(migrationPath, "utf8"),
    readFile(new URL("../supabase/migrations/202608290004_flat_workout_exercises.sql", import.meta.url), "utf8"),
  ]);

  assert.match(app, /Create workout/);
  assert.match(app, /createQuickWorkout\(title: string\)/);
  assert.match(app, /contentType === "quick_workout"/);
  assert.match(app, /deriveSingleWorkoutStatus/);
  assert.match(app, /Last completed/);
  assert.match(app, /upcomingCount > 1/);
  assert.match(
    app,
    /const showProgress =\s*!isQuickWorkout &&\s*program\.versionStatus === "published"/,
    "single workouts must not render program scheduling progress",
  );
  assert.doesNotMatch(app, /isQuickWorkout \? "One session" : "Training program"/);
  assert.match(
    app,
    /className=\{`builder-layout\$\{isQuickWorkout \? " quick-workout-builder" : ""\}`\}[\s\S]*\{!isQuickWorkout &&\s*\(\s*<aside className="workout-list panel">/,
    "a single quick workout must not render the redundant session selector",
  );
  assert.match(
    styles,
    /\.builder-layout\.quick-workout-builder\s*\{[\s\S]*grid-template-columns:\s*minmax\(340px, 1fr\)/,
    "a quick workout must use the full builder width without a persistent picker column",
  );
  assert.match(app, /Workout saved\. It is ready to schedule or assign\./);
  assert.match(app, /\{isQuickWorkout \? "Save workout" : "Save program"\}/);
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
  assert.match(flatWorkoutMigration, /'Exercises', 'main', 0/);
});
