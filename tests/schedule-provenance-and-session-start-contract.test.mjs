import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/202608240001_schedule_provenance_and_safe_session_start.sql",
  import.meta.url,
);

const migration = await readFile(migrationUrl, "utf8");
const scheduleTrigger =
  migration.match(
    /create or replace function private\.protect_schedule_identity\(\)[\s\S]*?\n\$\$;/i,
  )?.[0] ?? "";
const startFunction =
  migration.match(
    /create or replace function public\.start_or_resume_workout\([\s\S]*?\n\$\$;/i,
  )?.[0] ?? "";
const deactivateFunction =
  migration.match(
    /create or replace function public\.deactivate_current_program\([\s\S]*?\n\$\$;/i,
  )?.[0] ?? "";

test("coach scheduling is an insert-only authorization with immutable provenance", () => {
  assert.ok(scheduleTrigger, "the final schedule trigger definition must be present");
  assert.match(
    scheduleTrigger,
    /if tg_op = 'UPDATE' then[\s\S]*new\.athlete_id is distinct from old\.athlete_id[\s\S]*new\.program_version_id is distinct from old\.program_version_id[\s\S]*new\.workout_id is distinct from old\.workout_id[\s\S]*new\.scheduled_by_id is distinct from old\.scheduled_by_id[\s\S]*return new;/i,
    "updates must preserve the athlete, content identity, and factual scheduler",
  );

  const updateBranchEnd = scheduleTrigger.indexOf("return new;", scheduleTrigger.indexOf("if tg_op = 'UPDATE'"));
  const coachAuthorization = scheduleTrigger.indexOf("Coach-scheduled workout must record");
  assert.ok(
    updateBranchEnd > -1 && coachAuthorization > updateBranchEnd,
    "coach authorization must run only after the UPDATE branch has returned",
  );

  assert.match(
    scheduleTrigger,
    /current_user_id uuid := \(select auth\.uid\(\)\)[\s\S]*new\.scheduled_by_id is distinct from current_user_id/i,
  );
  assert.match(
    scheduleTrigger,
    /if new\.scheduled_by_id = new\.athlete_id then[\s\S]*current_user_id is distinct from new\.athlete_id[\s\S]*return new;/i,
    "an authenticated non-athlete cannot forge athlete scheduler provenance",
  );
  assert.match(
    scheduleTrigger,
    /new\.status is distinct from 'planned' or new\.planned_date is null/i,
    "coach placement must be a dated planned occurrence",
  );
  assert.match(
    scheduleTrigger,
    /from public\.coach_relationships relationship[\s\S]*relationship\.athlete_id = new\.athlete_id[\s\S]*relationship\.coach_id = current_user_id[\s\S]*relationship\.ended_at is null[\s\S]*for share/i,
    "the active relationship must remain stable through the insert transaction",
  );
  assert.match(
    scheduleTrigger,
    /version\.status = 'published'[\s\S]*version\.authored_by_id = current_user_id[\s\S]*program\.athlete_id = new\.athlete_id[\s\S]*program\.created_by_id = current_user_id[\s\S]*program\.source_type = 'coach'[\s\S]*program\.content_type = 'quick_workout'[\s\S]*program\.assigned_from_program_id is not null/i,
    "only the authenticated coach's published athlete-owned quick-workout assignment is eligible",
  );
});

test("athlete deactivation atomically clears availability without deleting history", () => {
  assert.ok(deactivateFunction, "the repaired deactivation RPC must be present");
  assert.match(deactivateFunction, /security definer\s+set search_path = ''/i);
  assert.match(
    deactivateFunction,
    /program\.id = target_program_id[\s\S]*program\.is_current[\s\S]*program\.archived_at is null[\s\S]*for update/i,
  );
  assert.match(
    deactivateFunction,
    /target_athlete_id <> current_user_id[\s\S]*Only the athlete can deactivate their current program/i,
    "deactivation must remain athlete-owned",
  );
  assert.match(
    deactivateFunction,
    /delete from public\.program_availability availability\s+where availability\.program_id = target_program_id\s+and availability\.athlete_id = current_user_id/i,
    "availability cleanup must occur inside the deactivation transaction",
  );
  assert.match(
    deactivateFunction,
    /delete from public\.scheduled_workouts scheduled[\s\S]*scheduled\.athlete_id = current_user_id[\s\S]*scheduled\.status = 'planned'[\s\S]*not exists \([\s\S]*public\.workout_sessions/i,
    "only unstarted future occurrences may be cleaned up",
  );
  assert.doesNotMatch(
    deactivateFunction,
    /delete from public\.workout_sessions/i,
    "session history must be preserved",
  );
  assert.doesNotMatch(
    deactivateFunction,
    /delete from public\.programs/i,
    "deactivation must not broaden into hard deletion",
  );
  assert.match(
    deactivateFunction,
    /update public\.programs\s+set is_current = false,[\s\S]*archived_at = now\(\)[\s\S]*athlete_id = current_user_id/i,
  );
});

test("the one-active-session invariant fails safely before its partial index is created", () => {
  const guardPosition = migration.indexOf("having count(*) > 1");
  const indexPosition = migration.indexOf(
    "create unique index idx_workout_sessions_one_in_progress_per_athlete",
  );

  assert.ok(guardPosition > -1, "duplicate active sessions need an explicit migration guard");
  assert.ok(indexPosition > guardPosition, "the duplicate guard must run before index creation");
  assert.match(
    migration,
    /from public\.workout_sessions session[\s\S]*where session\.status = 'in_progress'[\s\S]*group by session\.athlete_id[\s\S]*having count\(\*\) > 1[\s\S]*raise exception/i,
  );
  assert.match(
    migration,
    /create unique index idx_workout_sessions_one_in_progress_per_athlete\s+on public\.workout_sessions \(athlete_id\)\s+where status = 'in_progress'/i,
  );
});

test("session start locks the owned occurrence and enforces its state machine", () => {
  assert.ok(startFunction, "the hardened start RPC definition must be present");
  assert.match(startFunction, /security definer\s+set search_path = ''/i);
  assert.match(
    startFunction,
    /if target_scheduled_workout_id is null then[\s\S]*raise exception 'A scheduled workout is required'/i,
  );
  assert.match(
    startFunction,
    /from public\.scheduled_workouts occurrence[\s\S]*occurrence\.id = target_scheduled_workout_id[\s\S]*occurrence\.athlete_id = current_user_id[\s\S]*for update/i,
    "the exact athlete-owned occurrence must be locked before state is inspected",
  );
  assert.match(startFunction, /scheduled_occurrence\.planned_date is null[\s\S]*Undated workout cannot be started/i);
  assert.match(startFunction, /scheduled_occurrence\.status = 'skipped'[\s\S]*Skipped workout must be restored/i);
  assert.match(startFunction, /scheduled_occurrence\.status = 'completed'[\s\S]*Completed workout cannot be started again/i);
  assert.match(
    startFunction,
    /scheduled_occurrence\.status = 'in_progress'[\s\S]*workout_session\.scheduled_workout_id = scheduled_occurrence\.id[\s\S]*workout_session\.athlete_id = current_user_id[\s\S]*workout_session\.program_version_id = scheduled_occurrence\.program_version_id[\s\S]*workout_session\.workout_id = scheduled_occurrence\.workout_id[\s\S]*workout_session\.status = 'in_progress'[\s\S]*return existing_session_id/i,
    "resume must return only the session matching the locked occurrence",
  );
  assert.match(
    startFunction,
    /scheduled_occurrence\.status is distinct from 'planned'[\s\S]*Only a planned workout can be started[\s\S]*where workout_session\.athlete_id = current_user_id[\s\S]*workout_session\.status = 'in_progress'[\s\S]*Finish the in-progress workout before starting another[\s\S]*insert into public\.workout_sessions/i,
    "new session creation must be planned-only and reject another active session",
  );
  assert.match(
    startFunction,
    /update public\.scheduled_workouts\s+set status = 'in_progress'[\s\S]*id = scheduled_occurrence\.id[\s\S]*athlete_id = current_user_id[\s\S]*status = 'planned'[\s\S]*if not found/i,
    "the final occurrence transition must remain conditional on planned state",
  );
});

test("RPC grants and direct-write revocations preserve the security boundary", () => {
  assert.match(
    migration,
    /revoke insert, update, delete on public\.scheduled_workouts from authenticated/i,
  );
  assert.match(
    migration,
    /revoke insert, update, delete on public\.workout_sessions from authenticated/i,
  );
  assert.match(
    migration,
    /revoke all on function private\.protect_schedule_identity\(\) from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /revoke all on function public\.start_or_resume_workout\(uuid, uuid, uuid\) from public, anon, authenticated[\s\S]*grant execute on function public\.start_or_resume_workout\(uuid, uuid, uuid\) to authenticated/i,
  );
  assert.match(
    migration,
    /revoke all on function public\.deactivate_current_program\(uuid\) from public, anon, authenticated[\s\S]*grant execute on function public\.deactivate_current_program\(uuid\) to authenticated/i,
  );
  assert.match(
    migration,
    /select pg_catalog\.set_config\('search_path', 'public', false\);/i,
  );
});
