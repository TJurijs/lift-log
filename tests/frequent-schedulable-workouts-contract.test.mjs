import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/202608290003_frequent_schedulable_workouts.sql",
  import.meta.url,
);

test("frequent scheduling choices are bounded, private, and based on completed use", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(
    sql,
    /create function public\.list_frequent_schedulable_workouts\(\s*page_limit integer default 6\s*\)/i,
  );
  assert.match(sql, /language plpgsql\s+stable\s+security definer\s+set search_path = ''/i);
  assert.match(sql, /current_user_id uuid := \(select auth\.uid\(\)\)/i);
  assert.match(sql, /program\.content_type = 'quick_workout'/i);
  assert.match(sql, /program\.athlete_id = current_user_id/i);
  assert.match(
    sql,
    /assignment\.athlete_id = current_user_id\s+and assignment\.status = 'active'/i,
  );
  assert.match(
    sql,
    /session\.athlete_id = current_user_id\s+and session\.status = 'completed'/i,
  );
  assert.match(sql, /count\(\*\) as usage_count/i);
  assert.match(sql, /max\(session\.completed_at\) as last_used_at/i);
  assert.match(
    sql,
    /when session\.assignment_id is null then 'program'::text\s+else 'assignment'::text/i,
  );
  assert.match(
    sql,
    /coalesce\(session\.assignment_id, historical_version\.program_id\)/i,
    "usage must follow stable assignment or owning-program identity across versions",
  );
  assert.match(
    sql,
    /order by\s+usage\.usage_count desc,\s+usage\.last_used_at desc,\s+lower\(candidate\.workout_title\),\s+candidate\.kind,\s+coalesce\(candidate\.assignment_id, candidate\.program_id\),\s+candidate\.workout_id/i,
  );
  assert.match(
    sql,
    /limit least\(greatest\(coalesce\(page_limit, 6\), 1\), 12\)/i,
  );
  assert.match(
    sql,
    /occurrence\.athlete_id = current_user_id[\s\S]*occurrence\.program_version_id = candidate\.program_version_id[\s\S]*occurrence\.workout_id = candidate\.workout_id[\s\S]*occurrence\.assignment_id is not distinct from candidate\.assignment_id/i,
    "the reusable undated occurrence lookup must retain the exact current candidate identity",
  );
  assert.match(
    sql,
    /revoke all on function public\.list_frequent_schedulable_workouts\(integer\)[\s\S]*from public, anon, authenticated/i,
  );
  assert.match(
    sql,
    /grant execute on function public\.list_frequent_schedulable_workouts\(integer\)[\s\S]*to authenticated/i,
  );
  assert.doesNotMatch(sql, /\b(?:insert into|update public|delete from)\b/i);
});
