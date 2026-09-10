import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { assertLoopbackPostgresUrl } from '../scripts/lib/local-database-verification.mjs';
import { migrationStatements } from '../scripts/lib/portable-migrations.mjs';

// Both pending SQL definitions and fixtures are tested in one rolled-back
// transaction. No migration history, catalog edit or test data is committed.
const databaseUrl = process.env.LIFTLOG_EXERCISE_SMOKE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
assertLoopbackPostgresUrl(databaseUrl);
const db = postgres(databaseUrl, { max: 1, connect_timeout: 5, onnotice: () => {},
  connection: { statement_timeout: 15000, lock_timeout: 10000, application_name: 'liftlog-exercise-recording-smoke' } });
const root = new URL('../', import.meta.url);
const registry = JSON.parse(await readFile(new URL('supabase/exercise-defaults/2026-09-10.json', root), 'utf8'));
const recordingSql = await readFile(new URL('supabase/migrations/202609100001_explicit_workout_recording.sql', root), 'utf8');
const catalogSql = await readFile(new URL('supabase/migrations/202609100002_reviewed_exercise_catalog_defaults.sql', root), 'utf8');
const instructionsSql = await readFile(new URL('supabase/migrations/202609100003_preserve_session_exercise_instructions.sql', root), 'utf8');
const extendedSetGuardSql = await readFile(new URL('supabase/migrations/202609100005_guard_extended_set_drafts.sql', root), 'utf8');
const owner = randomUUID();
let transactionOpen = false;

async function executeMigration(source) {
  for (const statement of migrationStatements(source)) await db.unsafe(statement);
}
async function rejects(query, pattern) {
  await db.unsafe('savepoint rejected_mutation');
  try { await assert.rejects(query, pattern); }
  finally {
    await db.unsafe('rollback to savepoint rejected_mutation');
    await db.unsafe('release savepoint rejected_mutation');
  }
}
async function snapshot() {
  const result = {};
  // Fixed internal table names only; values are hashes, never personal data.
  for (const table of ['program_versions', 'workout_items', 'prescribed_entries', 'workout_sessions', 'session_item_logs', 'session_entries']) {
    const [row] = await db.unsafe(`select count(*)::integer as count,
      md5(coalesce(string_agg(to_jsonb(row)::text, '' order by row.id), '')) as hash
      from public.${table} row`);
    result[table] = row;
  }
  const [untargeted] = await db`select count(*)::integer as count,
    md5(coalesce(string_agg(to_jsonb(exercise)::text, '' order by exercise.id), '')) as hash
    from public.exercises exercise where exercise.scope <> 'global'
      or exercise.source_provider is distinct from 'catalyst-athletics'
      or not (exercise.source_external_id = any(${registry.overrides.map((entry) => entry.sourceExternalId)}::text[]))`;
  result.untargetedExercises = untargeted;
  return result;
}
async function actuals(sessionId) {
  return db`select entry.* from public.session_entries entry
    join public.session_item_logs item on item.id = entry.session_item_log_id
    where item.workout_session_id = ${sessionId}::uuid order by item.position, entry.position`;
}
function allBlank(rows) {
  for (const row of rows) {
    for (const field of ['reps', 'load_kg', 'duration_seconds', 'distance_metres', 'rounds', 'heart_rate', 'rpe']) {
      assert.equal(row[field], null, `${field} should start and remain unrecorded`);
    }
  }
}

try {
  await db.unsafe('begin');
  transactionOpen = true;
  const before = await snapshot();
  await executeMigration(recordingSql);
  await executeMigration(catalogSql);
  await executeMigration(instructionsSql);
  await executeMigration(extendedSetGuardSql);
  await executeMigration(extendedSetGuardSql);
  assert.deepEqual(await snapshot(), before, 'Migrations must preserve all existing snapshots and untargeted exercises');
  for (const reviewed of registry.overrides) {
    const [exercise] = await db`select name, default_entry_mode, default_tracking_fields
      from public.exercises where scope = 'global' and owner_id is null
        and source_provider = ${reviewed.sourceProvider} and source_external_id = ${reviewed.sourceExternalId}`;
    assert.equal(exercise.name, reviewed.name);
    assert.equal(exercise.default_entry_mode, reviewed.recommended.mode);
    assert.deepEqual(exercise.default_tracking_fields, reviewed.recommended.fields);
  }
  // Replay is idempotent; a changed reviewed identity aborts rather than
  // silently selecting a same-name movement or overwriting an edited default.
  await db.unsafe('drop table reviewed_exercise_defaults');
  await executeMigration(catalogSql);
  await db.unsafe('drop table reviewed_exercise_defaults');
  const first = registry.overrides[0];
  await db.unsafe('savepoint catalog_identity_guard');
  await db`update public.exercises set name = name || ' changed'
    where scope = 'global' and source_provider = ${first.sourceProvider}
      and source_external_id = ${first.sourceExternalId}`;
  await assert.rejects(() => executeMigration(catalogSql), /unexpected identity or fields/);
  await db.unsafe('rollback to savepoint catalog_identity_guard');
  await db.unsafe('release savepoint catalog_identity_guard');

  await db`insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
    values (${owner}::uuid, ${`recording-${owner}@example.test`}, '{}'::jsonb,
      '{"given_name":"Recording","family_name":"Smoke"}'::jsonb)`;
  await db`select set_config('request.jwt.claim.sub', ${owner}, true)`;
  await db`select set_config('request.jwt.claim.role', 'authenticated', true)`;
  await db.unsafe('set local role authenticated');
  const [program] = await db`select public.create_blank_program(${owner}::uuid, 'Explicit recording smoke') as id`;
  const [week] = await db`select week.id from public.program_weeks week
    join public.program_versions version on version.id = week.program_version_id
    where version.program_id = ${program.id}::uuid and version.status = 'draft'`;
  const [firstWorkout] = await db`select public.append_program_workout(${week.id}::uuid, 'Timed and repetition sets') as payload`;
  const [secondWorkout] = await db`select public.append_program_workout(${week.id}::uuid, 'Finish without measurements') as payload`;
  const [legacyWorkout] = await db`select public.append_program_workout(${week.id}::uuid, 'Legacy repetition sets and intervals') as payload`;
  const section = firstWorkout.payload.sections[0].id;
  const fixtures = [
    { mode: 'sets', fields: ['reps', 'load', 'rpe'], rows: 3 },
    { mode: 'sets', fields: ['duration', 'distance', 'heartRate'], rows: 1 },
    { mode: 'result', fields: ['duration'], rows: 1 },
    { mode: 'result', fields: ['distance'], rows: 1 },
    { mode: 'intervals', fields: ['rounds', 'duration', 'distance'], rows: 1 },
    { mode: 'none', fields: [], rows: 0 },
  ];
  const added = [];
  for (const [index, fixture] of fixtures.entries()) {
    const [exercise] = await db`insert into public.exercises
      (scope, owner_id, name, default_entry_mode, default_tracking_fields)
      values ('personal', ${owner}::uuid, ${`Recording fixture ${index}`}, ${fixture.mode}, ${fixture.fields}::text[])
      returning id`;
    const [item] = await db`select public.append_workout_exercise(${section}::uuid, ${exercise.id}::uuid) as payload`;
    added.push({ ...fixture, ...item.payload, exerciseId: exercise.id });
    assert.equal(item.payload.prescribedEntries.length, fixture.rows);
    for (const entry of item.payload.prescribedEntries) {
      for (const [key, value] of Object.entries(entry)) {
        if (key !== 'id' && key !== 'position') assert.equal(value, null, `No arbitrary ${key} target`);
      }
    }
  }
  const saveTargets = (item, entries, fields = item.fields, mode = item.mode) =>
    db`select public.save_workout_item_prescription(${item.id}::uuid, '', ${mode}, ${fields}::text[], ${db.json(entries)}::jsonb)`;
  await saveTargets(added[0], Array.from({ length: 3 }, () => ({ reps_min: 8, reps_max: 8, load_kg: 40, target_rpe_min: 7, target_rpe_max: 8, target_text: '2 power cleans + 1 push jerk' })));
  await db`update public.workout_items set snapshot_cue = 'Keep the bar close.' where id = ${added[0].id}::uuid`;
  await saveTargets(added[1], [
    { duration_seconds: 20, distance_metres: 10, target_text: 'Easy first set' },
    { duration_seconds: 30, target_text: 'Moderate second set' },
    { duration_seconds: 45, target_text: 'Controlled final set' },
  ]);
  await saveTargets(added[2], [{ duration_seconds: 30, target_text: '  Breathe steadily.  ' }]);
  await db`update public.workout_items set snapshot_cue = 'Breathe steadily.' where id = ${added[2].id}::uuid`;
  await saveTargets(added[3], [{ distance_metres: 100, target_text: 'Legacy target-only instructions' }]);
  await saveTargets(added[4], Array.from({ length: 3 }, (_, index) => ({ rounds: 3, work_seconds: 20, rest_seconds: 10, duration_seconds: 60, distance_metres: 100, target_text: index === 1 ? 'Build the pace' : 'Easy pace' })));
  await rejects(() => saveTargets(added[1], [{ reps_min: 8 }]), /does not track/);
  await rejects(() => saveTargets(added[1], [{ duration_seconds: 0.5 }]), /whole numbers/);
  await rejects(() => saveTargets(added[1], [{ duration_seconds: '30' }]), /JSON numbers/);
  await rejects(() => saveTargets(added[0], [{ reps_min: 9, reps_max: 2 }]), /minimum cannot exceed/);
  await rejects(() => saveTargets(added[1], [{}], ['duration', 'duration']), /Invalid tracking/);
  await rejects(() => saveTargets(added[1], [{}], []), /Invalid tracking/);
  await rejects(() => saveTargets(added[2], [{}, {}]), /entry count/);
  await db`select public.append_workout_exercise(${secondWorkout.payload.sections[0].id}::uuid, ${added[1].exerciseId}::uuid)`;
  for (const item of [added[0], added[4]]) {
    await db`select public.append_workout_exercise(${legacyWorkout.payload.sections[0].id}::uuid, ${item.exerciseId}::uuid)`;
  }

  const [{ today, tomorrow }] = await db`select current_date::text as today, (current_date + 1)::text as tomorrow`;
  const dates = [{ workoutId: firstWorkout.payload.id, plannedDate: today }, { workoutId: secondWorkout.payload.id, plannedDate: tomorrow }, { workoutId: legacyWorkout.payload.id, plannedDate: tomorrow }];
  const [run] = await db`select * from public.create_program_runs(${program.id}::uuid, ${[owner]}::uuid[], ${db.json(dates)}::jsonb, ${randomUUID()}::uuid)`;
  const occurrences = await db`select id, workout_id from public.scheduled_workouts where program_run_id = ${run.run_id}::uuid`;
  const firstOccurrence = occurrences.find((row) => row.workout_id === firstWorkout.payload.id);
  const secondOccurrence = occurrences.find((row) => row.workout_id === secondWorkout.payload.id);
  const [started] = await db`select public.start_scheduled_workout(${firstOccurrence.id}::uuid) as id`;
  const sessionId = started.id;
  const logs = await db`select id, source_workout_item_id, entry_mode, snapshot_cue from public.session_item_logs
    where workout_session_id = ${sessionId}::uuid order by position`;
  assert.deepEqual(logs.map((item) => item.snapshot_cue), [
    'Keep the bar close.\n2 power cleans + 1 push jerk',
    'Set 1: Easy first set\nSet 2: Moderate second set\nSet 3: Controlled final set',
    'Breathe steadily.',
    'Legacy target-only instructions',
    'Round 1: Easy pace\nRound 2: Build the pace\nRound 3: Easy pace',
    '',
  ], 'Future session snapshots preserve both note sources, dedupe repeated notes and label varying sets/rounds');
  const seeded = await actuals(sessionId);
  assert.equal(seeded.length, 9, '3 repetition + 3 timed + result + distance + interval summary');
  allBlank(seeded);
  const payload = { recordingSchema: 2, sessionRpe: null, sessionNote: 'Note edit only', items: logs.map((item) => ({
    itemLogId: item.id, entries: seeded.filter((entry) => entry.session_item_log_id === item.id).map((entry) => ({ position: entry.position })),
  })) };
  await rejects(() => db`select public.complete_workout_session_confirmed(${sessionId}::uuid, 0, ${randomUUID()}::uuid, null, '')`, /revision must be one/);
  const outdatedPayload = structuredClone(payload);
  delete outdatedPayload.recordingSchema;
  await rejects(() => db`select public.save_workout_session_draft(${sessionId}::uuid, 0, ${randomUUID()}::uuid, ${db.json(outdatedPayload)}::jsonb)`, /Refresh LiftLog/);
  const [saved] = await db`select public.save_workout_session_draft(${sessionId}::uuid, 0, ${randomUUID()}::uuid, ${db.json(payload)}::jsonb) as receipt`;
  assert.equal(saved.receipt.revision, 1);
  allBlank(await actuals(sessionId));

  const timedIndex = logs.findIndex((item) => item.source_workout_item_id === added[1].id);
  const invalid = structuredClone(payload);
  invalid.items[timedIndex].entries[0].reps = 8;
  await rejects(() => db`select public.save_workout_session_draft(${sessionId}::uuid, 1, ${randomUUID()}::uuid, ${db.json(invalid)}::jsonb)`, /does not track/);
  payload.items[timedIndex].entries = [
    { position: 0, durationSeconds: 30, distanceMetres: 10, heartRate: 110 },
    { position: 1, durationSeconds: 0, distanceMetres: 0, heartRate: null },
    { position: 2, durationSeconds: null, distanceMetres: null, heartRate: null },
  ];
  // Explicit confirmation sends measurements through the same revisioned API.
  payload.items[0].entries[0] = { position: 0, reps: 8, loadKg: 40, rpe: 7 };
  payload.items[4].entries[0] = { position: 0, rounds: 3, durationSeconds: 60, distanceMetres: 100 };
  const measurementToken = randomUUID();
  for (let retry = 0; retry < 2; retry++) {
    const [receipt] = await db`select public.save_workout_session_draft(${sessionId}::uuid, 1, ${measurementToken}::uuid, ${db.json(payload)}::jsonb) as value`;
    assert.equal(receipt.value.revision, 2, 'Capability marker preserves idempotent draft retries');
  }
  const beforeStaleSave = await actuals(sessionId);
  const clearPayload = structuredClone(payload);
  clearPayload.items[timedIndex].entries = payload.items[timedIndex].entries.map(({ position }) =>
    ({ position, durationSeconds: null, distanceMetres: null, heartRate: null }));
  const staleClear = structuredClone(clearPayload);
  delete staleClear.recordingSchema;
  await rejects(() => db`select public.save_workout_session_draft(${sessionId}::uuid, 2, ${randomUUID()}::uuid, ${db.json(staleClear)}::jsonb)`, /Refresh LiftLog/);
  assert.deepEqual(await actuals(sessionId), beforeStaleSave, 'Old clients cannot erase measurements they cannot display');
  const [unchangedRevision] = await db`select draft_revision from public.workout_sessions where id = ${sessionId}::uuid`;
  assert.equal(Number(unchangedRevision.draft_revision), 2);
  await rejects(() => db`select public.save_workout_session_draft(${sessionId}::uuid, 2, ${randomUUID()}::uuid, ${db.json({ ...clearPayload, recordingSchema: '2' })}::jsonb)`, /Refresh LiftLog/);
  await db.unsafe('savepoint intentional_measurement_clear');
  await db`select public.save_workout_session_draft(${sessionId}::uuid, 2, ${randomUUID()}::uuid, ${db.json(clearPayload)}::jsonb)`;
  allBlank((await actuals(sessionId)).filter((row) => row.session_item_log_id === logs[timedIndex].id));
  await db.unsafe('rollback to savepoint intentional_measurement_clear');
  await db.unsafe('release savepoint intentional_measurement_clear');
  const [resumed] = await db`select public.start_scheduled_workout(${firstOccurrence.id}::uuid) as id`;
  assert.equal(resumed.id, sessionId);
  const resumedNotes = await db`select snapshot_cue from public.session_item_logs where workout_session_id = ${sessionId}::uuid order by position`;
  assert.deepEqual(resumedNotes.map((item) => item.snapshot_cue), logs.map((item) => item.snapshot_cue));
  const timedResults = (await actuals(sessionId)).filter((row) => row.session_item_log_id === logs[timedIndex].id);
  assert.deepEqual(timedResults.map((row) => row.duration_seconds), [30, 0, null]);
  assert.deepEqual(timedResults.map((row) => row.heart_rate), [110, null, null]);
  const completionToken = randomUUID();
  for (let retry = 0; retry < 2; retry++) {
    const [completed] = await db`select public.complete_workout_session_confirmed(${sessionId}::uuid, 2, ${completionToken}::uuid, null, 'Note edit only') as id`;
    assert.equal(completed.id, sessionId);
  }
  const [completedMetadata] = await db`select status, session_rpe from public.workout_sessions where id = ${sessionId}::uuid`;
  assert.equal(completedMetadata.status, 'completed');
  assert.equal(completedMetadata.session_rpe, null);

  const [blankStarted] = await db`select public.start_scheduled_workout(${secondOccurrence.id}::uuid) as id`;
  const [blankLog] = await db`select id from public.session_item_logs where workout_session_id = ${blankStarted.id}::uuid`;
  const blankPayload = { recordingSchema: 2, sessionRpe: null, sessionNote: '', items: [{ itemLogId: blankLog.id, entries: [{ position: 0 }] }] };
  await db`select public.save_workout_session_draft(${blankStarted.id}::uuid, 0, ${randomUUID()}::uuid, ${db.json(blankPayload)}::jsonb)`;
  await db`select public.complete_workout_session_confirmed(${blankStarted.id}::uuid, 1, ${randomUUID()}::uuid, null, '')`;
  allBlank(await actuals(blankStarted.id));
  const legacyOccurrence = occurrences.find((row) => row.workout_id === legacyWorkout.payload.id);
  const [legacyStarted] = await db`select public.start_scheduled_workout(${legacyOccurrence.id}::uuid) as id`;
  const legacyLogs = await db`select id, entry_mode from public.session_item_logs where workout_session_id = ${legacyStarted.id}::uuid order by position`;
  const legacyPayload = { sessionRpe: null, sessionNote: '', items: legacyLogs.map((item) => ({ itemLogId: item.id,
    entries: item.entry_mode === 'sets' ? [{ position: 0, reps: 8, loadKg: 40, rpe: 7 }] :
      [{ position: 0, rounds: 1, durationSeconds: 20, distanceMetres: 100 }, { position: 1, rounds: 1, durationSeconds: 20, distanceMetres: 100 }],
  })) };
  await db`select public.save_workout_session_draft(${legacyStarted.id}::uuid, 0, ${randomUUID()}::uuid, ${db.json(legacyPayload)}::jsonb)`;
  const legacyActuals = await actuals(legacyStarted.id);
  assert.equal(Number(legacyActuals[0].reps), 8, 'Old repetition-set clients remain supported without a marker');
  assert.deepEqual(legacyActuals.slice(1).map((entry) => entry.duration_seconds), [20, 20], 'Old interval clients still preserve individual rounds');
  console.log('Exercise recording SQL smoke passed: 84 portable guarded corrections; preserved existing snapshots; combined and deduplicated future instructions with varying set/round labels; blank targets and actuals; timed/distance sets; note-only save; metric validation; explicit values and zero/null round trips; confirmed blank completion; idempotent resume/completion; stale clients cannot erase extended set measurements; new-client clears and legacy repetition/interval drafts remain supported. Entire transaction rolled back.');
} finally {
  if (transactionOpen) await db.unsafe('rollback');
  await db.end({ timeout: 2 });
}
