import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { assertLoopbackPostgresUrl } from '../scripts/lib/local-database-verification.mjs';
import { migrationStatements } from '../scripts/lib/portable-migrations.mjs';

const url = process.env.LIFTLOG_PREVIOUS_VALUES_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
assertLoopbackPostgresUrl(url);
const db = postgres(url, { max: 1, connect_timeout: 5, onnotice: () => {}, connection: { statement_timeout: 20000, lock_timeout: 10000, application_name: 'liftlog-previous-values-smoke' } });
const owner = randomUUID(), outsider = randomUUID();
async function rejects(query, pattern) {
  await db.unsafe('savepoint rejected_previous_values');
  try { await assert.rejects(query, pattern); } finally { await db.unsafe('rollback to savepoint rejected_previous_values'); }
}
async function dataSnapshot() {
  const result = {};
  for (const table of ['workouts','workout_items','prescribed_entries','workout_sessions','session_item_logs','session_entries']) {
    const [row] = await db.unsafe(`select count(*)::integer as count, md5(coalesce(string_agg((to_jsonb(row) - 'history_lineage_id')::text, '' order by row.id), '')) as hash from public.${table} row`);
    result[table] = row;
  }
  return result;
}
async function currentDraft(programId) {
  return (await db`select public.get_program_version_detail(${programId}::uuid) as payload`)[0].payload.weeks[0].workouts[0];
}
async function start(runId) {
  const [occurrence] = await db`select id from public.scheduled_workouts where program_run_id=${runId}::uuid`;
  const [session] = await db`select public.start_scheduled_workout(${occurrence.id}::uuid) as id`;
  return session.id;
}
async function complete(sessionId, firstLoad = 50) {
  const logs = await db`select id,entry_mode,position from public.session_item_logs where workout_session_id=${sessionId}::uuid order by position`;
  const payload = { recordingSchema:2, sessionRpe:7,sessionNote:'',items:logs.map((log) => ({itemLogId:log.id,entries:
    log.position === 0 ? [{position:0,reps:5,loadKg:firstLoad,rpe:8},{position:1,reps:0,loadKg:0,rpe:null}]
    : log.position === 1 ? [{position:0,reps:8,loadKg:30,rpe:6}]
    : log.position === 2 ? [{position:0,durationSeconds:45,heartRate:120,rpe:7}]
    : log.position === 3 ? [{position:0,durationSeconds:90,distanceMetres:500,heartRate:140,rpe:8}]
    : [{position:0,rounds:1,durationSeconds:30,distanceMetres:150,heartRate:150,rpe:9},{position:1,rounds:0,durationSeconds:null,distanceMetres:0,heartRate:null,rpe:null}]
  })) };
  await db`select public.save_workout_session_draft(${sessionId}::uuid,0,${randomUUID()}::uuid,${db.json(payload)})`;
  await db`select public.complete_workout_session_confirmed(${sessionId}::uuid,1,${randomUUID()}::uuid,7,'')`;
}

await db.unsafe('begin');
try {
  const [{installed}] = await db`select exists(select 1 from information_schema.columns where table_schema='public' and table_name='workouts' and column_name='history_lineage_id') as installed`;
  for (const id of [owner,outsider]) await db`insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values (${id}::uuid,${`previous-values-${id}@example.test`},'{}','{"given_name":"Previous","family_name":"Values"}')`;
  await db`select set_config('request.jwt.claim.sub',${owner},true)`;
  await db`select set_config('request.jwt.claim.role','authenticated',true)`;
  await db.unsafe('set local role authenticated');
  const exercises=[];
  for (const [name,mode,fields] of [['Squat','sets',['reps','load','rpe']],['Timed','sets',['duration','heartRate','rpe']],['Distance','result',['duration','distance','heartRate','rpe']],['Intervals','intervals',['rounds','duration','distance','heartRate','rpe']]]) {
    const [exercise] = await db`insert into public.exercises(scope,owner_id,name,default_entry_mode,default_tracking_fields) values ('personal',${owner}::uuid,${name},${mode},${fields}::text[]) returning id`;
    exercises.push(exercise.id);
  }
  const [program] = await db`select public.create_blank_program(${owner}::uuid,'Previous values smoke') as id`;
  const [week] = await db`select week.id from public.program_weeks week join public.program_versions version on version.id=week.program_version_id where version.program_id=${program.id}::uuid and version.status='draft'`;
  const [created] = await db`select public.append_program_workout(${week.id}::uuid,'Repeatable workout') as payload`;
  const workout=created.payload, ids=[];
  for (const exerciseId of [exercises[0],...exercises]) ids.push((await db`select public.append_workout_exercise(${workout.sections[0].id}::uuid,${exerciseId}::uuid) as payload`)[0].payload.id);
  const [{today}] = await db`select current_date::text as today`;
  const dates=[{workoutId:workout.id,plannedDate:today}];
  const [run] = await db`select * from public.create_program_runs(${program.id}::uuid,${[owner]}::uuid[],${db.json(dates)},${randomUUID()}::uuid)`;
  const originalSession=await start(run.run_id); await complete(originalSession);
  const cloneBeforeMigration=await currentDraft(program.id);
  // Create a structurally different old descendant. It must not inherit guessed identities.
  const [changedCopy] = await db`select public.copy_program_run_to_own(${run.run_id}::uuid) as id`;
  const changedWorkout=await currentDraft(changedCopy.id);
  await db`update public.workouts set title='Changed before identity existed' where id=${changedWorkout.id}::uuid`;
  await db.unsafe('reset role');
  const before=await dataSnapshot();
  if (!installed) for (const statement of migrationStatements(await readFile(new URL('../supabase/migrations/202609140002_previous_workout_values.sql',import.meta.url),'utf8'))) await db.unsafe(statement);
  assert.deepEqual(await dataSnapshot(),before,'Only new lineage metadata may change; preserve all targets, actuals, and timestamps');
  await db.unsafe('set local role authenticated');
  const previous=(await db`select public.get_previous_workout_values(${cloneBeforeMigration.id}::uuid) as payload`)[0].payload;
  assert.equal(previous.sessionId,originalSession,'Older exact cloned template matches prior results');
  const first=previous.items.find((item) => item.workoutItemId===cloneBeforeMigration.sections[0].items[0].id);
  const second=previous.items.find((item) => item.workoutItemId===cloneBeforeMigration.sections[0].items[1].id);
  assert.equal(first.entries[0].loadKg,50); assert.equal(second.entries[0].loadKg,30,'Same exercise in another occurrence remains separate');
  assert.equal(first.entries[1].reps,0); assert.equal(first.entries[1].loadKg,0); assert.equal(first.entries[1].rpe,null);
  assert.equal(previous.items[2].entries[0].durationSeconds,45); assert.equal(previous.items[3].entries[0].distanceMetres,500); assert.equal(previous.items[4].entries[0].heartRate,150);
  if (!installed) assert.equal((await db`select public.get_previous_workout_values(${changedWorkout.id}::uuid) as payload`)[0].payload,null,'Do not infer identity for altered historical clones');
  // Repeating a run uses the original immutable workout and exercise identities.
  const [repeat]=await db`select public.repeat_program_run(${run.run_id}::uuid,${db.json(dates)},${randomUUID()}::uuid) as payload`;
  const repeatedSession=await start(repeat.payload.runId);
  const activeBefore=await db`select to_jsonb(entry) as value from public.session_entries entry join public.session_item_logs log on log.id=entry.session_item_log_id where log.workout_session_id=${repeatedSession}::uuid order by entry.id`;
  assert.equal((await db`select public.get_previous_workout_values(${workout.id}::uuid,${repeatedSession}::uuid) as payload`)[0].payload.sessionId,originalSession);
  assert.deepEqual(await db`select to_jsonb(entry) as value from public.session_entries entry join public.session_item_logs log on log.id=entry.session_item_log_id where log.workout_session_id=${repeatedSession}::uuid order by entry.id`,activeBefore,'Reference reads cannot write into the active draft');
  await complete(repeatedSession,55);
  assert.equal((await db`select public.get_previous_workout_values(${workout.id}::uuid) as payload`)[0].payload.sessionId,repeatedSession,'Latest completed occurrence wins');
  assert.equal((await db`select public.get_previous_workout_values(${workout.id}::uuid,${repeatedSession}::uuid) as payload`)[0].payload.sessionId,originalSession,'Explicit exclusion is honored');
  // A new post-migration clone carries stable identity through renames and reorders.
  const [newCopy]=await db`select public.copy_program_run_to_own(${run.run_id}::uuid) as id`;
  const newWorkout=await currentDraft(newCopy.id); const newItems=newWorkout.sections[0].items;
  await db`update public.workouts set title='Renamed copied workout' where id=${newWorkout.id}::uuid`;
  await db`select public.reorder_workout_items(${newWorkout.id}::uuid,${newItems.map((item) => item.id).reverse()}::uuid[])`;
  const reordered=(await db`select public.get_previous_workout_values(${newWorkout.id}::uuid) as payload`)[0].payload;
  assert.equal(reordered.items.find((item) => item.workoutItemId===newItems[0].id).entries[0].loadKg,55);
  assert.equal(reordered.items.find((item) => item.workoutItemId===newItems[1].id).entries[0].loadKg,30);
  await db`select public.save_workout_item_prescription(${newItems[0].id}::uuid,'','sets',array['reps'],'[]'::jsonb)`;
  const fieldFiltered=(await db`select public.get_previous_workout_values(${newWorkout.id}::uuid) as payload`)[0].payload;
  assert.deepEqual(fieldFiltered.items.find((item) => item.workoutItemId===newItems[0].id).fields,['reps'],'Hints only describe fields both workouts track');
  await db`select public.save_workout_item_prescription(${newItems[1].id}::uuid,'','none',array[]::text[],'[]'::jsonb)`;
  const modeFiltered=(await db`select public.get_previous_workout_values(${newWorkout.id}::uuid) as payload`)[0].payload;
  assert.ok(!modeFiltered.items.some((item) => item.workoutItemId===newItems[1].id),'Changed recording modes do not show stale incompatible values');
  await rejects(() => db`update public.workouts set history_lineage_id=${randomUUID()}::uuid where id=${newWorkout.id}::uuid`,/lineage is immutable/);
  const [unrelatedProgram]=await db`select public.create_blank_program(${owner}::uuid,'Unrelated same-name program') as id`;
  const [unrelatedWeek]=await db`select week.id from public.program_weeks week join public.program_versions version on version.id=week.program_version_id where version.program_id=${unrelatedProgram.id}::uuid and version.status='draft'`;
  const [unrelated]=await db`select public.append_program_workout(${unrelatedWeek.id}::uuid,'Repeatable workout') as payload`;
  await db`select public.append_workout_exercise(${unrelated.payload.sections[0].id}::uuid,${exercises[0]}::uuid)`;
  assert.equal((await db`select public.get_previous_workout_values(${unrelated.payload.id}::uuid) as payload`)[0].payload,null,'Matching title and exercise never link unrelated content');
  await db.unsafe('reset role');
  await db`insert into public.coach_relationships(athlete_id,coach_id) values (${outsider}::uuid,${owner}::uuid)`;
  await db.unsafe('set local role authenticated');
  const latestDraft=await currentDraft(program.id);
  const [otherRun]=await db`select * from public.create_program_runs(${program.id}::uuid,${[outsider]}::uuid[],${db.json([{workoutId:latestDraft.id,plannedDate:today}])},${randomUUID()}::uuid)`;
  assert.ok(otherRun.run_id);
  await db`select set_config('request.jwt.claim.sub',${outsider},true)`;
  assert.equal((await db`select public.get_previous_workout_values(${latestDraft.id}::uuid) as payload`)[0].payload,null,'Readable coach-assigned template cannot expose another athlete’s history');
  console.log('Previous values SQL smoke passed: conservative legacy clone match; immutable and new-copy repeats; occurrence and position matching; all metrics/zero/null; latest/exclusion; renamed/reordered copies; own-athlete authorization; immutable lineage; read-only actuals. Transaction rolled back.');
} finally { await db.unsafe('rollback'); await db.end({timeout:2}); }
