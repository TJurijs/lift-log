import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { assertLoopbackPostgresUrl } from '../scripts/lib/local-database-verification.mjs';
import { applyTemplateUpdate, canonicalJson, inspectTemplateUpdate, readTemplateRows, templatePlanHash, validateTemplatePlan } from '../scripts/lib/future-template-update.mjs';

const planPath = process.argv.slice(2).find((argument) => argument.startsWith('--plan='))?.slice(7);
assert.ok(planPath, 'Supply the private reviewed --plan=path. This rehearsal only uses a rollback-only local fixture.');
const reviewed = JSON.parse(await readFile(planPath, 'utf8'));
validateTemplatePlan(reviewed);
const databaseUrl = process.env.LIFTLOG_TEMPLATE_REHEARSAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
assertLoopbackPostgresUrl(databaseUrl);
const db = postgres(databaseUrl, { max: 1, connect_timeout: 5, onnotice: () => {},
  connection: { statement_timeout: 15000, lock_timeout: 10000, application_name: 'liftlog-template-rollback-rehearsal' } });
const rowKey = (row) => `${row.workout_position}:${row.position}`;
const ownerId = randomUUID();
const exerciseIdMap = new Map(reviewed.exercises.map((exercise) => [exercise.id, randomUUID()]));
let transactionOpen = false;

async function rejects(action, pattern) {
  await db.unsafe('savepoint expected_template_refusal');
  try { await assert.rejects(action, pattern); }
  finally {
    await db.unsafe('rollback to savepoint expected_template_refusal');
    await db.unsafe('release savepoint expected_template_refusal');
  }
}

try {
  await db.unsafe('begin');
  transactionOpen = true;
  const [preexisting] = await db`select count(*)::integer as users from auth.users`;
  await db`insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
    values (${ownerId}::uuid, ${`complex-rehearsal-${ownerId}@example.test`}, '{}'::jsonb, '{"given_name":"Template","family_name":"Rehearsal"}'::jsonb)`;
  await db`select set_config('request.jwt.claim.sub', ${ownerId}, true)`;
  await db`select set_config('request.jwt.claim.role', 'authenticated', true)`;
  await db.unsafe('set local role authenticated');
  const [program] = await db`select public.create_blank_program(${ownerId}::uuid, 'Rollback complex template rehearsal') as id`;
  await db.unsafe('reset role');
  const [week] = await db`select week.id, week.program_version_id from public.program_weeks week join public.program_versions version on version.id = week.program_version_id
    where version.program_id = ${program.id}::uuid and version.status = 'draft'`;
  const catalog = await db`select id, name, scope, source_provider, source_external_id, source_url, video_url from public.exercises
    where scope = 'global' and source_provider = 'catalyst-athletics' and source_external_id in ('59', '67', '405') and archived_at is null`;
  assert.equal(catalog.length, 3);
  const sourceMap = new Map(reviewed.catalogVideos.map((video) => [video.id, catalog.find((candidate) => candidate.source_external_id === video.source_external_id).id]));
  const workoutMap = new Map();
  const sectionMap = new Map();
  for (const row of reviewed.beforeRows) {
    if (!workoutMap.has(row.workout_id)) {
      const [workout] = await db`insert into public.workouts (program_week_id, title, position)
        values (${week.id}::uuid, ${row.workout_title}, ${row.workout_position}) returning id`;
      workoutMap.set(row.workout_id, workout.id);
    }
    if (!sectionMap.has(row.section_id)) {
      const [section] = await db`insert into public.workout_sections (workout_id, title, position)
        values (${workoutMap.get(row.workout_id)}::uuid, 'Rehearsal section', 0) returning id`;
      sectionMap.set(row.section_id, section.id);
    }
    const [item] = await db`insert into public.workout_items (section_id, source_exercise_id, snapshot_name, snapshot_cue, entry_mode, tracking_fields, position)
      values (${sectionMap.get(row.section_id)}::uuid, ${sourceMap.get(row.source_exercise_id) ?? null}::uuid,
        ${row.snapshot_name}, ${row.snapshot_cue}, ${row.entry_mode}, ${row.tracking_fields}::text[], ${row.position}) returning id`;
    for (const entry of row.entries) {
      await db`insert into public.prescribed_entries (workout_item_id, position, reps_min, reps_max, load_kg, duration_seconds, distance_metres,
        rounds, work_seconds, rest_seconds, target_rpe_min, target_rpe_max, target_text)
        values (${item.id}::uuid, ${entry.position}, ${entry.reps_min}, ${entry.reps_max}, ${entry.load_kg}, ${entry.duration_seconds}, ${entry.distance_metres},
          ${entry.rounds}, ${entry.work_seconds}, ${entry.rest_seconds}, ${entry.target_rpe_min}, ${entry.target_rpe_max}, ${entry.target_text})`;
    }
  }
  await db.unsafe('set local role authenticated');
  const [{ today }] = await db`select current_date::text as today`;
  const dates = [...workoutMap.values()].map((workoutId) => ({ workoutId, plannedDate: today }));
  const [run] = await db`select * from public.create_program_runs(${program.id}::uuid, ${[ownerId]}::uuid[], ${db.json(dates)}::jsonb, ${randomUUID()}::uuid)`;
  const occurrences = await db`select id from public.scheduled_workouts where program_run_id = ${run.run_id}::uuid order by sequence_number`;
  const [completed] = await db`select public.start_scheduled_workout(${occurrences[0].id}::uuid) as id`;
  const sessionItems = await db`select id from public.session_item_logs where workout_session_id = ${completed.id}::uuid order by position`;
  const blank = { recordingSchema: 2, sessionRpe: null, sessionNote: '', items: sessionItems.map((item) => ({ itemLogId: item.id, entries: [] })) };
  await db`select public.save_workout_session_draft(${completed.id}::uuid, 0, ${randomUUID()}::uuid, ${db.json(blank)}::jsonb)`;
  await db`select public.complete_workout_session_confirmed(${completed.id}::uuid, 1, ${randomUUID()}::uuid, null, '')`;
  await db`select public.start_scheduled_workout(${occurrences[1].id}::uuid)`;
  await db.unsafe('reset role');

  const [draft] = await db`select id, version_number from public.program_versions where program_id = ${program.id}::uuid and status = 'draft'`;
  const beforeRows = await readTemplateRows(db, draft.id);
  assert.equal(beforeRows.length, reviewed.beforeRows.length);
  const afterRows = reviewed.afterRows.map((expected) => {
    const original = reviewed.beforeRows.find((row) => row.item_id === expected.item_id);
    const actual = beforeRows.find((row) => rowKey(row) === rowKey(original));
    assert.ok(actual);
    return { ...actual, snapshot_name: expected.snapshot_name, snapshot_cue: expected.snapshot_cue, entry_mode: expected.entry_mode,
      tracking_fields: expected.tracking_fields, position: expected.position,
      source_exercise_id: exerciseIdMap.get(expected.source_exercise_id) ?? actual.source_exercise_id,
      entries: expected.entries.map((entry) => {
        const current = actual.entries.find((candidate) => candidate.position === entry.position);
        return { ...entry, id: current.id, workout_item_id: actual.item_id, created_at: current.created_at };
      }) };
  });
  const plan = { ...reviewed, programId: program.id, programTitle: 'Rollback complex template rehearsal', versionId: draft.id,
    versionNumber: draft.version_number, ownerId, beforeRows, afterRows, catalogVideos: catalog,
    exercises: reviewed.exercises.map((exercise) => ({ ...exercise, id: exerciseIdMap.get(exercise.id), owner_id: ownerId })) };
  assert.equal((await inspectTemplateUpdate(db, plan)).state, 'ready');
  await rejects(async () => {
    await db`update public.workout_items set snapshot_cue = snapshot_cue || ' concurrent user edit' where id = ${beforeRows[0].item_id}::uuid`;
    await applyTemplateUpdate(db, plan);
  }, /changed since the reviewed plan/);
  await rejects(async () => {
    await db`insert into public.scheduled_workouts (athlete_id, program_version_id, workout_id, sequence_number)
      values (${ownerId}::uuid, ${draft.id}::uuid, ${beforeRows[0].workout_id}::uuid, 99)`;
    await applyTemplateUpdate(db, plan);
  }, /Scheduled workout must belong to immutable athlete content|already used for schedules/);
  await rejects(() => applyTemplateUpdate(db, { ...plan, versionId: week.program_version_id, versionNumber: 1 }), /Only the reviewed unpublished draft/);
  await rejects(async () => {
    const expected = plan.exercises[0];
    await db`insert into public.exercises (owner_id, scope, name, default_entry_mode, default_tracking_fields)
      values (${ownerId}::uuid, 'personal', ${expected.name}, 'sets', array['reps'])`;
    await applyTemplateUpdate(db, plan);
  }, /differs from the reviewed definition/);

  const result = await applyTemplateUpdate(db, plan);
  assert.equal(result.state, 'applied');
  assert.equal((await applyTemplateUpdate(db, plan)).state, 'already-applied');
  assert.equal(canonicalJson(await readTemplateRows(db, draft.id)), canonicalJson(afterRows));
  const [history] = await db`select count(*)::integer as schedules,
    (select count(*)::integer from public.workout_sessions where program_version_id = ${week.program_version_id}::uuid) as sessions
    from public.scheduled_workouts where program_version_id = ${week.program_version_id}::uuid`;
  assert.deepEqual(history, { schedules: 3, sessions: 2 });

  // Prove future scheduling consumes the updated draft automatically. Existing
  // run contents remain tied to their earlier immutable version.
  await db.unsafe('set local role authenticated');
  const futureDates = [...new Set(afterRows.map((row) => row.workout_id))].map((workoutId) => ({ workoutId, plannedDate: today }));
  const [future] = await db`select * from public.create_program_runs(${program.id}::uuid, ${[ownerId]}::uuid[], ${db.json(futureDates)}::jsonb, ${randomUUID()}::uuid)`;
  assert.equal(future.program_version_id, draft.id);
  await db.unsafe('reset role');
  assert.equal(canonicalJson(await readTemplateRows(db, future.program_version_id)), canonicalJson(afterRows));
  assert.equal((await readTemplateRows(db, week.program_version_id)).length, reviewed.beforeRows.length);
  await db.unsafe('rollback'); transactionOpen = false;
  const [after] = await db`select count(*)::integer as users from auth.users`;
  assert.deepEqual(after, preexisting);
  console.log(JSON.stringify({ passed: true, rolledBack: true, reviewedPlanSha: templatePlanHash(reviewed),
    beforeItems: beforeRows.length, afterItems: afterRows.length,
    checks: ['exact reviewed row transformation', 'two labeled videos per personal complex', 'original surviving entry IDs',
      'concurrent draft drift refusal', 'scheduled draft refusal', 'conflicting personal exercise refusal', 'idempotent repeat',
      'published/active/completed preservation', 'new runs automatically consume updated draft', 'all fixtures rolled back'] }, null, 2));
} finally {
  if (transactionOpen) await db.unsafe('rollback');
  await db.end({ timeout: 2 });
}
