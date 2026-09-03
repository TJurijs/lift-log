import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/202609030004_end_empty_single_workout_runs.sql",
  import.meta.url,
);

test("unscheduling an untouched self single-workout run restores its template state", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /create or replace function public\.schedule_workout/i);
  assert.match(sql, /target_planned_date is null/i);
  assert.match(sql, /run\.athlete_id = current_user_id[\s\S]*run\.created_by_id = current_user_id/i);
  assert.match(sql, /run\.status = 'not_started'/i);
  assert.match(sql, /count\(\*\)[\s\S]*= 1/i);
  assert.match(sql, /not exists \([\s\S]*public\.workout_sessions/i);
  assert.match(sql, /set status = 'ended'/i);
  assert.match(sql, /grant execute on function public\.schedule_workout\(uuid, date\) to authenticated/i);
});

