import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/202608290001_v1_performance_data_architecture.sql",
  import.meta.url,
);

const sql = await readFile(migrationUrl, "utf8");

function functionBody(name) {
  const escapedName = name.replaceAll(".", "\\.");
  const match = sql.match(
    new RegExp(
      `create or replace function ${escapedName}\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  );
  assert.ok(match, `missing SQL function ${name}`);
  return match[0];
}

test("forward migration preserves legacy assignment identity", () => {
  assert.match(sql, /begin;[\s\S]*commit;/);
  assert.match(sql, /create table public\.program_assignments/);
  assert.match(
    sql,
    /source_version_id uuid references public\.program_versions\(id\) on delete restrict/,
  );
  assert.match(sql, /customized_program_id uuid references public\.programs\(id\) on delete restrict/);
  assert.match(
    sql,
    /insert into public\.program_assignments[\s\S]*legacy_materialized[\s\S]*assigned\.assigned_from_program_id/,
  );
  assert.match(sql, /disable trigger protect_workout_session_history/);
  assert.match(sql, /update public\.workout_sessions session[\s\S]*set assignment_id/);
  assert.match(
    functionBody("private.validate_program_assignment"),
    /source_version_id is distinct from old\.source_version_id[\s\S]*Program assignment identity and source are immutable/,
  );
  assert.doesNotMatch(sql, /delete from public\.(programs|program_versions|program_weeks|workouts)/i);
});

test("normal assignment is set based and cloning is explicit", () => {
  const assign = functionBody("public.assign_published_program_version");
  const fork = functionBody("public.fork_program_assignment");

  assert.match(assign, /with requested as materialized/);
  assert.match(assign, /insert into public\.program_assignments/);
  assert.match(assign, /at most 50 athletes/);
  assert.doesNotMatch(assign, /clone_program_version_tree/);
  assert.doesNotMatch(assign, /foreach|\bloop\b/i);

  assert.match(fork, /target_idempotency_key uuid/);
  assert.match(fork, /private\.clone_program_version_tree/);
  assert.match(fork, /customized_program_id = new_program_id/);
});

test("calendar mutation creates one selected idempotent occurrence", () => {
  const createOccurrence = functionBody("public.create_scheduled_occurrence");

  assert.match(createOccurrence, /target_workout_id uuid/);
  assert.match(createOccurrence, /target_idempotency_key uuid/);
  assert.match(createOccurrence, /request_key = target_idempotency_key/);
  assert.equal(
    (createOccurrence.match(/insert into public\.scheduled_workouts/g) ?? []).length,
    1,
  );
  assert.doesNotMatch(createOccurrence, /for\s+\w+\s+in[\s\S]*loop/i);
  assert.match(sql, /drop function if exists public\.prepare_program_schedule\(uuid\)/);
  assert.doesNotMatch(sql, /create or replace function public\.prepare_program_schedule/);
  assert.match(sql, /drop function if exists public\.set_program_availability\(uuid, boolean\)/);
  assert.match(sql, /drop function if exists public\.assign_own_program_to_athletes\(uuid, uuid\[\]\)/);
  assert.match(sql, /drop function if exists public\.start_or_resume_workout\(uuid, uuid, uuid\)/);
});

test("session start snapshots one workout with set-based inserts", () => {
  const start = functionBody("public.start_scheduled_workout");
  assert.match(start, /scheduled_occurrence\.assignment_id/);
  assert.match(start, /with source_items as materialized/);
  assert.match(start, /inserted_items as/);
  assert.match(start, /entry_seed as/);
  assert.doesNotMatch(start, /for\s+\w+\s+in[\s\S]*loop/i);
});

test("read surface is bounded and cursor based", () => {
  const expectedFunctions = [
    "public.get_workspace_bootstrap",
    "public.list_program_summaries",
    "public.get_program_version_detail",
    "public.get_scheduled_workout_detail",
    "public.list_calendar_occurrences",
    "public.list_calendar_session_summaries",
    "public.list_completed_session_summaries",
    "public.search_exercises",
    "public.list_schedulable_workouts",
    "public.get_coaching_access_summary",
    "public.list_coach_athletes",
    "public.get_coach_athlete_detail",
  ];
  for (const name of expectedFunctions) functionBody(name);

  assert.match(functionBody("public.list_program_summaries"), /after_created_at[\s\S]*after_id/);
  assert.match(functionBody("public.list_program_summaries"), /least\([\s\S]*50\)/);
  assert.match(functionBody("public.list_calendar_occurrences"), /range_end - range_start > 92/);
  assert.match(functionBody("public.list_calendar_occurrences"), /least\([\s\S]*200\)/);
  const calendarSessions = functionBody("public.list_calendar_session_summaries");
  assert.match(calendarSessions, /range_end - range_start > 92/);
  assert.match(calendarSessions, /completed_for_date between range_start and range_end/);
  assert.match(calendarSessions, /least\([\s\S]*200\)/);
  assert.match(functionBody("public.list_completed_session_summaries"), /before_started_at[\s\S]*before_id/);
  assert.match(functionBody("public.search_exercises"), /after_name[\s\S]*after_id/);
  const schedulable = functionBody("public.list_schedulable_workouts");
  assert.match(schedulable, /candidate_page as materialized/);
  assert.match(schedulable, /after_program_title[\s\S]*after_week_index[\s\S]*after_workout_position[\s\S]*after_id/);
  assert.match(schedulable, /latest_occurrence_id/);
  assert.match(schedulable, /least\([\s\S]*100\)/);
  assert.doesNotMatch(schedulable, /insert into|update public|delete from/i);
  const coachingAccess = functionBody("public.get_coaching_access_summary");
  assert.match(coachingAccess, /'coachConnections'[\s\S]*'pendingCoachInvites'[\s\S]*'outgoingCoachInvites'/);
  assert.equal((coachingAccess.match(/limit 25/g) ?? []).length, 3);
  assert.match(functionBody("public.list_coach_athletes"), /least\([\s\S]*50\)/);
  assert.match(functionBody("public.get_coach_athlete_detail"), /program_limit[\s\S]*upcoming_limit[\s\S]*completed_limit/);
  assert.doesNotMatch(functionBody("public.get_coach_athlete_detail"), /workoutProgress|target_progress_limit/);
});

test("bootstrap exposes revisioned offline recovery identity", () => {
  const bootstrap = functionBody("public.get_workspace_bootstrap");
  for (const key of [
    "draftRevision",
    "draftWriteToken",
    "assignmentId",
    "programVersionId",
    "workoutId",
    "scheduledWorkoutId",
    "itemLogIds",
    "activeWorkout",
  ]) {
    assert.match(bootstrap, new RegExp(`'${key}'`));
  }
  assert.match(bootstrap, /limit 6/);
});

test("exact test cleanup removes shared assignments before deleting programs", () => {
  assert.match(
    sql,
    /alter function public\.reset_test_population\(text, text\[\]\)[\s\S]*rename to reset_test_population_pre_v1/,
  );
  assert.match(
    sql,
    /Fixture assignments cross namespace boundaries; reset aborted/,
  );
  assert.match(
    sql,
    /set_config\('liftlog\.test_reset', 'on', true\)[\s\S]*delete from public\.workout_sessions session[\s\S]*delete from public\.scheduled_workouts scheduled[\s\S]*delete from public\.program_assignments assignment[\s\S]*assignment\.athlete_id = any\(test_ids\)[\s\S]*assignment\.assigned_by_id = any\(test_ids\)[\s\S]*reset_test_population_pre_v1/,
  );
  assert.match(
    sql,
    /grant execute on function public\.reset_test_population\(text, text\[\]\)[\s\S]*to service_role/,
  );
});

test("indexes and RLS follow bounded access paths", () => {
  for (const indexName of [
    "idx_program_assignments_athlete_active_assigned",
    "idx_scheduled_workouts_athlete_calendar",
    "idx_scheduled_workouts_assignment_open_calendar",
    "idx_workout_sessions_athlete_completed_cursor",
    "idx_workout_sessions_assignment_completed_cursor",
    "idx_exercises_global_search",
    "idx_exercises_personal_search",
  ]) {
    assert.match(sql, new RegExp(`create (?:unique )?index ${indexName}`));
  }
  assert.match(sql, /drop index if exists public\.idx_program_weeks_version_week_index/);
  assert.match(sql, /drop index if exists public\.idx_workout_items_section_position/);
  assert.match(sql, /drop index if exists public\.idx_scheduled_workouts_athlete_date/);
  assert.match(sql, /create policy program_assignments_read_participant/);
  assert.match(sql, /create policy scheduled_workouts_read_authorized[\s\S]*assignment_id is not null/);
  assert.match(sql, /revoke insert, update, delete on public\.program_assignments/);
  assert.match(sql, /grant execute on function public\.get_workspace_bootstrap\(\)[\s\S]*to authenticated/);
});
