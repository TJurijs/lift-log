import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const programViewUrl = new URL(
  "../app/features/programs/ProgramView.tsx",
  import.meta.url,
);
const repositoryUrl = new URL("../lib/repository.ts", import.meta.url);
const migrationUrl = new URL(
  "../supabase/migrations/202608290004_flat_workout_exercises.sql",
  import.meta.url,
);

test("workouts use one internal exercise list with no user-facing groups", async () => {
  const [programView, repository, migration] = await Promise.all([
    readFile(programViewUrl, "utf8"),
    readFile(repositoryUrl, "utf8"),
    readFile(migrationUrl, "utf8"),
  ]);

  assert.match(repository, /title: "Exercises"[\s\S]*?section_kind: "main"/);
  assert.match(migration, /idx_workout_sections_one_per_workout/);
  assert.match(migration, /set source_exercise_id = exercise\.id/);
  assert.match(migration, /'exerciseCategory', exercise\.category/);
  assert.doesNotMatch(migration, /workout_items\.category|update_workout_item_category/);
  assert.doesNotMatch(programView, /exercise-category-select|No category/);
  assert.doesNotMatch(programView, />Exercises<\/strong>/);
  assert.doesNotMatch(programView, /function BuilderExerciseGroup/);
});

test("exercise ordering is workout-wide and legacy section mutations are retired", async () => {
  const [programView, repository, migration] = await Promise.all([
    readFile(programViewUrl, "utf8"),
    readFile(repositoryUrl, "utf8"),
    readFile(migrationUrl, "utf8"),
  ]);

  assert.match(programView, /setReorderingExercises/);
  assert.match(
    programView,
    /function moveExercise[\s\S]*moveItemIds\(workoutItems, index, offset\)[\s\S]*onReorderItems\(ids\)/,
  );
  assert.match(programView, /aria-label={`Move \$\{label\} up`}/);
  assert.match(programView, /aria-label={`Move \$\{label\} down`}/);
  assert.match(repository, /rpc\("reorder_workout_items"/);
  assert.match(migration, /drop function if exists public\.add_workout_section/);
  assert.match(migration, /drop function if exists public\.move_workout_item/);
});
