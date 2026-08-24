import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rollback = await readFile(
  new URL(
    "../supabase/dev-rollbacks/restore_pre_author_scope_read_compatibility.sql",
    import.meta.url,
  ),
  "utf8",
);

test("the dev frontend rollback has a transactional read-compatibility repair", () => {
  assert.match(rollback, /^-- Development-only emergency compatibility rollback/m);
  assert.match(rollback, /begin;[\s\S]*commit;/i);
  assert.match(
    rollback,
    /create or replace function public\.can_read_program[\s\S]*public\.is_active_coach\(program\.athlete_id\)/i,
  );
  for (const policy of [
    "profiles_read_connected",
    "programs_read_authorized",
    "program_availability_read_authorized",
    "scheduled_workouts_read_authorized",
    "workout_sessions_read_authorized",
    "session_item_logs_read_authorized",
    "session_entries_read_authorized",
    "coach_feedback_read_authorized",
  ]) {
    assert.match(rollback, new RegExp(`create policy ${policy}`, "i"));
  }
});
