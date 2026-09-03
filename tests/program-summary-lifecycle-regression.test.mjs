import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const legacyMigrationUrl = new URL(
  "../supabase/migrations/202609020001_simple_content_lock_lifecycle.sql",
  import.meta.url,
);
const runMigrationUrl = new URL(
  "../supabase/migrations/202609020003_program_runs.sql",
  import.meta.url,
);
const repositoryUrl = new URL("../lib/repository.ts", import.meta.url);
const appUrl = new URL("../app/LiftLogApp.tsx", import.meta.url);
const programViewUrl = new URL(
  "../app/features/programs/ProgramView.tsx",
  import.meta.url,
);
const coachWorkspaceUrl = new URL(
  "../app/features/coaching/CoachWorkspace.tsx",
  import.meta.url,
);

test("first use freezes one run revision while a reusable draft remains editable", async () => {
  const [migration, repository, app, programView] = await Promise.all([
    readFile(runMigrationUrl, "utf8"),
    readFile(repositoryUrl, "utf8"),
    readFile(appUrl, "utf8"),
    readFile(programViewUrl, "utf8"),
  ]);

  assert.match(
    migration,
    /snapshot_program_for_run[\s\S]*publish_program_version\(draft_version_id[\s\S]*insert into public\.program_versions[\s\S]*'draft'[\s\S]*clone_program_version_tree/,
  );
  assert.match(
    migration,
    /create or replace function public\.can_edit_program[\s\S]*candidate\.status = 'draft'/i,
  );
  assert.doesNotMatch(
    migration.match(/create or replace function public\.can_edit_program[\s\S]*?\$\$;/i)?.[0] ?? "",
    /locked_at/i,
  );
  assert.match(repository, /rpc\("create_program_runs"/);
  assert.doesNotMatch(app, /repository\.publishProgram/);
  assert.match(app, /saved for future (?:runs|uses) without altering active or completed plans/i);
  assert.doesNotMatch(app, /stays editable until you schedule or assign it/i);
  assert.match(programView, /Save program/);
  assert.match(programView, /Duplicate/);
});

test("changed legacy drafts survive as editable copies", async () => {
  const migration = await readFile(legacyMigrationUrl, "utf8");
  assert.match(migration, /program_version_semantic_payload/i);
  assert.match(migration, /is distinct from private\.program_version_semantic_payload/i);
  assert.match(migration, /\(editable copy\)/i);
  assert.match(migration, /clone_program_version_tree/i);
});

test("coach assignment status requires a real upcoming dated occurrence", async () => {
  const [repository, coachWorkspace] = await Promise.all([
    readFile(repositoryUrl, "utf8"),
    readFile(coachWorkspaceUrl, "utf8"),
  ]);

  assert.match(
    repository,
    /nextStatus === "planned"[\s\S]*?\? "scheduled"[\s\S]*?: "awaiting_schedule"/,
  );
  assert.doesNotMatch(repository, /scheduledWorkouts > 0[\s\S]*?\? "scheduled"/);
  assert.match(coachWorkspace, /ProgramRunCompactCard/);
});
