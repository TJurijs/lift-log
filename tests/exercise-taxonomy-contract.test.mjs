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
  assert.doesNotMatch(app, /className="exercise-grid"/);
});
