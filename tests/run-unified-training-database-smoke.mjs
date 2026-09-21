import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import postgres from 'postgres';
import {assertLoopbackPostgresUrl} from '../scripts/lib/local-database-verification.mjs';
import {migrationStatements} from '../scripts/lib/portable-migrations.mjs';

const url=process.env.LIFTLOG_UNIFIED_TRAINING_DB_URL??'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
assertLoopbackPostgresUrl(url);
const db=postgres(url,{max:1,connect_timeout:5,onnotice:()=>{},connection:{statement_timeout:30000,lock_timeout:10000,application_name:'liftlog-unified-training-smoke'}});
const owner=randomUUID(), athlete=randomUUID(), outsider=randomUUID();
async function login(id){await db.unsafe('reset role');await db`select set_config('request.jwt.claim.sub',${id},true)`;await db`select set_config('request.jwt.claim.role','authenticated',true)`;await db.unsafe('set local role authenticated');}
async function rejects(query,pattern){await db.unsafe('savepoint rejected_training');try{await assert.rejects(query,pattern);}finally{await db.unsafe('rollback to savepoint rejected_training');}}
async function detail(id){return (await db`select public.get_program_run_detail(${id}::uuid) as payload`)[0].payload;}
async function createProgram(title,count=3){
  const [{id}]=await db`select public.create_blank_program(${owner}::uuid,${title}) as id`;
  const [{payload}]=await db`select public.get_program_version_detail(${id}::uuid) as payload`;
  const workouts=[];
  for(let index=0;index<count;index++) workouts.push((await db`select public.append_program_workout(${payload.weeks[0].id}::uuid,${`${title} ${index+1}`}) as payload`)[0].payload);
  return {id,workouts};
}
async function ensure(id,dates=[],key=randomUUID()){return (await db`select public.ensure_own_training_run(${id}::uuid,${db.json(dates)},${key}::uuid) as payload`)[0].payload;}
async function complete(session){await db`select public.save_workout_session_draft(${session}::uuid,0,${randomUUID()}::uuid,'{"recordingSchema":2,"sessionRpe":null,"sessionNote":"","items":[]}'::jsonb)`;await db`select public.complete_workout_session_confirmed(${session}::uuid,1,${randomUUID()}::uuid,null,'')`;}
async function start(input){return (await db`select public.start_training_workout(${input.programId??null}::uuid,${input.workoutId??null}::uuid,${input.runWorkoutId??null}::uuid,${input.date}::date) as id`)[0].id;}
await db.unsafe('begin');
try{
  const [{installed}]=await db`select to_regprocedure('public.ensure_own_training_run(uuid,jsonb,uuid)') is not null as installed`;
  if(!installed)for(const statement of migrationStatements(await readFile(new URL('../supabase/migrations/202609210003_unified_training.sql',import.meta.url),'utf8'))){if(!/^(begin|commit);?$/i.test(statement.trim()))await db.unsafe(statement);}
  for(const id of [owner,athlete,outsider])await db`insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values(${id}::uuid,${`unified-${id}@example.test`},'{}','{"given_name":"Unified","family_name":"Smoke"}')`;
  await db`insert into public.coach_relationships(athlete_id,coach_id) values(${athlete}::uuid,${owner}::uuid)`;
  await login(owner);
  const [{today,tomorrow,later}]=await db`select current_date::text today,(current_date+1)::text tomorrow,(current_date+2)::text later`;
  const source=await createProgram('Optional dates');
  const key=randomUUID();
  const run=await ensure(source.id,[{workoutId:source.workouts[0].id,plannedDate:tomorrow}],key);
  assert.equal(run.created,true);
  assert.equal((await ensure(source.id,[],randomUUID())).runId,run.runId,'Different action keys reuse one own training');
  assert.equal((await ensure(source.id,[{workoutId:source.workouts[0].id,plannedDate:tomorrow}],key)).runId,run.runId,'Identical date retry returns same training');
  await ensure(source.id,[{workoutId:source.workouts[0].id,plannedDate:later}]);
  let actual=await detail(run.runId);
  assert.equal(actual.workouts.length,3,'First date materializes every program workout once');
  assert.equal(actual.workouts[0].plannedDate,later,'Existing training applies requested date changes');
  assert.equal(actual.workouts[1].plannedDate,null);
  const [{payload:successor}]=await db`select public.get_program_version_detail(${source.id}::uuid) as payload`;
  await ensure(source.id,[{workoutId:successor.weeks[0].workouts[0].id,plannedDate:tomorrow}]);
  assert.equal((await detail(run.runId)).workouts[0].plannedDate,tomorrow,'Successor draft IDs resolve to the same occurrence');
  // Start any undated workout immediately, even with an earlier workout planned later.
  const session=await start({runWorkoutId:actual.workouts[2].id,date:today});
  assert.equal(await start({runWorkoutId:actual.workouts[2].id,date:later}),session,'Start retry resumes exact same session');
  actual=await detail(run.runId);
  assert.equal(actual.workouts[2].plannedDate,today);
  assert.equal(actual.workouts[0].plannedDate,tomorrow,'Starting another slot preserves planned dates');
  const [{payload:edited}]=await db`select public.prepare_program_run_workout_edit(${actual.workouts[1].id}::uuid) as payload`;
  await db`update public.workouts set title='Edited future training' where id=${edited.workoutId}::uuid`;
  await rejects(()=>start({runWorkoutId:actual.workouts[1].id,date:today}),/Finish the in-progress/);
  assert.equal((await detail(run.runId)).workouts[1].plannedDate,null,'Failed start rolls back new date and occurrence');
  await login(outsider);await rejects(()=>ensure(source.id),/Training was not found/);await rejects(()=>start({runWorkoutId:actual.workouts[1].id,date:today}),/not found/);
  await login(owner);
  await complete(session);
  await rejects(()=>start({runWorkoutId:actual.workouts[2].id,date:today}),/unfinished/);
  const history=await db`select * from public.list_completed_session_summaries()`;
  assert.equal(history.find(row=>row.id===session).source_type,'self');
  const editSession=await start({runWorkoutId:actual.workouts[1].id,date:today});
  assert.equal((await db`select workout_title from public.workout_sessions where id=${editSession}::uuid`)[0].workout_title,'Edited future training','Starting keeps private occurrence edits');
  await complete(editSession);
  const datedSession=await start({programId:source.id,workoutId:source.workouts[0].id,date:today});
  assert.equal((await detail(run.runId)).workouts[0].plannedDate,tomorrow,'Alreadydated selected workout keeps its date');
  await complete(datedSession);
  await rejects(()=>ensure(source.id),/Repeat completed/);
  const [{id:copyId}]=await db`select public.copy_program_run_to_own(${run.runId}::uuid) as id`;
  const copyRun=await ensure(copyId);
  assert.ok((await detail(copyRun.runId)).workouts.every(slot=>!slot.plannedDate),'Repeating keeps dates clear');
  const direct=await createProgram('Direct start',1);
  const directSession=await start({programId:direct.id,workoutId:direct.workouts[0].id,date:today});
  assert.equal(await start({programId:direct.id,workoutId:direct.workouts[0].id,date:today}),directSession);
  await complete(directSession);
  const earlier=await createProgram('Earlier date',1), laterProgram=await createProgram('Later date',1);
  const earlyRun=await ensure(earlier.id,[{workoutId:earlier.workouts[0].id,plannedDate:today}]);
  await ensure(laterProgram.id,[{workoutId:laterProgram.workouts[0].id,plannedDate:later}]);
  const first=await db`select * from public.list_program_run_summaries(null,1,null,null,'all','active',null)`;
  assert.equal(first[0].id,earlyRun.runId,'Server date order puts older-created nearer training first');
  const second=await db`select * from public.list_program_run_summaries(null,1,${first[0].created_at},${first[0].id}::uuid,'all','active',${first[0].sort_date}::date)`;
  assert.equal(second[0].title,'Later date');
  const third=await db`select * from public.list_program_run_summaries(null,1,${second[0].created_at},${second[0].id}::uuid,'all','active',${second[0].sort_date}::date)`;
  assert.equal(third[0].id,copyRun.runId,'Undated training follows dated training across pages');
  const historyRuns=await db`select * from public.list_program_run_summaries(null,50,null,null,'all','history',null)`;
  assert.ok(historyRuns.every(row=>['completed','ended'].includes(row.status)));
  assert.ok(historyRuns.some(row=>row.id===run.runId));
  await rejects(()=>db`select * from public.list_program_run_summaries(null,1,${first[0].created_at},${first[0].id}::uuid,'all','active',null)`,/cursor/);
  // Assigned training is startable by its athlete without exposing source authoring.
  const [assigned]=await db`select * from public.create_program_runs(${laterProgram.id}::uuid,${[athlete]}::uuid[],'[]'::jsonb,${randomUUID()}::uuid)`;
  await login(athlete);
  const assignedDetail=await detail(assigned.run_id);
  const assignedSession=await start({runWorkoutId:assignedDetail.workouts[0].id,date:today});
  await complete(assignedSession);
  assert.equal((await db`select * from public.list_completed_session_summaries()`)[0].source_type,'coach');
  await db.unsafe('reset role');
  for(const signature of ['public.ensure_own_training_run(uuid,jsonb,uuid)','public.start_training_workout(uuid,uuid,uuid,date)','public.list_program_run_summaries(uuid,integer,timestamptz,uuid,text,text,date)']) assert.equal((await db`select has_function_privilege('anon',${signature},'EXECUTE') allowed`)[0].allowed,false);
  console.log('Unified Training SQL smoke passed: optional dates, one own occurrence, direct and selected undated start, retry safety, future private edits, atomic failure rollback, ownership, retained history, repeat, chronological bounded active/history pagination and assigned origin. Transaction rolled back.');
}finally{await db.unsafe('rollback');await db.end({timeout:2});}
