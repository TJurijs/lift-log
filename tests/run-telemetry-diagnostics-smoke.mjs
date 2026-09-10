import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import postgres from 'postgres';
import { assertLoopbackPostgresUrl } from '../scripts/lib/local-database-verification.mjs';

const url = process.env.LIFTLOG_TELEMETRY_SMOKE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
assertLoopbackPostgresUrl(url);
const db = postgres(url, { max: 1, connect_timeout: 5, onnotice: () => {} });
const release = randomUUID().replaceAll('-', '');
const ids = [];
try {
  const rows = await db`insert into private.client_telemetry_events (release_sha, environment, kind, payload)
    values (${release}, 'test', 'error', '{"category":"network","operation":"save","fatal":false,"retryable":true}'::jsonb)
    returning id`;
  ids.push(...rows.map((row) => row.id));
  const report = spawnSync(process.execPath, ['scripts/report-telemetry-diagnostics.mjs', '--environment=test',
    `--release=${release}`, '--max-error-events=1'],
  { cwd: new URL('../', import.meta.url), encoding: 'utf8', windowsHide: true, timeout: 15000,
    env: { ...process.env, LIFTLOG_TELEMETRY_DATABASE_URL: url }, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(report.status, 2, 'An actual threshold breach must return the alert exit code');
  const payload = JSON.parse(report.stdout);
  assert.deepEqual(payload.alerts, [{ release, alert: 'error-event-count' }]);
  assert.equal(payload.releases[0].error_events, 1);
  assert.equal(payload.releases[0].measured_operation_failure_rate, null);
  console.log('Telemetry diagnostic smoke passed: an isolated synthetic release produces its expected count and exit code 2, with no unsupported health claim.');
} finally {
  try {
    if (ids.length) await db`delete from private.client_telemetry_events where id in ${db(ids)} and release_sha = ${release}`;
  } finally { await db.end({ timeout: 2 }); }
}
