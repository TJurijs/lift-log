import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

const databaseUrl =
  process.env.LIFTLOG_V1_SMOKE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const parsedUrl = new URL(databaseUrl);
const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

if (!loopbackHosts.has(parsedUrl.hostname)) {
  throw new Error(
    "V1 database smoke refused: LIFTLOG_V1_SMOKE_DB_URL must use a loopback host.",
  );
}
if (!/^postgres(?:ql)?:$/.test(parsedUrl.protocol)) {
  throw new Error("V1 database smoke refused: expected a PostgreSQL URL.");
}

const db = postgres(databaseUrl, {
  max: 1,
  connect_timeout: 5,
  idle_timeout: 2,
  onnotice: () => {},
});

const ids = Object.fromEntries(
  [
    "coach",
    "athlete",
    "relationship",
    "program",
    "version",
    "phase",
    "week",
    "workout",
    "section",
    "item",
    "prescription",
    "assignmentKey",
    "scheduleKey",
  ].map((key) => [key, randomUUID()]),
);
const today = new Date().toISOString().slice(0, 10);
let transactionOpen = false;

try {
  const [contract] = await db`
    select
      to_regprocedure(
        'public.assign_published_program_version(uuid,uuid,uuid[],uuid)'
      )::text as assign_rpc,
      to_regprocedure(
        'public.create_scheduled_occurrence(uuid,date,uuid,uuid,uuid)'
      )::text as schedule_rpc,
      to_regprocedure('public.start_scheduled_workout(uuid)')::text as start_rpc,
      to_regprocedure('public.prepare_program_schedule(uuid)')::text as obsolete_prepare
  `;
  assert.ok(contract.assign_rpc, "apply the V1 performance migration first");
  assert.ok(contract.schedule_rpc);
  assert.ok(contract.start_rpc);
  assert.equal(contract.obsolete_prepare, null);

  await db.unsafe("begin");
  transactionOpen = true;

  await db`
    insert into auth.users (
      id,
      email,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    ) values
      (
        ${ids.coach}::uuid,
        ${`v1-smoke-coach-${ids.coach}@example.test`},
        '{}'::jsonb,
        '{"given_name":"Smoke","family_name":"Coach"}'::jsonb,
        now(),
        now()
      ),
      (
        ${ids.athlete}::uuid,
        ${`v1-smoke-athlete-${ids.athlete}@example.test`},
        '{}'::jsonb,
        '{"given_name":"Smoke","family_name":"Athlete"}'::jsonb,
        now(),
        now()
      )
  `;
  await db`
    insert into public.coach_relationships (id, athlete_id, coach_id)
    values (${ids.relationship}::uuid, ${ids.athlete}::uuid, ${ids.coach}::uuid)
  `;
  await db`
    insert into public.programs (
      id, athlete_id, created_by_id, title, description, planning_mode,
      is_current, source_type, source_label, content_type
    ) values (
      ${ids.program}::uuid, ${ids.coach}::uuid, ${ids.coach}::uuid,
      'V1 rollback smoke', 'Transactional runtime contract', 'fixed_weeks',
      true, 'self', 'Created by you', 'program'
    )
  `;
  await db`
    insert into public.program_versions (
      id, program_id, authored_by_id, version_number, status, title, description
    ) values (
      ${ids.version}::uuid, ${ids.program}::uuid, ${ids.coach}::uuid,
      1, 'draft', 'V1 rollback smoke', 'Transactional runtime contract'
    )
  `;
  await db`
    insert into public.program_phases (id, program_version_id, name, position)
    values (${ids.phase}::uuid, ${ids.version}::uuid, 'Base', 0)
  `;
  await db`
    insert into public.program_weeks (
      id, program_version_id, phase_id, week_index, label
    ) values (
      ${ids.week}::uuid, ${ids.version}::uuid, ${ids.phase}::uuid, 1, 'Week 1'
    )
  `;
  await db`
    insert into public.workouts (
      id, program_week_id, title, day_of_week, position,
      estimated_minutes, schedule_label
    ) values (
      ${ids.workout}::uuid, ${ids.week}::uuid, 'Session A', 1, 0, 45, 'Monday'
    )
  `;
  await db`
    insert into public.workout_sections (
      id, workout_id, title, section_kind, notes, position
    ) values (${ids.section}::uuid, ${ids.workout}::uuid, 'Main', 'main', '', 0)
  `;
  await db`
    insert into public.workout_items (
      id, section_id, snapshot_name, snapshot_cue,
      entry_mode, tracking_fields, position
    ) values (
      ${ids.item}::uuid, ${ids.section}::uuid, 'Back squat', 'Brace',
      'sets', array['reps', 'load'], 0
    )
  `;
  await db`
    insert into public.prescribed_entries (
      id, workout_item_id, position, reps_min, reps_max, load_kg
    ) values (${ids.prescription}::uuid, ${ids.item}::uuid, 0, 5, 5, 50)
  `;
  await db`
    update public.program_versions
    set status = 'published', effective_from = current_date, published_at = now()
    where id = ${ids.version}::uuid
  `;

  await db.unsafe("set local role authenticated");
  await db`select set_config('request.jwt.claim.sub', ${ids.coach}, true)`;

  const firstAssignment = await db`
    select *
    from public.assign_published_program_version(
      ${ids.program}::uuid,
      ${ids.version}::uuid,
      array[${ids.athlete}::uuid],
      ${ids.assignmentKey}::uuid
    )
  `;
  const retriedAssignment = await db`
    select *
    from public.assign_published_program_version(
      ${ids.program}::uuid,
      ${ids.version}::uuid,
      array[${ids.athlete}::uuid],
      ${ids.assignmentKey}::uuid
    )
  `;
  assert.equal(firstAssignment.length, 1);
  assert.equal(firstAssignment[0].created, true);
  assert.equal(retriedAssignment[0].created, false);
  assert.equal(retriedAssignment[0].assignment_id, firstAssignment[0].assignment_id);
  const assignmentId = firstAssignment[0].assignment_id;

  await db`select set_config('request.jwt.claim.sub', ${ids.athlete}, true)`;
  const candidates = await db`select * from public.list_schedulable_workouts()`;
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].assignment_id, assignmentId);
  assert.equal(candidates[0].workout_id, ids.workout);

  const [firstSchedule] = await db`
    select public.create_scheduled_occurrence(
      ${ids.workout}::uuid,
      ${today}::date,
      ${ids.scheduleKey}::uuid,
      null,
      ${assignmentId}::uuid
    ) as payload
  `;
  const [retriedSchedule] = await db`
    select public.create_scheduled_occurrence(
      ${ids.workout}::uuid,
      ${today}::date,
      ${ids.scheduleKey}::uuid,
      null,
      ${assignmentId}::uuid
    ) as payload
  `;
  assert.equal(firstSchedule.payload.created, true);
  assert.equal(retriedSchedule.payload.created, false);
  assert.equal(retriedSchedule.payload.id, firstSchedule.payload.id);

  const [firstStart] = await db`
    select public.start_scheduled_workout(
      ${firstSchedule.payload.id}::uuid
    ) as session_id
  `;
  const [resumedStart] = await db`
    select public.start_scheduled_workout(
      ${firstSchedule.payload.id}::uuid
    ) as session_id
  `;
  assert.equal(resumedStart.session_id, firstStart.session_id);

  const [bootstrap] = await db`select public.get_workspace_bootstrap() as payload`;
  assert.equal(bootstrap.payload.activeSession.id, firstStart.session_id);
  assert.equal(bootstrap.payload.activeSession.draftRevision, 0);
  assert.equal(bootstrap.payload.activeSession.items.length, 1);
  assert.equal(Object.keys(bootstrap.payload.activeSession.itemLogIds).length, 1);

  const calendar = await db`
    select * from public.list_calendar_occurrences(${today}::date, ${today}::date)
  `;
  assert.equal(calendar.length, 1);
  assert.equal(calendar[0].id, firstSchedule.payload.id);
  assert.equal(calendar[0].status, "in_progress");

  await db`select set_config('request.jwt.claim.sub', ${ids.coach}, true)`;
  const coachAthletes = await db`select * from public.list_coach_athletes()`;
  assert.equal(coachAthletes.length, 1);
  assert.equal(coachAthletes[0].id, ids.athlete);
  assert.equal(Number(coachAthletes[0].assigned_program_count), 1);
  const [coachDetail] = await db`
    select public.get_coach_athlete_detail(${ids.athlete}::uuid) as payload
  `;
  assert.equal(coachDetail.payload.athlete.id, ids.athlete);
  assert.equal(coachDetail.payload.programs.length, 1);
  assert.equal(coachDetail.payload.upcoming[0].status, "in_progress");

  console.log("V1 performance database smoke passed; transaction will be rolled back.");
} finally {
  if (transactionOpen) {
    await db.unsafe("rollback").catch(() => {});
  }
  await db.end({ timeout: 2 });
}
