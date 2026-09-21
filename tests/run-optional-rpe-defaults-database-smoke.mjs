import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { assertLoopbackPostgresUrl } from '../scripts/lib/local-database-verification.mjs';
import { migrationStatements } from '../scripts/lib/portable-migrations.mjs';

// Verify the forward migration and RPC defaults without committing catalog
// changes, user data, or migration history to the existing local database.
const databaseUrl = process.env.LIFTLOG_EXERCISE_SMOKE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
assertLoopbackPostgresUrl(databaseUrl);
const db = postgres(databaseUrl, { max: 1, connect_timeout: 5, onnotice: () => {},
  connection: { statement_timeout: 15000, lock_timeout: 10000, application_name: 'liftlog-optional-rpe-smoke' } });
const migration = await readFile(new URL('../supabase/migrations/202609210001_optional_rpe_defaults.sql', import.meta.url), 'utf8');
const owner = randomUUID();
let transactionOpen = false;

async function applyMigration() {
  for (const statement of migrationStatements(migration)) await db.unsafe(statement);
}

async function protectedSnapshot() {
  const result = {};
  for (const table of ['program_versions', 'workout_items', 'prescribed_entries', 'workout_sessions', 'session_item_logs', 'session_entries']) {
    const [row] = await db.unsafe(`select count(*)::integer as count,
      md5(coalesce(string_agg(to_jsonb(row)::text, '' order by row.id), '')) as hash
      from public.${table} row`);
    result[table] = row;
  }
  const [personal] = await db`select count(*)::integer as count,
    md5(coalesce(string_agg(to_jsonb(exercise)::text, '' order by exercise.id), '')) as hash
    from public.exercises exercise where exercise.scope = 'personal'`;
  result.personal = personal;
  return result;
}

async function globalDefaults() {
  return Array.from(await db`select id, name, default_entry_mode, default_tracking_fields
    from public.exercises where scope = 'global' and owner_id is null order by id`);
}

try {
  await db.unsafe('begin');
  transactionOpen = true;
  await db`insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
    values (${owner}::uuid, ${`rpe-default-${owner}@example.test`}, '{}'::jsonb,
      '{"given_name":"Optional","family_name":"RPE"}'::jsonb)`;
  const fixtures = [
    { mode: 'sets', fields: ['reps', 'load', 'rpe'], expected: ['reps', 'load'] },
    { mode: 'sets', fields: ['reps', 'rpe'], expected: ['reps'] },
    { mode: 'result', fields: ['duration', 'rpe'], expected: ['duration'] },
    { mode: 'result', fields: ['distance', 'duration', 'rpe'], expected: ['distance', 'duration'] },
    { mode: 'intervals', fields: ['rounds', 'duration', 'rpe'], expected: ['rounds', 'duration'] },
    { mode: 'none', fields: [], expected: [] },
  ];
  for (const [index, fixture] of fixtures.entries()) {
    const [row] = await db`insert into public.exercises (scope, name, default_entry_mode, default_tracking_fields)
      values ('global', ${`RPE fixture ${index} ${owner}`}, ${fixture.mode}, ${fixture.fields}::text[]) returning id`;
    fixture.id = row.id;
  }
  const [personal] = await db`insert into public.exercises
    (scope, owner_id, name, default_entry_mode, default_tracking_fields)
    values ('personal', ${owner}::uuid, 'Explicit personal RPE', 'sets', array['reps', 'load', 'rpe']) returning id`;
  await db`select set_config('request.jwt.claim.sub', ${owner}, true)`;
  await db`select set_config('request.jwt.claim.role', 'authenticated', true)`;
  await db.unsafe('set local role authenticated');
  const [program] = await db`select public.create_blank_program(${owner}::uuid, 'Optional RPE defaults smoke') as id`;
  const [week] = await db`select week.id from public.program_weeks week
    join public.program_versions version on version.id = week.program_version_id
    where version.program_id = ${program.id}::uuid and version.status = 'draft'`;
  const [workout] = await db`select public.append_program_workout(${week.id}::uuid, 'Keep existing tracking') as payload`;
  const section = workout.payload.sections[0].id;
  const [existing] = await db`select public.append_workout_exercise(${section}::uuid, ${fixtures[0].id}::uuid) as payload`;
  assert.deepEqual(existing.payload.trackingFields, ['reps', 'load', 'rpe']);
  await db`select public.save_workout_item_prescription(${existing.payload.id}::uuid, '', 'sets',
    array['reps', 'load', 'rpe'], '[{"reps_min":5,"reps_max":5,"load_kg":50,"target_rpe_min":7,"target_rpe_max":8}]'::jsonb)`;
  await db.unsafe('reset role');
  const before = await protectedSnapshot();
  const beforeDefaults = await globalDefaults();
  await applyMigration();
  assert.deepEqual(await protectedSnapshot(), before, 'Migration preserves personal defaults, all existing workouts and session history');
  assert.deepEqual(await globalDefaults(), beforeDefaults.map((exercise) => ({
    ...exercise, default_tracking_fields: exercise.default_tracking_fields.filter((field) => field !== 'rpe'),
  })), 'Only RPE is removed; movement-specific recording metrics and identities remain unchanged');
  const applied = await globalDefaults();
  await applyMigration();
  assert.deepEqual(await globalDefaults(), applied, 'Migration is idempotent');
  await db.unsafe('set local role authenticated');
  for (const fixture of fixtures) {
    const [added] = await db`select public.append_workout_exercise(${section}::uuid, ${fixture.id}::uuid) as payload`;
    assert.deepEqual(added.payload.trackingFields, fixture.expected);
    assert.equal(added.payload.entryMode, fixture.mode);
  }
  const [personalAdded] = await db`select public.append_workout_exercise(${section}::uuid, ${personal.id}::uuid) as payload`;
  assert.deepEqual(personalAdded.payload.trackingFields, ['reps', 'load', 'rpe'], 'Explicit personal tracking choices remain reusable');
  // RPE remains a supported opt-in field, including its prescription values.
  const [optional] = await db`select public.append_workout_exercise(${section}::uuid, ${fixtures[0].id}::uuid) as payload`;
  await db`select public.save_workout_item_prescription(${optional.payload.id}::uuid, '', 'sets',
    array['reps', 'load', 'rpe'], '[{"reps_min":5,"reps_max":5,"load_kg":50,"target_rpe_min":8,"target_rpe_max":8}]'::jsonb)`;
  const [saved] = await db`select item.tracking_fields, entry.target_rpe_min from public.workout_items item
    join public.prescribed_entries entry on entry.workout_item_id = item.id where item.id = ${optional.payload.id}::uuid`;
  assert.deepEqual(saved.tracking_fields, ['reps', 'load', 'rpe']);
  assert.equal(Number(saved.target_rpe_min), 8);
  console.log('Optional RPE defaults SQL smoke passed: reps/weight, bodyweight, timed, distance, interval and instructions defaults; explicit RPE opt-in; preserved personal preferences, existing workout prescriptions and session history; idempotent migration. Entire transaction rolled back.');
} finally {
  if (transactionOpen) await db.unsafe('rollback');
  await db.end({ timeout: 2 });
}
