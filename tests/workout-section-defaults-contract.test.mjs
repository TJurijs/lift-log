import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("../app/LiftLogApp.tsx", import.meta.url);
const programViewUrl = new URL(
  "../app/features/programs/ProgramView.tsx",
  import.meta.url,
);
async function readAppSource() {
  const [app, programView] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(programViewUrl, "utf8"),
  ]);
  return `${app}\n${programView}`;
}
const repositoryUrl = new URL("../lib/repository.ts", import.meta.url);
const migrationUrl = new URL(
  "../supabase/migrations/202608220008_workout_section_defaults_and_safe_deletion.sql",
  import.meta.url,
);

test("new workouts include the standard three sections", async () => {
  const [app, repository] = await Promise.all([
    readAppSource(),
    readFile(repositoryUrl, "utf8"),
  ]);

  for (const source of [app, repository]) {
    assert.match(source, /title: "Warm up"[\s\S]*kind: "warmup"/);
    assert.match(source, /title: "Main work"[\s\S]*kind: "main"/);
    assert.match(source, /title: "Cooldown"[\s\S]*kind: "cooldown"/);
  }
});

test("section deletion protects Main work and offers a safe exercise destination", async () => {
  const [app, repository, migration] = await Promise.all([
    readAppSource(),
    readFile(repositoryUrl, "utf8"),
    readFile(migrationUrl, "utf8"),
  ]);

  assert.match(app, /canDelete=\{section\.kind !== "main"\}/);
  assert.match(app, /Move to Main work/);
  assert.match(app, /Delete section & exercises/);
  assert.match(app, /deleteWorkoutSection\(sectionId, deleteItems\)/);
  assert.match(
    repository,
    /deleteWorkoutSection\(sectionId: string, deleteItems: boolean\)[\s\S]*delete_items: deleteItems/,
  );
  assert.match(migration, /target_kind = 'main' then raise exception 'Main work must remain in every workout'/);
  assert.match(migration, /if not delete_items then[\s\S]*set section_id = main_section_id/);
});
