import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/202608220006_finite_programs_and_week_copy.sql",
  import.meta.url,
);
const repositoryUrl = new URL("../lib/repository.ts", import.meta.url);

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

test("repository exposes program creation without user-managed week operations", async () => {
  const repository = await readFile(repositoryUrl, "utf8");

  assert.match(
    repository,
    /async createBlankProgram\(athleteId: string, title: string\)[\s\S]*create_blank_program[\s\S]*target_title: title/i,
  );
  assert.doesNotMatch(repository, /target_planning_mode: mode === "fixed"/i);
  assert.doesNotMatch(
    repository,
    /async (?:addProgramWeek|deleteProgramWeek|duplicateWeek|duplicateWeekTimes)\b/i,
  );
});
