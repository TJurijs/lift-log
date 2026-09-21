import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import postgres from 'postgres';
import {assertLoopbackPostgresUrl} from '../scripts/lib/local-database-verification.mjs';
import {migrationStatements} from '../scripts/lib/portable-migrations.mjs';

const url=process.env.LIFTLOG_LIFECYCLE_DB_URL??'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
assertLoopbackPostgresUrl(url);
const db=postgres(url,{max:1,connect_timeout:5,onnotice:()=>{},connection:{statement_timeout:30000,lock_timeout:10000,application_name:'liftlog-workout-lifecycle-smoke'}});
const owner=randomUUID(), athlete=randomUUID(), outsider=randomUUID();
const namespace=`lifecycle-${randomUUID().slice(0,8)}-v1`;
async function login(id){await db.unsafe('reset role');await db`select set_config('request.jwt.claim.sub',${id},true)`;await db`select set_config('request.jwt.claim.role','authenticated',true)`;await db.unsafe('set local role authenticated');}
async function rejects(query,pattern){await db.unsafe('savepoint rejected_lifecycle');try{await assert.rejects(query,pattern);}finally{await db.unsafe('rollback to savepoint rejected_lifecycle');}}
async function runDetail(id){return (await db`select public.get_program_run_detail(${id}::uuid) as payload`)[0].payload;}
async function programDetail(id){return (await db`select public.get_program_version_detail(${id}::uuid) as payload`)[0].payload;}
async function prepare(id){return (await db`select public.prepare_program_run_workout_edit(${id}::uuid) as payload`)[0].payload;}
await db.unsafe('begin');
try{
  const [{installed}]=await db`select exists(select 1 from information_schema.columns where table_schema='public' and table_name='program_run_workouts' and column_name='edited_workout_id') as installed`;
  if(!installed)for(const statement of migrationStatements(await readFile(new URL('../supabase/migrations/202609210002_workout_program_lifecycle.sql',import.meta.url),'utf8'))){if(!/^(begin|commit);?$/i.test(statement.trim()))await db.unsafe(statement);}
  for(const id of [owner,athlete,outsider])await db`insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values(${id}::uuid,${`lifecycle-${id}@example.test`},'{}','{"given_name":"Lifecycle","family_name":"Smoke"}')`;
  await db`select set_config('request.jwt.claim.role','service_role',true)`;
  for(const [name,id] of [['owner',owner],['athlete',athlete],['outsider',outsider]])await db`update public.profiles set account_kind='test',test_persona_key=${`${namespace}:${name}`} where id=${id}::uuid`;
  await db`insert into public.coach_relationships(athlete_id,coach_id,account_kind) values(${athlete}::uuid,${owner}::uuid,'test')`;
  await login(owner);
  const [program]=await db`select public.create_blank_program(${owner}::uuid,'Independent program') as id`;
  const initial=await programDetail(program.id), workouts=[];
  const [exercise]=await db`insert into public.exercises(scope,owner_id,name,default_entry_mode,default_tracking_fields) values('personal',${owner}::uuid,'Press','sets',array['reps','load']) returning id`;
  for(const title of ['Workout A','Workout B']){
    const [{payload:workout}]=await db`select public.append_program_workout(${initial.weeks[0].id}::uuid,${title}) as payload`;
    const [{payload:item}]=await db`select public.append_workout_exercise(${workout.sections[0].id}::uuid,${exercise.id}::uuid) as payload`;
    await db`select public.save_workout_item_prescription(${item.id}::uuid,'Original instructions','sets',array['reps','load'],${db.json([{reps_min:5,reps_max:5,load_kg:20}])})`;
    workouts.push(workout);
  }
  const [{today}]=await db`select current_date::text as today`;
  const dates=[{workoutId:workouts[0].id,plannedDate:today}];
  const runs=await db`select * from public.create_program_runs(${program.id}::uuid,${[owner,athlete]}::uuid[],${db.json(dates)},${randomUUID()}::uuid)`;
  const ownRun=runs.find(r=>r.athlete_id===owner), coachedRun=runs.find(r=>r.athlete_id===athlete);
  let own=await runDetail(ownRun.run_id); const originalSlot=own.workouts[0];
  const edited=await prepare(originalSlot.id);
  assert.deepEqual(await prepare(originalSlot.id),edited,'Opening edit twice reuses the same private copy');
  const editable=await programDetail(edited.programId);
  assert.equal(editable.editableRunId,ownRun.run_id);assert.equal(editable.editableRunWorkoutId,originalSlot.id);
  const editedItem=editable.weeks[0].workouts[0].sections[0].items[0];
  await db`update public.workouts set title='Adjusted workout' where id=${edited.workoutId}::uuid`;
  await db`select public.save_workout_item_prescription(${editedItem.id}::uuid,'Adjusted instructions','sets',array['reps','load'],${db.json([{reps_min:8,reps_max:8,load_kg:40}])})`;
  assert.equal((await db`select title from public.workouts where id=${workouts[0].id}::uuid`)[0].title,'Workout A');
  assert.equal((await runDetail(coachedRun.run_id)).workouts[0].effectiveWorkoutId,workouts[0].id,'Other athlete retains original plan');
  own=await runDetail(ownRun.run_id);assert.equal(own.workouts[0].title,'Adjusted workout');assert.equal(own.workouts[0].workoutId,workouts[0].id);assert.equal(own.workouts[0].effectiveWorkoutId,edited.workoutId);
  const summaries=await db`select * from public.list_program_summaries()`;
  assert.ok(!summaries.some(row=>row.program_id===edited.programId),'Private copy is not a library item');
  assert.equal(summaries.find(row=>row.program_id===program.id).has_own_runs,true,'Program pagination identifies sources already represented by own runs');
  await rejects(()=>db`update public.programs set archived_at=null where id=${edited.programId}::uuid`,/copies remain attached/);
  await login(outsider);await rejects(()=>prepare(originalSlot.id),/Only an upcoming workout/);assert.equal(await programDetail(edited.programId),null);
  await rejects(()=>db`insert into public.programs(athlete_id,created_by_id,title,planning_mode,is_current,source_type,content_type,archived_at,run_workout_id) values(${outsider}::uuid,${outsider}::uuid,'Spoof','fixed_weeks',false,'self','quick_workout',now(),${own.workouts[1].id}::uuid)`,/must belong to an editable upcoming workout/);
  await login(owner);
  // Undated slots can be edited before their calendar occurrence exists.
  const undatedEdit=await prepare(own.workouts[1].id);
  await db`update public.workouts set title='Undated adjusted workout' where id=${undatedEdit.workoutId}::uuid`;
  await db`select public.schedule_program_run_workouts(${ownRun.run_id}::uuid,${db.json([{workoutId:workouts[1].id,plannedDate:today}])},${randomUUID()}::uuid)`;
  own=await runDetail(ownRun.run_id);
  const [{payload:scheduled}]=await db`select public.get_scheduled_workout_detail(${own.workouts[1].scheduledWorkoutId}::uuid) as payload`;
  assert.equal(scheduled.workoutId,undatedEdit.workoutId);
  assert.equal(scheduled.programTitle,'Independent program','Private container titles do not replace the assigned program name');
  await db`select public.schedule_workout(${own.workouts[1].scheduledWorkoutId}::uuid,${today}::date)`;
  const [{payload:visibleRun}]=await db`select public.get_program_run_program_detail(${ownRun.run_id}::uuid) as payload`;
  assert.equal(visibleRun.weeks[0].workouts[0].id,edited.workoutId);
  assert.equal(visibleRun.weeks[0].workouts[1].title,'Undated adjusted workout');
  // Exact-run assignment includes adjusted content, and retries make no copies.
  const assignKey=randomUUID(),assignDates=[{workoutId:edited.workoutId,plannedDate:today}];
  const [{payload:assigned}]=await db`select public.assign_program_run(${ownRun.run_id}::uuid,${[athlete]}::uuid[],${db.json(assignDates)},${assignKey}::uuid) as payload`;
  assert.equal((await runDetail(assigned[0].runId)).workouts[0].title,'Adjusted workout');
  assert.deepEqual((await db`select public.assign_program_run(${ownRun.run_id}::uuid,${[athlete]}::uuid[],${db.json(assignDates)},${assignKey}::uuid) as payload`)[0].payload,assigned);
  await rejects(()=>db`select public.assign_program_run(${ownRun.run_id}::uuid,${[owner]}::uuid[],${db.json(assignDates)},${assignKey}::uuid)`,/Idempotency key/);
  // A coach and their athlete can edit the same upcoming copy; others cannot.
  const athleteSlot=(await runDetail(coachedRun.run_id)).workouts[0]; const coachEdit=await prepare(athleteSlot.id);
  await login(athlete);assert.equal((await programDetail(coachEdit.programId)).editableRunWorkoutId,athleteSlot.id);
  await db`update public.workouts set title='Athlete adjustment' where id=${coachEdit.workoutId}::uuid`;
  await login(owner);assert.equal((await programDetail(coachEdit.programId)).weeks[0].workouts[0].title,'Athlete adjustment');
  // Starting freezes the edited prescription and seeds its values.
  const [{id:sessionId}]=await db`select public.start_scheduled_workout(${originalSlot.scheduledWorkoutId}::uuid) as id`;
  const [{reps,load_kg}]=await db`select entry.reps,entry.load_kg from public.session_entries entry join public.session_item_logs log on log.id=entry.session_item_log_id where log.workout_session_id=${sessionId}::uuid`;
  assert.equal(Number(reps),8);assert.equal(Number(load_kg),40);
  assert.equal((await runDetail(ownRun.run_id)).workouts[0].canEdit,false);
  await rejects(()=>prepare(originalSlot.id),/Only an upcoming workout/);
  await rejects(()=>db`select public.save_workout_item_prescription(${editedItem.id}::uuid,'unsafe','sets',array['reps'],'[]'::jsonb)`,/not editable|immutable/);
  const logs=await db`select id from public.session_item_logs where workout_session_id=${sessionId}::uuid order by position`;
  await db`select public.save_workout_session_draft(${sessionId}::uuid,0,${randomUUID()}::uuid,${db.json({recordingSchema:2,sessionRpe:null,sessionNote:'',items:logs.map(log=>({itemLogId:log.id,entries:[{position:0,reps:8,loadKg:40}]}))})})`;
  await db`select public.complete_workout_session_confirmed(${sessionId}::uuid,1,${randomUUID()}::uuid,null,'')`;
  const [{id:repeatWorkoutId}]=await db`select public.copy_completed_workout_to_own(${sessionId}::uuid) as id`;
  const repeatedWorkout=(await programDetail(repeatWorkoutId)).weeks[0].workouts[0];
  assert.equal(repeatedWorkout.title,'Adjusted workout');assert.equal(repeatedWorkout.sections[0].items[0].prescribedEntries[0].repsMin,8);
  const [{payload:previous}]=await db`select public.get_previous_workout_values(${repeatedWorkout.id}::uuid) as payload`;
  assert.equal(previous.sessionId,sessionId,'Repeat keeps ghost-result lineage');
  await db`select public.end_program_run(${ownRun.run_id}::uuid)`;
  const [{payload:repeated}]=await db`select public.repeat_program_run(${ownRun.run_id}::uuid,'[]'::jsonb,${randomUUID()}::uuid) as payload`;
  assert.equal((await runDetail(repeated.runId)).workouts[0].title,'Adjusted workout');
  const [{id:copyId}]=await db`select public.copy_program_run_to_own(${ownRun.run_id}::uuid) as id`;
  assert.equal((await programDetail(copyId)).weeks[0].workouts[0].title,'Adjusted workout');
  await db`select public.delete_own_program(${program.id}::uuid)`;
  assert.equal((await runDetail(ownRun.run_id)).workouts[0].sessionId,sessionId,'Removal retains completed history');
  await login(outsider);await rejects(()=>db`select public.copy_completed_workout_to_own(${sessionId}::uuid)`,/not found/);
  await db.unsafe('reset role');
  await db`update public.coach_relationships set ended_at=now() where athlete_id=${athlete}::uuid and coach_id=${owner}::uuid`;
  await login(owner);await rejects(()=>db`select public.copy_program_run_to_own(${coachedRun.run_id}::uuid)`,/not found/);await rejects(()=>prepare(athleteSlot.id),/Only an upcoming workout/);
  await db.unsafe('reset role');
  for(const signature of ['public.prepare_program_run_workout_edit(uuid)','public.assign_program_run(uuid,uuid[],jsonb,uuid)','public.copy_completed_workout_to_own(uuid)']){
    const [{allowed}]=await db`select has_function_privilege('anon',${signature},'EXECUTE') as allowed`;assert.equal(allowed,false);
  }
  await db`select set_config('request.jwt.claim.role','service_role',true)`;
  const [{payload:reset}]=await db`select public.reset_test_population(${namespace},array['owner','athlete','outsider']) as payload`;
  assert.equal(reset.removed,3,'Guarded fixture reset can remove new private copies and assignment receipts');
  console.log('Workout/program lifecycle SQL smoke passed: isolated edits, undated/calendar scheduling, current/revoked coach permissions, hidden copies, exact repeat/assignment with idempotency, frozen completion, retained history, ghost lineage and isolated fixture cleanup. Transaction rolled back.');
}finally{await db.unsafe('rollback');await db.end({timeout:2});}
