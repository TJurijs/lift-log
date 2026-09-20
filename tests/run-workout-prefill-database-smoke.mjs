import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { assertLoopbackPostgresUrl } from '../scripts/lib/local-database-verification.mjs';
import { migrationStatements } from '../scripts/lib/portable-migrations.mjs';

const databaseUrl = process.env.LIFTLOG_PREFILL_SMOKE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
assertLoopbackPostgresUrl(databaseUrl);
const db = postgres(databaseUrl, { max: 1, connect_timeout: 5, onnotice: () => {},
  connection: { statement_timeout: 15000, lock_timeout: 10000, application_name: 'liftlog-workout-prefill-smoke' } });
const migration = await readFile(new URL('../supabase/migrations/202609140001_prefill_workout_targets.sql', import.meta.url), 'utf8');
const owner = randomUUID();
const outsider = randomUUID();
let transactionOpen = false;

async function rejects(action, pattern) {
  await db.unsafe('savepoint expected_prefill_refusal');
  try { await assert.rejects(action, pattern); }
  finally {
    await db.unsafe('rollback to savepoint expected_prefill_refusal');
    await db.unsafe('release savepoint expected_prefill_refusal');
  }
}
async function dataHashes() {
  const result = {};
  for (const table of ['exercises', 'workout_items', 'prescribed_entries', 'workout_sessions', 'session_item_logs', 'session_entries']) {
    const [row] = await db.unsafe(`select count(*)::integer as count,
      md5(coalesce(string_agg(to_jsonb(row)::text, '' order by row.id), '')) as hash from public.${table} row`);
    result[table] = row;
  }
  return result;
}
async function sessionItems(sessionId) {
  return db`select item.id, item.snapshot_name, item.snapshot_cue, item.snapshot_video_links,
    coalesce(jsonb_agg(jsonb_build_object('position', entry.position,
      'reps', entry.reps, 'loadKg', entry.load_kg, 'durationSeconds', entry.duration_seconds,
      'distanceMetres', entry.distance_metres, 'rounds', entry.rounds, 'heartRate', entry.heart_rate, 'rpe', entry.rpe)
      order by entry.position) filter(where entry.id is not null), '[]'::jsonb) as entries
    from public.session_item_logs item left join public.session_entries entry on entry.session_item_log_id = item.id
    where item.workout_session_id = ${sessionId}::uuid group by item.id order by item.position`;
}
function draft(items, sessionNote = '') {
  return { recordingSchema: 2, sessionRpe: null, sessionNote, items: items.map((item) => ({ itemLogId: item.id, entries: item.entries })) };
}
const fixtures = [
  { name: 'Exact and ranged repetitions', mode: 'sets', fields: ['reps', 'load', 'rpe'], entries: [
    { reps_min: 8, reps_max: 8, load_kg: 40, target_rpe_min: 7, target_rpe_max: 8, target_text: 'Keep the sequence.' },
    { reps_min: 6, reps_max: 8, load_kg: 0 },
    { reps_min: 0, reps_max: 0, load_kg: 10 },
    { reps_min: 5.5, reps_max: 5.5 },
  ] },
  { name: 'Timed sets', mode: 'sets', fields: ['duration', 'distance', 'heartRate', 'rpe'], entries: [
    { duration_seconds: 30, distance_metres: 400, target_rpe_min: 8, target_rpe_max: 8 },
    { duration_seconds: 0, distance_metres: 0 }, {},
  ] },
  { name: 'Single result', mode: 'result', fields: ['duration', 'distance', 'load', 'heartRate', 'rpe'], entries: [
    { duration_seconds: 120, distance_metres: 1500, load_kg: 0, target_rpe_min: 9, target_rpe_max: 9 },
  ] },
  { name: 'Individual intervals', mode: 'intervals', fields: ['rounds', 'duration', 'distance', 'heartRate', 'rpe'], entries: [
    { rounds: 3, work_seconds: 20, duration_seconds: 60, distance_metres: 100, target_rpe_min: 7, target_rpe_max: 7 },
    { rounds: 3, work_seconds: 0, distance_metres: 0 },
    { rounds: 3, duration_seconds: 45, distance_metres: 200 },
  ] },
  { name: 'Legacy repeated intervals', mode: 'intervals', fields: ['rounds', 'duration', 'distance'], entries: [
    { rounds: 4, work_seconds: 30, duration_seconds: 120, distance_metres: 50 },
  ] },
  { name: 'Instructions', mode: 'none', fields: [], entries: [] },
  { name: 'Unspecified sets', mode: 'sets', fields: ['reps'], entries: [] },
];

try {
  await db.unsafe('begin'); transactionOpen = true;
  for (const id of [owner, outsider]) await db`insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
    values (${id}::uuid, ${`prefill-${id}@example.test`}, '{}'::jsonb, '{"given_name":"Prefill","family_name":"Smoke"}'::jsonb)`;
  await db`select set_config('request.jwt.claim.sub', ${owner}, true)`;
  await db`select set_config('request.jwt.claim.role', 'authenticated', true)`;
  await db.unsafe('set local role authenticated');
  const [program] = await db`select public.create_blank_program(${owner}::uuid, 'Prefilled completion smoke') as id`;
  const [week] = await db`select week.id from public.program_weeks week join public.program_versions version on version.id = week.program_version_id
    where version.program_id = ${program.id}::uuid and version.status = 'draft'`;
  const workouts = [];
  for (const title of ['Already started workout', 'Newly prefilled workout']) {
    const [workout] = await db`select public.append_program_workout(${week.id}::uuid, ${title}) as payload`;
    workouts.push(workout.payload);
    for (const fixture of fixtures) {
      const [exercise] = await db`insert into public.exercises (owner_id, scope, name, default_entry_mode, default_tracking_fields, video_links)
        values (${owner}::uuid, 'personal', ${`${title}: ${fixture.name}`}, ${fixture.mode}, ${fixture.fields}::text[],
          '[{"url":"https://example.test/front","label":"Front"},{"url":"https://example.test/side","label":"Side"}]'::jsonb) returning id`;
      const [item] = await db`select public.append_workout_exercise(${workout.payload.sections[0].id}::uuid, ${exercise.id}::uuid) as payload`;
      await db`select public.save_workout_item_prescription(${item.payload.id}::uuid, 'Follow the plan.', ${fixture.mode},
        ${fixture.fields}::text[], ${db.json(fixture.entries)}::jsonb)`;
      // Historic prescriptions may contain measurements that their item no
      // longer tracks. The new initializer must mask them before recording.
      if (fixture.name === 'Timed sets') await db`update public.prescribed_entries set reps_min = 12, reps_max = 12, load_kg = 50
        where workout_item_id = ${item.payload.id}::uuid and position = 0`;
    }
  }
  const [{ today }] = await db`select current_date::text as today`;
  const [run] = await db`select * from public.create_program_runs(${program.id}::uuid, ${[owner]}::uuid[],
    ${db.json(workouts.map((workout) => ({ workoutId: workout.id, plannedDate: today })))}::jsonb, ${randomUUID()}::uuid)`;
  const occurrences = await db`select id, workout_id from public.scheduled_workouts where program_run_id = ${run.run_id}::uuid`;
  const first = occurrences.find((row) => row.workout_id === workouts[0].id);
  const second = occurrences.find((row) => row.workout_id === workouts[1].id);
  await db`select set_config('request.jwt.claim.sub', ${outsider}, true)`;
  await rejects(() => db`select public.start_scheduled_workout(${first.id}::uuid)`, /Scheduled workout is invalid/);
  await db`select set_config('request.jwt.claim.sub', ${owner}, true)`;
  const [existing] = await db`select public.start_scheduled_workout(${first.id}::uuid) as id`;
  const initial = await sessionItems(existing.id);
  const edited = draft(initial, 'Preserve my existing edits.');
  edited.items[0].entries = [{ position: 0, reps: null, loadKg: 0, rpe: null }];
  edited.items[1].entries = [];
  edited.items[2].entries = [{ position: 0, durationSeconds: 0, distanceMetres: null, loadKg: null, heartRate: null, rpe: null }];
  await db`select public.save_workout_session_draft(${existing.id}::uuid, 0, ${randomUUID()}::uuid, ${db.json(edited)}::jsonb)`;
  const preservedExisting = await sessionItems(existing.id);

  await db.unsafe('reset role');
  const beforeMigration = await dataHashes();
  for (let replay = 0; replay < 2; replay++) for (const statement of migrationStatements(migration)) await db.unsafe(statement);
  assert.deepEqual(await dataHashes(), beforeMigration, 'Function migration must not rewrite any stored exercise, plan, actual or snapshot');
  await db.unsafe('set local role authenticated');
  assert.equal((await db`select public.start_scheduled_workout(${first.id}::uuid) as id`)[0].id, existing.id);
  assert.deepEqual(await sessionItems(existing.id), preservedExisting, 'Resume preserves cleared metrics, zeros and deleted rows');
  await db`select public.complete_workout_session_confirmed(${existing.id}::uuid, 1, ${randomUUID()}::uuid, null, ${edited.sessionNote})`;

  const [started] = await db`select public.start_scheduled_workout(${second.id}::uuid) as id`;
  const items = await sessionItems(started.id);
  assert.deepEqual(items[0].entries.map((entry) => entry.reps), [8, null, 0, null], 'Only exact whole repetition targets are prefilled');
  assert.deepEqual(items[0].entries.map((entry) => entry.loadKg), [40, 0, 10, null]);
  assert.deepEqual(items[1].entries.map((entry) => entry.durationSeconds), [30, 0, null]);
  assert.deepEqual(items[1].entries.map((entry) => entry.distanceMetres), [400, 0, null]);
  assert.ok(items[1].entries.every((entry) => entry.reps === null && entry.loadKg === null));
  assert.deepEqual(items[2].entries, [{ position: 0, reps: null, loadKg: 0, durationSeconds: 120, distanceMetres: 1500, rounds: null, heartRate: null, rpe: null }]);
  assert.deepEqual(items[3].entries.map((entry) => entry.durationSeconds), [20, 0, 45]);
  assert.deepEqual(items[3].entries.map((entry) => entry.rounds), [1, 1, 1]);
  assert.deepEqual(items[4].entries.map((entry) => entry.durationSeconds), [30, 30, 30, 30]);
  assert.deepEqual(items[4].entries.map((entry) => entry.distanceMetres), [50, 50, 50, 50]);
  assert.deepEqual(items[4].entries.map((entry) => entry.rounds), [1, 1, 1, 1]);
  assert.equal(items[5].entries.length, 0);
  assert.equal(items[6].entries.length, 1);
  assert.equal(items[6].entries[0].reps, null);
  assert.ok(items.every((item) => item.entries.every((entry) => entry.rpe === null && entry.heartRate === null)));
  assert.match(items[0].snapshot_cue, /Follow the plan\.\nKeep the sequence\./);
  assert.equal(items[0].snapshot_video_links.length, 2, 'Immutable media snapshots are retained');

  const remaining = draft(items, 'Only remaining work was completed.');
  remaining.items[0].entries = [];
  remaining.items[1].entries = [
    { position: 0, durationSeconds: null, distanceMetres: null },
    { position: 1, durationSeconds: 0, distanceMetres: 0 },
  ];
  remaining.items[3].entries[1] = { position: 1, rounds: 0, durationSeconds: null, distanceMetres: null, heartRate: null, rpe: null };
  const outdated = { ...remaining }; delete outdated.recordingSchema;
  await rejects(() => db`select public.save_workout_session_draft(${started.id}::uuid, 0, ${randomUUID()}::uuid, ${db.json(outdated)}::jsonb)`, /Refresh LiftLog/);
  const token = randomUUID();
  for (let retry = 0; retry < 2; retry++) await db`select public.save_workout_session_draft(${started.id}::uuid, 0, ${token}::uuid, ${db.json(remaining)}::jsonb)`;
  const saved = await sessionItems(started.id);
  await db`select public.start_scheduled_workout(${second.id}::uuid)`;
  assert.deepEqual(await sessionItems(started.id), saved);
  await db`select public.complete_workout_session_confirmed(${started.id}::uuid, 1, ${randomUUID()}::uuid, null, ${remaining.sessionNote})`;
  assert.deepEqual(await sessionItems(started.id), saved, 'Finish records the current draft without reconstructing removed sets or skipped work');
  assert.deepEqual(await sessionItems(existing.id), preservedExisting, 'Older completed history remains unchanged');
  assert.equal(saved[0].entries.length, 0);
  assert.deepEqual(saved[1].entries.map((entry) => entry.durationSeconds), [null, 0]);
  assert.equal(saved[3].entries[1].rounds, 0);
  await rejects(() => db`select public.start_scheduled_workout(${second.id}::uuid)`, /Completed workout cannot be started/);
  console.log('Workout prefill SQL smoke passed: exact objective targets; ranges/RPE/HR blank; tracked-field masking; zero and units; individual/legacy interval rounds; no historical rewrite; authorization; resume preserves clears and deleted sets; completion preserves remaining work; revision/old-client guards and idempotency; immutable notes/videos. Entire transaction rolled back.');
} finally {
  if (transactionOpen) await db.unsafe('rollback');
  await db.end({ timeout: 2 });
}
