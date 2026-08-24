import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/202608240005_revisioned_session_drafts.sql",
  import.meta.url,
);
const migration = await readFile(migrationUrl, "utf8");
const conflictCorrection = await readFile(
  new URL(
    "../supabase/migrations/202608240007_non_retryable_session_revision_conflicts.sql",
    import.meta.url,
  ),
  "utf8",
);

const validator =
  migration.match(
    /create or replace function private\.validate_workout_draft_payload\([\s\S]*?\n\$\$;/i,
  )?.[0] ?? "";
const saveFunction =
  migration.match(
    /create or replace function public\.save_workout_session_draft\([\s\S]*?\n\$\$;/i,
  )?.[0] ?? "";
const completionFunction =
  migration.match(
    /create or replace function public\.complete_workout_session_confirmed\([\s\S]*?\n\$\$;/i,
  )?.[0] ?? "";

test("sessions carry additive draft and completion idempotency state", () => {
  assert.match(
    migration,
    /add column draft_revision bigint not null default 0[\s\S]*add column draft_write_token uuid[\s\S]*add column draft_write_payload_hash text[\s\S]*add column draft_saved_at timestamptz[\s\S]*add column completion_token uuid/i,
  );
  assert.match(
    migration,
    /workout_sessions_draft_confirmation_check[\s\S]*draft_revision = 0[\s\S]*draft_write_token is not null[\s\S]*draft_write_payload_hash is not null[\s\S]*draft_saved_at is not null/i,
  );
});

test("the full snapshot payload has explicit shape, size, identity, and value bounds", () => {
  assert.ok(validator);
  assert.match(validator, /octet_length\(draft_payload::text\) > 1000000/i);
  assert.match(
    validator,
    /payload_key\.name not in \('items', 'sessionRpe', 'sessionNote'\)/i,
  );
  assert.match(validator, /payload_item_count > 250/i);
  assert.match(validator, /payload_entry_count > 5000/i);
  assert.match(
    validator,
    /item_key\.name not in \('itemLogId', 'entries'\)/i,
  );
  assert.match(
    validator,
    /entry_key\.name not in \([\s\S]*'position'[\s\S]*'reps'[\s\S]*'loadKg'[\s\S]*'durationSeconds'[\s\S]*'distanceMetres'[\s\S]*'rounds'[\s\S]*'heartRate'[\s\S]*'rpe'[\s\S]*\)/i,
  );
  assert.match(
    validator,
    /payload_item_ids is distinct from session_item_ids[\s\S]*complete session item set/i,
  );
  assert.match(validator, /duplicate entry positions/i);
  assert.match(validator, /entry positions must be contiguous from zero/i);
  assert.match(validator, /entry count does not match its item mode/i);
  assert.match(
    validator,
    /not \('reps' = any\(item\.tracking_fields\)\)[\s\S]*not \('load' = any\(item\.tracking_fields\)\)[\s\S]*not \('duration' = any\(item\.tracking_fields\)\)[\s\S]*not \('distance' = any\(item\.tracking_fields\)\)[\s\S]*not \('rounds' = any\(item\.tracking_fields\)\)[\s\S]*not \('heartRate' = any\(item\.tracking_fields\)\)[\s\S]*not \('rpe' = any\(item\.tracking_fields\)\)/i,
  );
  assert.match(
    validator,
    /sessionRpe must be a whole number between 1 and 10[\s\S]*sessionNote cannot exceed 4000 characters/i,
  );
});

test("save locks, replays idempotently, and compare-and-swaps before mutation", () => {
  assert.ok(saveFunction);
  assert.match(saveFunction, /security definer\s+set search_path = ''/i);
  assert.match(
    saveFunction,
    /from public\.workout_sessions session[\s\S]*session\.id = target_session_id[\s\S]*session\.athlete_id = current_user_id[\s\S]*for update/i,
  );
  const replayAt = saveFunction.indexOf(
    "current_write_token is not distinct from write_token",
  );
  const compareAt = saveFunction.indexOf(
    "expected_revision is distinct from current_revision",
  );
  const validateAt = saveFunction.indexOf(
    "perform private.validate_workout_draft_payload",
  );
  const insertAt = saveFunction.indexOf("insert into public.session_entries");
  assert.ok(replayAt > -1 && compareAt > replayAt);
  assert.match(
    saveFunction,
    /extensions\.digest\(draft_payload::text, 'sha256'\)[\s\S]*current_payload_hash is distinct from requested_payload_hash[\s\S]*token was already used with a different payload/i,
  );
  assert.ok(validateAt > compareAt && insertAt > validateAt);
  assert.match(
    saveFunction,
    /errcode = '40001',[\s\S]*message = 'Workout draft revision is stale'/i,
  );
  assert.match(
    saveFunction,
    /on conflict \(session_item_log_id, position\) do update[\s\S]*delete from public\.session_entries existing_entry/i,
  );
  assert.match(
    saveFunction,
    /draft_revision = next_revision[\s\S]*draft_write_token = write_token[\s\S]*draft_write_payload_hash = requested_payload_hash[\s\S]*draft_saved_at = saved_at_value[\s\S]*session_rpe = \(draft_payload ->> 'sessionRpe'\)::numeric[\s\S]*athlete_note = draft_payload ->> 'sessionNote'/i,
  );
  assert.match(
    saveFunction,
    /jsonb_build_object\(\s*'revision', next_revision,\s*'savedAt', saved_at_value/i,
  );
});

test("confirmed completion is revision guarded and token-idempotent", () => {
  assert.ok(completionFunction);
  assert.match(
    completionFunction,
    /from public\.workout_sessions session[\s\S]*session\.athlete_id = current_user_id[\s\S]*for update/i,
  );
  assert.match(
    completionFunction,
    /if current_status = 'completed' then[\s\S]*stored_completion_token is not distinct from requested_completion_token[\s\S]*return target_session_id[\s\S]*Workout session was already completed/i,
  );
  assert.match(
    completionFunction,
    /expected_revision is null or expected_revision <= 0[\s\S]*completion requires a confirmed draft/i,
  );
  assert.match(
    completionFunction,
    /expected_revision is distinct from current_revision[\s\S]*errcode = '40001'[\s\S]*Workout draft revision is stale/i,
  );
  assert.match(
    completionFunction,
    /final_rpe is distinct from stored_session_rpe[\s\S]*coalesce\(final_note, ''\) is distinct from stored_session_note[\s\S]*Completion values must match the confirmed workout draft/i,
  );
  assert.match(
    completionFunction,
    /status = 'completed'[\s\S]*completed_for_date = coalesce\(scheduled_date, current_date\)[\s\S]*completion_token = requested_completion_token/i,
  );
});

test("new RPCs are bounded while the explicit rollback compatibility path remains", () => {
  assert.match(
    migration,
    /revoke all on function public\.save_workout_session_draft\(uuid, bigint, uuid, jsonb\)[\s\S]*grant execute on function public\.save_workout_session_draft\([\s\S]*uuid,[\s\S]*bigint,[\s\S]*uuid,[\s\S]*jsonb[\s\S]*\) to authenticated/i,
  );
  assert.match(
    migration,
    /revoke insert, update, delete on public\.session_item_logs from authenticated/i,
  );
  assert.match(
    migration,
    /grant insert, update, delete on public\.session_entries to authenticated[\s\S]*grant execute on function public\.complete_workout_session\(uuid, numeric, text\)\s+to authenticated/i,
    "legacy grants are intentionally retained only for coordinated rollback",
  );
  assert.doesNotMatch(
    migration,
    /revoke (insert|update|delete)[^;]*public\.session_entries from authenticated/i,
  );
});

test("hosted revision conflicts are non-retryable HTTP 409 responses", () => {
  assert.match(
    conflictCorrection,
    /save_workout_session_draft\(uuid,bigint,uuid,jsonb\)/i,
  );
  assert.match(
    conflictCorrection,
    /complete_workout_session_confirmed\(uuid,bigint,uuid,numeric,text\)/i,
  );
  assert.match(
    conflictCorrection,
    /errcode\\s\*=\\s\*''40001''[\s\S]*errcode = ''PT409''/i,
  );
});
