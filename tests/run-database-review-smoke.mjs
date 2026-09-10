import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { assertLoopbackPostgresUrl } from '../scripts/lib/local-database-verification.mjs';

const databaseUrl = process.env.LIFTLOG_REVIEW_SMOKE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
assertLoopbackPostgresUrl(databaseUrl);
const options = { max: 1, connect_timeout: 5, onnotice: () => {},
  connection: { statement_timeout: 15000, lock_timeout: 10000, application_name: 'liftlog-review-smoke' } };
const db = postgres(databaseUrl, options);
const writer = postgres(databaseUrl, options);
const publisher = postgres(databaseUrl, options);
const owner = randomUUID();
const namespace = `review-${randomUUID()}-v1`;
let fixtureCreated = false;

async function authenticate(connection) {
  await connection`select set_config('request.jwt.claim.sub', ${owner}, true)`;
  await connection`select set_config('request.jwt.claim.role', 'authenticated', true)`;
  await connection.unsafe('set local role authenticated');
}
const authenticated = (work) => db.begin(async (tx) => { await authenticate(tx); return work(tx); });
async function assertWaiting(blockedPid, blockerPid) {
  const deadline = Date.now() + 5000;
  do {
    const [row] = await db`select ${blockerPid}::integer = any(pg_blocking_pids(${blockedPid}::integer)) as blocked`;
    if (row.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  } while (Date.now() < deadline);
  assert.fail('Expected the version lock to block the concurrent operation');
}
async function draftProgram(title, quick = false) {
  return authenticated(async (tx) => {
    const [program] = quick
      ? await tx`select public.create_blank_quick_workout(${title}) as id`
      : await tx`select public.create_blank_program(${owner}::uuid, ${title}) as id`;
    const [week] = await tx`select week.id, week.program_version_id from public.program_weeks week
      join public.program_versions version on version.id = week.program_version_id
      where version.program_id = ${program.id}::uuid and version.status = 'draft'`;
    const workouts = quick
      ? await tx`select id from public.workouts where program_week_id = ${week.id}::uuid`
      : await tx`select (public.append_program_workout(${week.id}::uuid, 'First workout')->>'id')::uuid as id`;
    return { id: program.id, versionId: week.program_version_id, weekId: week.id, workoutId: workouts[0].id };
  });
}

try {
  await db.begin(async (tx) => {
    await tx`insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
      values (${owner}::uuid, ${`${namespace}@example.test`}, '{}'::jsonb,
        '{"given_name":"Database","family_name":"Review"}'::jsonb)`;
    await tx`select set_config('request.jwt.claim.role', 'service_role', true)`;
    await tx`update public.profiles set account_kind = 'test', test_persona_key = ${`${namespace}:owner`}
      where id = ${owner}::uuid`;
  });
  fixtureCreated = true;

  // Both content types must duplicate while unused and after a run creates a
  // successor draft. The copy receives fresh IDs and may be edited independently.
  for (const quick of [false, true]) {
    const source = await draftProgram(quick ? 'Unused quick workout' : 'Unused program', quick);
    for (const used of [false, true]) {
      if (used) await authenticated((tx) => tx`select * from public.create_program_runs(
        ${source.id}::uuid, ${[owner]}::uuid[], '[]'::jsonb, ${randomUUID()}::uuid)`);
      const [copy] = await authenticated((tx) => tx`select public.copy_program_to_own(${source.id}::uuid) as id`);
      assert.notEqual(copy.id, source.id);
      const copiedRows = await authenticated((tx) => tx`select version.status, version.based_on_version_id,
        program.title, program.content_type, workout.id, workout.title as workout_title
        from public.programs program join public.program_versions version on version.program_id = program.id
        join public.program_weeks week on week.program_version_id = version.id
        join public.workouts workout on workout.program_week_id = week.id where program.id = ${copy.id}::uuid`);
      assert.equal(copiedRows.length, 1);
      assert.equal(copiedRows[0].status, 'draft');
      assert.equal(copiedRows[0].based_on_version_id, null);
      assert.equal(copiedRows[0].title, `${quick ? 'Unused quick workout' : 'Unused program'} copy`);
      assert.notEqual(copiedRows[0].id, source.workoutId);
      await authenticated((tx) => tx`update public.workouts set title = 'Independent copy edit' where id = ${copiedRows[0].id}::uuid`);
      const [original] = await authenticated((tx) => tx`select title from public.workouts where id = ${source.workoutId}::uuid`);
      assert.notEqual(original.title, 'Independent copy edit');
    }
  }

  const ordered = await draftProgram('Ordered calendar program');
  const [second] = await authenticated((tx) => tx`select (public.append_program_workout(${ordered.weekId}::uuid, 'Second workout')->>'id')::uuid as id`);
  const dates = [
    { workoutId: ordered.workoutId, plannedDate: '2026-09-08' },
    { workoutId: second.id, plannedDate: '2026-09-09' },
  ];
  const [run] = await authenticated((tx) => tx`select * from public.create_program_runs(
    ${ordered.id}::uuid, ${[owner]}::uuid[], ${tx.json(dates)}::jsonb, ${randomUUID()}::uuid)`);
  const [occurrence] = await authenticated((tx) => tx`select id from public.scheduled_workouts
    where program_run_id = ${run.run_id}::uuid and workout_id = ${ordered.workoutId}::uuid`);
  await assert.rejects(authenticated((tx) => tx`select public.schedule_workout(${occurrence.id}::uuid, '2026-09-10'::date)`), /Workout dates must follow program order/);
  const [unchanged] = await authenticated((tx) => tx`select planned_date::text from public.scheduled_workouts where id = ${occurrence.id}::uuid`);
  assert.equal(unchanged.planned_date, '2026-09-08');
  await authenticated((tx) => tx`select public.schedule_workout(${occurrence.id}::uuid, '2026-09-07'::date)`);
  const [moved] = await authenticated((tx) => tx`select slot.planned_date::text from public.program_run_workouts slot
    where slot.scheduled_workout_id = ${occurrence.id}::uuid`);
  assert.equal(moved.planned_date, '2026-09-07');

  const concurrent = await draftProgram('Concurrent publication');
  await writer.unsafe('begin');
  await authenticate(writer);
  const [{ pid: writerPid }] = await writer`select pg_backend_pid() as pid`;
  await writer`update public.workouts set title = 'Edit committed before snapshot' where id = ${concurrent.workoutId}::uuid`;
  await publisher.unsafe('begin');
  await authenticate(publisher);
  const [{ pid: publisherPid }] = await publisher`select pg_backend_pid() as pid`;
  const publishing = publisher`select * from public.create_program_runs(
    ${concurrent.id}::uuid, ${[owner]}::uuid[], '[]'::jsonb, ${randomUUID()}::uuid)`.execute();
  // Attach immediately so failure cannot become an unhandled rejection while
  // the monitor checks actual PostgreSQL blockers instead of relying on sleeps.
  const publishingResult = publishing.then((rows) => ({ rows }), (error) => ({ error }));
  await assertWaiting(publisherPid, writerPid);
  await writer.unsafe('commit');
  const firstPublication = await publishingResult;
  if (firstPublication.error) throw firstPublication.error;
  await publisher.unsafe('commit');
  const titles = await authenticated((tx) => tx`select workout.title, version.status from public.workouts workout
    join public.program_weeks week on week.id = workout.program_week_id
    join public.program_versions version on version.id = week.program_version_id
    where version.program_id = ${concurrent.id}::uuid`);
  assert.equal(titles.length, 2);
  assert.ok(titles.every((row) => row.title === 'Edit committed before snapshot'));

  // Reverse the race: after publication owns the version lock, an older draft
  // writer must wait and then reject, even though its first RLS check saw a draft.
  const [successor] = await authenticated((tx) => tx`select version.id as version_id, workout.id as workout_id
    from public.program_versions version join public.program_weeks week on week.program_version_id = version.id
    join public.workouts workout on workout.program_week_id = week.id
    where version.program_id = ${concurrent.id}::uuid and version.status = 'draft'`);
  await publisher.unsafe('begin');
  await authenticate(publisher);
  await publisher`select public.publish_program_version(${successor.version_id}::uuid, current_date)`;
  await writer.unsafe('begin');
  await authenticate(writer);
  const lateEdit = writer`update public.workouts set title = 'Must never reach snapshot' where id = ${successor.workout_id}::uuid`.execute();
  const lateResult = lateEdit.then((rows) => ({ rows }), (error) => ({ error }));
  await assertWaiting(writerPid, publisherPid);
  await publisher.unsafe('commit');
  const rejected = await lateResult;
  assert.match(rejected.error?.message ?? '', /Published program content is immutable/);
  await writer.unsafe('rollback');
  const [snapshot] = await authenticated((tx) => tx`select title from public.workouts where id = ${successor.workout_id}::uuid`);
  assert.equal(snapshot.title, 'Edit committed before snapshot');
  console.log('Database review smoke passed: unused/used draft duplication, isolated copies, Calendar order, and both real concurrent edit/publication interleavings.');
} finally {
  await Promise.allSettled([writer.unsafe('rollback'), publisher.unsafe('rollback')]);
  await Promise.all([writer.end({ timeout: 2 }), publisher.end({ timeout: 2 })]);
  try {
    if (fixtureCreated) await db.begin(async (tx) => {
      await tx`select set_config('request.jwt.claim.role', 'service_role', true)`;
      await tx`select public.reset_test_population(${namespace}, ${['owner']}::text[])`;
      await tx`delete from auth.users where id = ${owner}::uuid`;
    });
  } finally { await db.end({ timeout: 2 }); }
}
