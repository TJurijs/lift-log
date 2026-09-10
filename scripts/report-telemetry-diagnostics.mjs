import postgres from 'postgres';
import { validateMigrationTarget } from './lib/portable-migrations.mjs';
import { evaluateTelemetry } from './lib/telemetry-diagnostics.mjs';

const options = { target: 'local', windowMinutes: 60, maxErrorEvents: 10, maxFailureRate: 0.05, minOperationSamples: 20 };
for (const argument of process.argv.slice(2)) {
  if (argument.startsWith('--target=')) options.target = argument.slice(9);
  else if (argument.startsWith('--project-ref=')) options.projectRef = argument.slice(14);
  else if (argument.startsWith('--environment=')) options.environment = argument.slice(14);
  else if (argument.startsWith('--release=')) options.release = argument.slice(10);
  else if (argument.startsWith('--window-minutes=')) options.windowMinutes = Number(argument.slice(17));
  else if (argument.startsWith('--max-error-events=')) options.maxErrorEvents = Number(argument.slice(19));
  else if (argument.startsWith('--max-failure-rate=')) options.maxFailureRate = Number(argument.slice(19));
  else if (argument.startsWith('--min-operation-samples=')) options.minOperationSamples = Number(argument.slice(24));
  else throw new Error(`Unknown telemetry report argument: ${argument}`);
}
if (!Number.isInteger(options.windowMinutes) || options.windowMinutes < 1 || options.windowMinutes > 10080) {
  throw new Error('Telemetry report windows must be 1 to 10080 minutes.');
}
options.environment ??= options.target === 'nonprod' ? 'development' : options.target === 'production' ? 'production' : 'local';
if (!['local', 'development', 'production', 'test'].includes(options.environment)) throw new Error('Invalid telemetry environment.');
if (options.release && !/^(?:[a-f0-9]{7,40}|local|development|test)$/.test(options.release)) throw new Error('Invalid release selector.');
evaluateTelemetry([], options);
const databaseUrl = process.env.LIFTLOG_TELEMETRY_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const binding = validateMigrationTarget(databaseUrl, options.target, options.projectRef);
const db = postgres(databaseUrl, { ssl: binding.ssl, max: 1, connect_timeout: 8, onnotice: () => {},
  connection: { default_transaction_read_only: 'on', statement_timeout: 15000, application_name: 'liftlog-telemetry-report' } });
try {
  const rows = await db`select release_sha,
    count(*) filter (where kind = 'error')::integer as error_events,
    count(*) filter (where kind = 'error' and payload->>'fatal' = 'true')::integer as fatal_errors,
    count(*) filter (where kind = 'performance' and payload->>'outcome' in ('success','failure'))::integer as operation_samples,
    count(*) filter (where kind = 'performance' and payload->>'outcome' = 'failure')::integer as operation_failures,
    percentile_cont(0.95) within group (order by (payload->>'durationMs')::numeric)
      filter (where kind = 'performance') as duration_p95_ms
    from private.client_telemetry_events
    where recorded_at >= clock_timestamp() - (${options.windowMinutes}::integer * interval '1 minute')
      and environment = ${options.environment}
      and (${options.release ?? null}::text is null or release_sha = ${options.release ?? null})
    group by release_sha order by release_sha`;
  const operations = await db`select release_sha, coalesce(payload->>'operation', payload->>'name') as operation,
      count(*) filter (where kind = 'error')::integer as error_events,
      count(*) filter (where kind = 'performance' and payload->>'outcome' in ('success','failure'))::integer as operation_samples,
      count(*) filter (where kind = 'performance' and payload->>'outcome' = 'failure')::integer as operation_failures
    from private.client_telemetry_events
    where recorded_at >= clock_timestamp() - (${options.windowMinutes}::integer * interval '1 minute')
      and environment = ${options.environment}
      and (${options.release ?? null}::text is null or release_sha = ${options.release ?? null})
    group by release_sha, coalesce(payload->>'operation', payload->>'name') order by 1, 2`;
  const [expired] = await db`select count(*)::integer as count from private.client_telemetry_events
    where recorded_at < clock_timestamp() - interval '7 days 15 minutes'`;
  const [cron] = await db`select to_regclass('cron.job') as jobs`;
  let retentionJobActive = false;
  if (cron.jobs) {
    const [job] = await db`select exists(select 1 from cron.job
      where jobname = 'liftlog-client-telemetry-retention' and active) as active`;
    retentionJobActive = job.active;
  }
  const releases = evaluateTelemetry(rows, options);
  const alerts = releases.flatMap((row) => row.alerts.map((alert) => ({ release: row.release_sha, alert })));
  if (!retentionJobActive) alerts.push({ alert: 'retention-job-inactive' });
  if (expired.count > 0) alerts.push({ alert: 'expired-telemetry-not-pruned', count: expired.count });
  console.log(JSON.stringify({ target: binding.target, projectRef: binding.projectRef, environment: options.environment,
    windowMinutes: options.windowMinutes, thresholds: { maxErrorEvents: options.maxErrorEvents,
      maxFailureRate: options.maxFailureRate, minOperationSamples: options.minOperationSamples },
    releases, operations, retentionJobActive, alerts,
    interpretation: 'Failure rate uses reported performance outcomes only; error envelopes are counted separately. No samples is not evidence of health. Authenticated, rate-limited sampling does not measure all users or traffic.' }, null, 2));
  if (alerts.length) process.exitCode = 2;
} finally { await db.end({ timeout: 2 }); }
