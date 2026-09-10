import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { assertLoopbackPostgresUrl } from '../scripts/lib/local-database-verification.mjs';

const url = process.env.LIFTLOG_TELEMETRY_SMOKE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
assertLoopbackPostgresUrl(url);
const db = postgres(url, { max: 1, connect_timeout: 5, onnotice: () => {} });
const actor = randomUUID();
const envelope = { schemaVersion: 1, releaseSha: 'abc1234', environment: 'test',
  recordedAt: '2000-01-01T00:00:00.000Z', kind: 'error',
  payload: { category: 'network', operation: 'save', fatal: false, retryable: true } };
async function rejects(work, pattern) {
  await db.unsafe('savepoint expected_rejection');
  try { await assert.rejects(work, pattern); }
  finally { await db.unsafe('rollback to savepoint expected_rejection'); }
}
try {
  await db.unsafe('begin');
  await db`insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
    values (${actor}::uuid, ${`telemetry-${actor}@example.test`}, '{}'::jsonb, '{}'::jsonb)`;
  const [expired] = await db`insert into private.client_telemetry_events
    (recorded_at, release_sha, environment, kind, payload)
    values (now() - interval '8 days', 'abc1234', 'test', 'error', '{}'::jsonb) returning id`;
  const [permissions] = await db`select
    has_function_privilege('anon','public.collect_client_telemetry(jsonb)','execute') as anon,
    has_table_privilege('authenticated','private.client_telemetry_events','select') as client_read,
    has_table_privilege('authenticated','private.client_telemetry_events','insert') as client_write,
    has_schema_privilege('service_role','private','usage') as service_usage`;
  assert.deepEqual({ ...permissions }, { anon: false, client_read: false, client_write: false, service_usage: true });
  await db`select set_config('request.jwt.claim.sub', ${actor}, true)`;
  await db.unsafe('set local role authenticated');
  await rejects(() => db`select public.collect_client_telemetry(${db.json([{ ...envelope, email: 'private@example.test' }])}::jsonb)`, /unsupported fields/);
  await rejects(() => db`select public.collect_client_telemetry(${db.json([{ ...envelope,
    payload: { ...envelope.payload, message: 'free text must never be persisted' } }])}::jsonb)`, /Invalid telemetry error/);
  await rejects(() => db`select public.collect_client_telemetry(${db.json(Array(11).fill(envelope))}::jsonb)`, /1 to 10/);
  await rejects(() => db`select public.collect_client_telemetry(${db.json([{ ...envelope, kind: 'performance',
    payload: { name: 'save', durationMs: -1 } }])}::jsonb)`, /Invalid telemetry duration/);
  const [first] = await db`select public.collect_client_telemetry(${db.json(Array(10).fill(envelope))}::jsonb) as result`;
  assert.deepEqual(first.result, { accepted: 10, rateLimited: false });
  const performance = { ...envelope, kind: 'performance', payload: { name: 'save', durationMs: 25,
    requestCount: 1, retries: 0, roleBucket: 'athlete', cardinalityBucket: '1-10', phase: 'repository', outcome: 'success' } };
  const [second] = await db`select public.collect_client_telemetry(${db.json(Array(10).fill(performance))}::jsonb) as result`;
  assert.deepEqual(second.result, { accepted: 10, rateLimited: false });
  const [limited] = await db`select public.collect_client_telemetry(${db.json([envelope])}::jsonb) as result`;
  assert.deepEqual(limited.result, { accepted: 0, rateLimited: true });
  await rejects(() => db`select * from private.client_telemetry_events`, /permission denied/);
  await db.unsafe('reset role');
  assert.equal((await db`select id from private.client_telemetry_events where id = ${expired.id}`).length, 0);
  const [saved] = await db`select count(*)::integer as count,
    bool_and(recorded_at >= transaction_timestamp()) as server_time
    from private.client_telemetry_events where id > ${expired.id}`;
  assert.equal(saved.count, 20);
  assert.equal(saved.server_time, true);
  await db.unsafe('set local role service_role');
  assert.ok((await db`select count(*) from private.client_telemetry_events`).length);
  await db.unsafe('reset role');
  assert.equal((await db`select * from cron.job where jobname = 'liftlog-client-telemetry-retention' and active`).length, 1);
  console.log('Telemetry SQL smoke passed: strict field/privacy validation, batch/rate limits, no direct client reads/writes, server time and scheduled seven-day retention.');
} finally {
  try { await db.unsafe('rollback'); } finally { await db.end({ timeout: 2 }); }
}
