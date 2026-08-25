import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appPath = new URL("../app/LiftLogApp.tsx", import.meta.url);
const repositoryPath = new URL("../lib/repository.ts", import.meta.url);
const migrationPath = new URL(
  "../supabase/migrations/202608230003_exercise_disciplines_and_tags.sql",
  import.meta.url,
);

test("exercise browsing uses three primary disciplines with compact rows and tags", async () => {
  const [app, repository, migration] = await Promise.all([
    readFile(appPath, "utf8"),
    readFile(repositoryPath, "utf8"),
    readFile(migrationPath, "utf8"),
  ]);

  assert.match(migration, /discipline in \('weightlifting', 'gym', 'functional'\)/);
  assert.match(migration, /add column tags text\[\] not null default '\{\}'/);
  assert.match(migration, /idx_exercises_global_discipline/);
  assert.match(repository, /category, discipline, tags, cue/);
  assert.match(app, /Weightlifting[\s\S]*Gym[\s\S]*Functional/);
  assert.match(app, /className="exercise-list panel"/);
  assert.match(app, /className="exercise-list-row"/);
  assert.match(app, /label="Exercise sources"[\s\S]*Library \(\$\{global\.length\}\)[\s\S]*My exercises/);
  assert.match(app, /Copy \$\{exercise\.name\} to My exercises/);
  assert.match(app, /function ExerciseDetailsModal/);
  assert.match(app, /Edit \$\{exercise\.name\}[\s\S]*?onClick=\{\(\) => onEdit\(exercise\)\}/);
  assert.match(app, /Training style[\s\S]*Category[\s\S]*Logging[\s\S]*Tracking/);
  assert.match(app, /className=\{cn\("exercise-style-icon", style\)\}/);
  assert.match(app, /function DraggableExercisePickerRow[\s\S]*?<StyleIcon size=\{15\} \/>/);
  assert.doesNotMatch(app, /function DraggableExercisePickerRow[\s\S]*?<SourceTag source=\{sourceFromExercise\(exercise\)\} compact \/>/);
  assert.doesNotMatch(app, /Filter exercises by category/);
  assert.doesNotMatch(app, /className="exercise-grid"/);
});

test("exercise editing keeps training style and category as separate controlled fields", async () => {
  const app = await readFile(appPath, "utf8");

  assert.match(app, /const exerciseCategories = \[/);
  assert.match(
    app,
    /function ExerciseModal[\s\S]*aria-label="Training style"[\s\S]*aria-label="Category"/,
  );
  assert.match(
    app,
    /onSave\(name\.trim\(\), discipline, category, mode, cue\.trim\(\)\)/,
  );
  assert.match(app, /discipline: ExerciseDiscipline/);
  assert.doesNotMatch(app, /placeholder="e\.g\. Weightlifting"/);
});

test("saving a personal exercise returns to the exercise list", async () => {
  const app = await readFile(appPath, "utf8");

  assert.match(
    app,
    /async function addPersonalExercise[\s\S]*setExerciseDetailTarget\(null\);[\s\S]*setModal\(null\);[\s\S]*saved to your library/,
  );
  assert.match(
    app,
    /async function updatePersonalExercise[\s\S]*setExerciseDetailTarget\(null\);[\s\S]*setModal\(null\);[\s\S]*updated/,
  );
});
