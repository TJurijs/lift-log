import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { assertLoopbackPostgresUrl } from "../scripts/lib/local-database-verification.mjs";

const url = process.env.LIFTLOG_CUSTOM_EXERCISE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
assertLoopbackPostgresUrl(url);
const db = postgres(url, { max: 1, connect_timeout: 5, onnotice: () => {} });
const owner = randomUUID(), athlete = randomUUID(), outsider = randomUUID();

async function login(id) {
  await db.unsafe("reset role");
  await db`select set_config('request.jwt.claim.sub', ${id}, true)`;
  await db.unsafe("set local role authenticated");
}
async function rejects(query, pattern) {
  await db.unsafe("savepoint rejected_custom_exercise");
  try { await assert.rejects(query, pattern); }
  finally { await db.unsafe("rollback to savepoint rejected_custom_exercise"); }
}
async function detail(id) {
  return (await db`select public.get_program_version_detail(${id}::uuid) as payload`)[0].payload;
}
async function assertCustomItems(workoutId, names) {
  const items = await db`select source_exercise_id, snapshot_name, tracking_fields
    from public.workout_items item join public.workout_sections section on section.id = item.section_id
    where section.workout_id = ${workoutId}::uuid order by item.position`;
  assert.deepEqual(items.map((item) => item.snapshot_name), names);
  assert.ok(items.every((item) => item.source_exercise_id === null));
  assert.ok(items.every((item) => JSON.stringify(item.tracking_fields) === '["reps","load"]'));
}

await db.unsafe("begin");
try {
  const [{ count: libraryBefore }] = await db`select count(*)::int as count from public.exercises`;
  for (const id of [owner, athlete, outsider]) {
    await db`insert into auth.users(id, email, raw_app_meta_data, raw_user_meta_data)
      values (${id}::uuid, ${`custom-${id}@example.test`}, '{}', '{"given_name":"Custom","family_name":"Smoke"}')`;
  }
  await db`insert into public.coach_relationships(athlete_id, coach_id) values (${athlete}::uuid, ${owner}::uuid)`;
  await login(owner);
  const [{ id: programId }] = await db`select public.create_blank_program(${owner}::uuid, 'Workout custom movement smoke') as id`;
  const program = await detail(programId);
  const [{ payload: workout }] = await db`select public.append_program_workout(${program.weeks[0].id}::uuid, 'Custom movements') as payload`;
  const [{ payload: otherWorkout }] = await db`select public.append_program_workout(${program.weeks[0].id}::uuid, 'Unchanged workout') as payload`;
  const sectionId = workout.sections[0].id;
  const [{ payload: item }] = await db`select public.append_custom_workout_exercise(${sectionId}::uuid, ' Clean + hold ') as payload`;
  assert.equal(item.name, "Clean + hold");
  assert.equal(item.sourceExerciseId, null);
  assert.deepEqual(item.trackingFields, ["reps", "load"]);
  assert.equal(item.prescribedEntries.length, 3);
  assert.equal(item.position, 0);
  assert.equal((await db`select count(*)::int as count from public.prescribed_entries
    where workout_item_id = ${item.id}::uuid and (reps_min is not null or load_kg is not null or target_rpe_min is not null)`)[0].count, 0);
  await assertCustomItems(otherWorkout.id, []);
  const entries = Array.from({ length: 3 }, () => ({ reps_min: 5, reps_max: 5, load_kg: 20 }));
  await db`select public.save_workout_item_prescription(${item.id}::uuid, 'Hold for two seconds.', 'sets', array['reps','load'], ${db.json(entries)})`;
  await rejects(() => db`select public.append_custom_workout_exercise(${sectionId}::uuid, ' ')`, /name must be/);
  await rejects(() => db`select public.append_custom_workout_exercise(${sectionId}::uuid, ${"x".repeat(161)})`, /name must be/);
  await login(outsider);
  await rejects(() => db`select public.append_custom_workout_exercise(${sectionId}::uuid, 'Unauthorized')`, /not editable/);
  await login(owner);
  const [{ payload: ownRun }] = await db`select public.ensure_own_training_run(${programId}::uuid, '[]', ${randomUUID()}::uuid) as payload`;
  await rejects(() => db`select public.append_custom_workout_exercise(${sectionId}::uuid, 'Published mutation')`, /not editable/);
  const [{ payload: runDetail }] = await db`select public.get_program_run_detail(${ownRun.runId}::uuid) as payload`;
  const slot = runDetail.workouts[0];
  const [{ payload: edit }] = await db`select public.prepare_program_run_workout_edit(${slot.id}::uuid) as payload`;
  await assertCustomItems(edit.workoutId, ["Clean + hold"]);
  const [{ id: editSectionId }] = await db`select id from public.workout_sections where workout_id = ${edit.workoutId}::uuid`;
  await db`select public.append_custom_workout_exercise(${editSectionId}::uuid, 'Private variation')`;
  const [{ id: repeatedId }] = await db`select public.copy_program_run_to_own(${ownRun.runId}::uuid) as id`;
  const repeated = await detail(repeatedId);
  await assertCustomItems(repeated.weeks[0].workouts[0].id, ["Clean + hold", "Private variation"]);
  const [{ payload: assigned }] = await db`select public.assign_program_run(${ownRun.runId}::uuid, ${[athlete]}::uuid[], '[]', ${randomUUID()}::uuid) as payload`;
  await login(athlete);
  const [{ payload: assignedDetail }] = await db`select public.get_program_run_detail(${assigned[0].runId}::uuid) as payload`;
  const [{ today }] = await db`select current_date::text today`;
  const [{ id: sessionId }] = await db`select public.start_training_workout(null, null, ${assignedDetail.workouts[0].id}::uuid, ${today}::date) as id`;
  const sessionItems = await db`select log.id, item.source_exercise_id, log.snapshot_name, log.snapshot_cue, log.tracking_fields
    from public.session_item_logs log left join public.workout_items item on item.id = log.source_workout_item_id
    where log.workout_session_id = ${sessionId}::uuid order by log.position`;
  assert.deepEqual(sessionItems.map((log) => log.snapshot_name), ["Clean + hold", "Private variation"]);
  assert.ok(sessionItems.every((log) => log.source_exercise_id === null));
  assert.equal(sessionItems[0].snapshot_cue, "Hold for two seconds.");
  const actuals = await db`select reps, load_kg, rpe from public.session_entries where session_item_log_id = ${sessionItems[0].id}::uuid order by position`;
  assert.equal(actuals.length, 3);
  assert.ok(actuals.every((entry) => Number(entry.reps) === 5 && Number(entry.load_kg) === 20 && entry.rpe === null));
  await db.unsafe("reset role");
  assert.equal((await db`select count(*)::int as count from public.exercises`)[0].count, libraryBefore, "No personal or shared library entries are created");
  assert.equal((await db`select has_function_privilege('anon', 'public.append_custom_workout_exercise(uuid,text)', 'EXECUTE') allowed`)[0].allowed, false);
  console.log("Workout custom exercise smoke passed: scoped snapshots, empty reps/weight defaults without RPE, prescription edits, access control, frozen-content protection, private edits, repeat, assignment and prefilled logging. Library unchanged; transaction rolled back.");
} finally {
  await db.unsafe("rollback");
  await db.end({ timeout: 2 });
}
