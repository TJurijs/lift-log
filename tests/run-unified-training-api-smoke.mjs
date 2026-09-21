import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {createClient} from '@supabase/supabase-js';

// This concurrent transport test only creates an isolated disposable local user.
const raw=execFileSync(process.execPath,[resolve('node_modules/supabase/dist/supabase.js'),'status','-o','env'],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']});
const environment=Object.fromEntries(raw.split(/\r?\n/).flatMap(line=>{const match=line.match(/^([A-Z_]+)="(.*)"$/);return match?[[match[1],match[2]]]:[];}));
assert.equal(environment.API_URL,'http://127.0.0.1:54321','Concurrent smoke is restricted to the local Docker API');
const options={auth:{persistSession:false,autoRefreshToken:false}};
const admin=createClient(environment.API_URL,environment.SERVICE_ROLE_KEY??environment.SECRET_KEY,options);
const namespace=`unified-${Date.now()}-${randomUUID().slice(0,8)}-v1`;
const password=randomUUID(),email=`${namespace}@example.test`;
function data(result){assert.equal(result.error,null,result.error?.message);return result.data;}
const clients=[];let fixtureCreated=false;
try{
  const account=data(await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{given_name:'Training',family_name:'Concurrency'},app_metadata:{account_kind:'test',test_persona_key:`${namespace}:owner`,fixture_namespace:namespace}}));
  fixtureCreated=true;
  data(await admin.from('profiles').update({account_kind:'test',test_persona_key:`${namespace}:owner`}).eq('id',account.user.id));
  for(let index=0;index<2;index++){
    const client=createClient(environment.API_URL,environment.ANON_KEY??environment.PUBLISHABLE_KEY,options);
    data(await client.auth.signInWithPassword({email,password}));clients.push(client);
  }
  const source=data(await clients[0].rpc('create_blank_program',{target_athlete_id:account.user.id,target_title:'Concurrent training'}));
  const program=data(await clients[0].rpc('get_program_version_detail',{target_program_id:source}));
  const workout=data(await clients[0].rpc('append_program_workout',{target_week_id:program.weeks[0].id,target_title:'Selected workout'}));
  const runs=await Promise.all(clients.map(client=>client.rpc('ensure_own_training_run',{target_program_id:source,target_workout_dates:[],target_idempotency_key:randomUUID()})));
  assert.equal(data(runs[0]).runId,data(runs[1]).runId,'Simultaneous first actions create exactly one own run');
  assert.equal(runs.filter(result=>data(result).created).length,1);
  const runId=data(runs[0]).runId;
  const sessions=await Promise.all(clients.map(client=>client.rpc('start_training_workout',{target_program_id:source,target_workout_id:workout.id,target_planned_date:'2026-09-21'})));
  assert.equal(data(sessions[0]),data(sessions[1]),'Concurrent starts resume one atomic session');
  assert.equal(data(await admin.from('program_runs').select('id').eq('athlete_id',account.user.id)).length,1);
  assert.equal(data(await admin.from('workout_sessions').select('id').eq('athlete_id',account.user.id)).length,1);
  const feed=data(await clients[0].rpc('list_program_run_summaries',{status_scope:'active',page_limit:1}));
  assert.equal(feed[0].id,runId);assert.equal(feed[0].next_workout_status,'in_progress');
  assert.equal(feed[0].sort_date,'2026-09-21');
  console.log('Unified Training local API smoke passed: separate authenticated clients concurrently ensure/start one training and one session; active feed returns dated cursor and concrete progress.');
}finally{
  for(const client of clients)await client.auth.signOut();
  if(fixtureCreated){const removed=data(await admin.rpc('reset_test_population',{expected_namespace:namespace,expected_persona_keys:['owner']}));assert.equal(removed.removed,1,'Only this generated test persona is removed');}
}
