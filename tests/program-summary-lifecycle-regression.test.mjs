import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/202609020001_simple_content_lock_lifecycle.sql",
  import.meta.url,
);
const repositoryUrl = new URL("../lib/repository.ts", import.meta.url);
const appUrl = new URL("../app/LiftLogApp.tsx", import.meta.url);
const programViewUrl = new URL(
  "../app/features/programs/ProgramView.tsx",
  import.meta.url,
);

test("content stays editable until durable use and then locks", async () => {
  const [migration, repository, app, programView] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(repositoryUrl, "utf8"),
    readFile(appUrl, "utf8"),
    readFile(programViewUrl, "utf8"),
  ]);

  assert.match(migration, /add column locked_at timestamptz/i);
  assert.match(migration, /create function public\.lock_program_for_use/i);
  assert.match(
    migration,
    /after insert on public\.program_assignments[\s\S]*after insert on public\.scheduled_workouts[\s\S]*after insert on public\.workout_sessions/i,
  );
  assert.match(
    migration,
    /program\.locked_at is null and candidate\.status = 'draft'[\s\S]*program\.locked_at is not null and candidate\.status = 'published'/i,
  );
  assert.doesNotMatch(
    migration.match(/create or replace function public\.publish_program_version[\s\S]*?\$\$;/i)?.[0] ?? "",
    /create_program_draft/i,
  );
  assert.match(migration, /Only unused editable content can be deleted/i);
  assert.match(repository, /rpc\("assign_program_for_use"/);
  assert.match(repository, /rpc\("assign_quick_workout_for_use"/);
  assert.match(repository, /rpc\("create_scheduled_occurrence_for_use"/);
  assert.match(migration, /First use is atomic/);
  assert.doesNotMatch(app, /repository\.publishProgram/);
  assert.match(programView, /Duplicate/);
});

test("changed legacy drafts survive as editable copies", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  assert.match(migration, /program_version_semantic_payload/i);
  assert.match(migration, /is distinct from private\.program_version_semantic_payload/i);
  assert.match(migration, /\(editable copy\)/i);
  assert.match(migration, /clone_program_version_tree/i);
});

test("coach assignment status requires a real upcoming dated occurrence", async () => {
  const [repository, app] = await Promise.all([
    readFile(repositoryUrl, "utf8"),
    readFile(appUrl, "utf8"),
  ]);

  assert.match(
    repository,
    /nextStatus === "planned"[\s\S]*?\? "scheduled"[\s\S]*?: "awaiting_schedule"/,
  );
  assert.doesNotMatch(repository, /scheduledWorkouts > 0[\s\S]*?\? "scheduled"/);
  assert.match(app, /No workout currently scheduled/);
});
