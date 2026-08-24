import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/202608240004_author_scoped_coach_reads.sql",
  import.meta.url,
);
const migration = await readFile(migrationUrl, "utf8");
const app = await readFile(
  new URL("../app/LiftLogApp.tsx", import.meta.url),
  "utf8",
);

function definition(name) {
  return (
    migration.match(
      new RegExp(
        `create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
        "i",
      ),
    )?.[0] ?? ""
  );
}

const canReadProgram = definition("can_read_program");
const connectedProfiles = definition("list_connected_profile_summaries");
const coachSummaries = definition("list_authored_coach_session_summaries");
const coachDetail = definition("get_authored_coach_session_detail");
const ownNotes = definition("get_own_session_notes");

test("program and occurrence reads are restricted to the authoring active coach", () => {
  assert.match(
    canReadProgram,
    /program\.athlete_id = \(select auth\.uid\(\)\)[\s\S]*program\.created_by_id = \(select auth\.uid\(\)\)[\s\S]*program\.source_type = 'coach'[\s\S]*public\.is_active_coach\(program\.athlete_id\)/i,
  );
  assert.match(
    migration,
    /create policy programs_read_authorized[\s\S]*using \(public\.can_read_program\(id\)\)/i,
  );
  assert.match(
    migration,
    /create policy program_availability_read_authorized[\s\S]*athlete_id = \(select auth\.uid\(\)\)[\s\S]*public\.can_read_program\(program_id\)/i,
  );
  assert.match(
    migration,
    /create policy scheduled_workouts_read_authorized[\s\S]*athlete_id = \(select auth\.uid\(\)\)[\s\S]*public\.can_read_version\(program_version_id\)/i,
  );
});

test("base profile and session tables are owner-only", () => {
  assert.match(
    migration,
    /create policy profiles_read_self on public\.profiles for select to authenticated\s+using \(id = \(select auth\.uid\(\)\)\)/i,
  );
  assert.match(
    migration,
    /create policy workout_sessions_read_owner[\s\S]*using \(athlete_id = \(select auth\.uid\(\)\)\)/i,
  );
  assert.match(
    migration,
    /create policy session_item_logs_read_owner[\s\S]*session\.athlete_id = \(select auth\.uid\(\)\)/i,
  );
  assert.match(
    migration,
    /create policy session_entries_read_owner[\s\S]*session\.athlete_id = \(select auth\.uid\(\)\)/i,
  );
});

test("connected profile summaries expose only id and display name", () => {
  assert.match(
    connectedProfiles,
    /returns table \(\s*id uuid,\s*display_name text\s*\)/i,
  );
  assert.match(
    connectedProfiles,
    /relationship\.ended_at is null[\s\S]*relationship\.athlete_id = \(select auth\.uid\(\)\)[\s\S]*relationship\.coach_id = profile\.id[\s\S]*relationship\.coach_id = \(select auth\.uid\(\)\)[\s\S]*relationship\.athlete_id = profile\.id/i,
  );
  assert.doesNotMatch(
    connectedProfiles,
    /first_name|last_name|liftlog_id|timezone|weight_unit|distance_unit/i,
  );
});

test("coach session RPCs enforce authorship and omit every private note field", () => {
  for (const rpc of [coachSummaries, coachDetail]) {
    assert.ok(rpc);
    assert.match(rpc, /security definer\s+set search_path = ''/i);
    assert.match(
      rpc,
      /relationship\.coach_id = \(select auth\.uid\(\)\)[\s\S]*relationship\.ended_at is null[\s\S]*program\.created_by_id = \(select auth\.uid\(\)\)[\s\S]*program\.source_type = 'coach'/i,
    );
    assert.doesNotMatch(
      rpc,
      /athlete_note|item\.athlete_note|entry\.note|'note'|'sessionNote'|'itemNotes'|'entryNotes'/i,
    );
  }
  assert.match(coachSummaries, /session\.status = 'completed'/i);
  assert.match(
    coachSummaries,
    /target_athlete_id uuid default null[\s\S]*target_limit integer default 100[\s\S]*target_before_started_at timestamptz default null[\s\S]*target_before_id uuid default null/i,
  );
  assert.match(
    coachSummaries,
    /\(session\.started_at, session\.id\)[\s\S]*< \(target_before_started_at, target_before_id\)[\s\S]*limit least\(greatest\(coalesce\(target_limit, 100\), 1\), 250\)/i,
  );
  assert.match(coachDetail, /session\.status = 'completed'/i);
  assert.match(coachDetail, /'items'[\s\S]*'entries'/i);
});

test("the owner-only notes RPC keeps note data out of coach projections", () => {
  assert.match(
    ownNotes,
    /session\.athlete_id = \(select auth\.uid\(\)\)/i,
  );
  assert.match(
    ownNotes,
    /'sessionNote', session\.athlete_note[\s\S]*'itemNotes'[\s\S]*jsonb_object_agg\([\s\S]*item\.athlete_note[\s\S]*'entryNotes'[\s\S]*entry\.note/i,
  );
  assert.match(
    migration,
    /revoke all on function public\.get_authored_coach_session_detail\(uuid\)[\s\S]*grant execute on function public\.get_authored_coach_session_detail\(uuid\)\s+to authenticated/i,
  );
});

test("feedback on a session inherits the authored-session boundary", () => {
  assert.match(
    migration,
    /create policy coach_feedback_create_active_coach[\s\S]*workout_session_id is not null[\s\S]*public\.can_read_authored_session\(workout_session_id\)/i,
  );
  assert.match(
    migration,
    /create policy coach_feedback_update_author[\s\S]*public\.can_read_authored_session\(workout_session_id\)/i,
  );
  assert.doesNotMatch(
    migration,
    /coach_feedback[\s\S]{0,600}workout_session_id is null\s+or public\.can_read_authored_session/i,
  );
});

test("coaching permission copy matches the author-scoped private-note boundary", () => {
  assert.match(app, /View programs they authored for you and their linked results/i);
  assert.match(app, /View only programs they author for you and linked results/i);
  assert.match(
    app,
    /Cannot view private notes, unrelated training, or edit history/i,
  );
  assert.doesNotMatch(app, /View your calendar, sessions, RPE, and training notes/i);
  assert.doesNotMatch(app, /View your calendar, reports, and workout notes/i);
});
