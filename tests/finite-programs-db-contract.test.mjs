import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/202608220006_finite_programs_and_week_copy.sql",
  import.meta.url,
);
const repositoryUrl = new URL("../lib/repository.ts", import.meta.url);
const lintCleanupUrl = new URL(
  "../supabase/migrations/202608220007_week_copy_lint_cleanup.sql",
  import.meta.url,
);

test("repeating programs and templates are migrated to a fixed invariant", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  assert.match(
    migration,
    /update public\.programs[\s\S]*planning_mode = 'fixed_weeks'[\s\S]*where planning_mode = 'repeating_week'/i,
  );
  assert.match(
    migration,
    /update public\.program_templates[\s\S]*planning_mode = 'fixed_weeks'[\s\S]*where planning_mode = 'repeating_week'/i,
  );
  assert.match(
    migration,
    /add constraint programs_planning_mode_check[\s\S]*planning_mode = 'fixed_weeks'/i,
  );
  assert.match(
    migration,
    /add constraint program_templates_planning_mode_check[\s\S]*planning_mode = 'fixed_weeks'/i,
  );
  assert.match(
    migration,
    /create_blank_program[\s\S]*Repeating programs are no longer supported[\s\S]*'fixed_weeks'/i,
    "new blank programs must not recreate the retired repeating mode",
  );
  assert.match(
    migration,
    /create_program_from_template[\s\S]*template_row\.description,[\s\S]*'fixed_weeks'/i,
    "library materialization must preserve the fixed invariant",
  );
});

test("multi-copy week RPC is authenticated, atomic, ordered, and bounded", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const rpc = migration.slice(
    migration.indexOf(
      "create or replace function public.duplicate_program_week_times",
    ),
    migration.indexOf("revoke all on function public.create_blank_program"),
  );

  assert.match(rpc, /security definer[\s\S]*set search_path = ''/i);
  assert.match(rpc, /auth\.uid\(\)[\s\S]*Authentication required/i);
  assert.match(rpc, /copy_count not between 1 and 51/i);
  assert.match(rpc, /program_versions[\s\S]*for update/i);
  assert.match(rpc, /can_edit_version\(source_version_id\)/i);
  assert.match(rpc, /existing_count \+ copy_count > 52/i);
  assert.match(
    rpc,
    /week_index := maximum_index \+ copy_offset/i,
    "copies must be appended with contiguous week indices",
  );
  assert.match(
    rpc,
    /for copy_offset in 1\.\.copy_count[\s\S]*private\.clone_week_contents\(source_week_id, copied_week_id\)[\s\S]*return next/i,
    "every returned week must be a deep copy created in the same RPC transaction",
  );
  assert.match(
    migration,
    /revoke all on function public\.duplicate_program_week_times\(uuid, integer\) from public[\s\S]*grant execute on function public\.duplicate_program_week_times\(uuid, integer\) to authenticated/i,
  );
});

test("converted terminal programs are reconciled without deleting history", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  assert.match(
    migration,
    /delete from public\.program_availability[\s\S]*exists \([\s\S]*public\.scheduled_workouts[\s\S]*not exists \([\s\S]*status in \('planned', 'in_progress'\)/i,
  );
  assert.doesNotMatch(
    migration,
    /delete from public\.(scheduled_workouts|workout_sessions)/i,
    "conversion must preserve scheduled and completed workout history",
  );
});

test("repository exposes finite creation and atomic multi-copy operations", async () => {
  const repository = await readFile(repositoryUrl, "utf8");

  assert.match(
    repository,
    /async createBlankProgram\(athleteId: string, title: string\)[\s\S]*create_blank_program[\s\S]*target_title: title/i,
  );
  assert.doesNotMatch(repository, /target_planning_mode: mode === "fixed"/i);
  assert.match(
    repository,
    /async duplicateWeekTimes\(sourceWeekId: string, copyCount: number\)[\s\S]*duplicate_program_week_times[\s\S]*source_week_id: sourceWeekId[\s\S]*copy_count: copyCount/i,
  );
});

test("the deployed week-copy function stays clean under strict database lint", async () => {
  const cleanup = await readFile(lintCleanupUrl, "utf8");
  assert.match(cleanup, /for copy_offset in 1\.\.copy_count loop/i);
  assert.doesNotMatch(cleanup, /copy_offset integer;/i);
});
