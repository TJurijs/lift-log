import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { assertLoopbackPostgresUrl } from './lib/local-database-verification.mjs';

const databaseUrl = process.env.LIFTLOG_RECOVERY_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const url = assertLoopbackPostgresUrl(databaseUrl);
if (url.pathname !== '/postgres' || url.port !== '54322') throw new Error('Recovery rehearsal requires the standard local Supabase database on port 54322.');
if (process.argv.length > 2) throw new Error('This rehearsal is local-only and accepts no target overrides.');
const token = randomUUID().replaceAll('-', '');
const databaseName = `liftlog_recovery_review_${token}`;
const directory = resolve('artifacts', 'recovery', token);
const db = postgres(databaseUrl, { max: 1, connect_timeout: 5, onnotice: () => {},
  connection: { application_name: 'liftlog-recovery-rehearsal' } });
let restored;
let created = false;
const started = Date.now();
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function inspect(connection) {
  const tables = await connection`select namespace.nspname as schema, relation.relname as name,
      relation.relrowsecurity as rls_enabled, relation.relforcerowsecurity as rls_forced
    from pg_class relation join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('auth','public','private','supabase_migrations')
      and relation.relkind = 'r' order by 1, 2`;
  const counts = [];
  for (const table of tables) {
    const [row] = await connection`select count(*)::text as count from ${connection(`${table.schema}.${table.name}`)}`;
    counts.push({ ...table, count: row.count });
  }
  const constraints = await connection`select namespace.nspname as schema, relation.relname as table_name,
      constraint_row.conname as name, constraint_row.convalidated as validated,
      pg_get_constraintdef(constraint_row.oid) as definition
    from pg_constraint constraint_row join pg_class relation on relation.oid = constraint_row.conrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('auth','public','private','supabase_migrations') order by 1, 2, 3`;
  const routines = await connection`select namespace.nspname as schema, routine.proname as name,
      pg_get_function_identity_arguments(routine.oid) as arguments, pg_get_functiondef(routine.oid) as definition,
      has_function_privilege('anon', routine.oid, 'execute') as anon_execute,
      has_function_privilege('authenticated', routine.oid, 'execute') as authenticated_execute,
      has_function_privilege('service_role', routine.oid, 'execute') as service_execute
    from pg_proc routine join pg_namespace namespace on namespace.oid = routine.pronamespace
    where namespace.nspname in ('public','private') and routine.prokind = 'f' order by 1, 2, 3`;
  const policies = await connection`select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    from pg_policies where schemaname in ('public','private') order by 1, 2, 3`;
  const triggers = await connection`select namespace.nspname as schema, relation.relname as table_name,
      trigger_row.tgname as name, trigger_row.tgenabled as enabled, pg_get_triggerdef(trigger_row.oid) as definition
    from pg_trigger trigger_row join pg_class relation on relation.oid = trigger_row.tgrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('public','private') and not trigger_row.tgisinternal order by 1, 2, 3`;
  return { counts, constraints, routines, policies, triggers };
}

try {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let archive;
  const expected = await db.begin('isolation level repeatable read read only', async (tx) => {
    const [{ snapshot }] = await tx`select pg_export_snapshot() as snapshot`;
    // pg_dump and expected row counts share exactly one MVCC snapshot, so
    // concurrent browser use cannot produce false count differences.
    archive = execFileSync('docker', ['exec', 'supabase_db_lift-log-app', 'pg_dump', '-U', 'postgres',
      '-d', 'postgres', '--format=custom', `--snapshot=${snapshot}`, '--schema=auth', '--schema=public',
      '--schema=private', '--schema=supabase_migrations'],
    { windowsHide: true, timeout: 120000, maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    return inspect(tx);
  });
  await writeFile(resolve(directory, 'database.dump'), archive, { mode: 0o600 });
  const backupMs = Date.now() - started;
  await db.unsafe(`create database "${databaseName}" template template0`);
  created = true;
  url.pathname = `/${databaseName}`;
  restored = postgres(url.toString(), { max: 1, connect_timeout: 5, onnotice: () => {} });
  // Only this freshly created disposable database is initialized. Application,
  // Auth and migration-history objects/data come from the actual archive.
  await restored.unsafe('drop schema public; create schema extensions; create extension pgcrypto with schema extensions');
  const restoreListPath = `/tmp/liftlog-recovery-${token}.list`;
  try {
    // Provider-owned future-object default privileges require platform-admin
    // membership. Omit only those templates; preserve every current object ACL,
    // including the app's authenticated/anonymous RPC boundaries checked below.
    const listing = execFileSync('docker', ['exec', '-i', 'supabase_db_lift-log-app', 'pg_restore', '--list'],
      { input: archive, encoding: 'utf8', windowsHide: true, timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] });
    const restoreList = listing.split('\n').filter((line) => !line.includes(' DEFAULT ACL ')).join('\n');
    execFileSync('docker', ['exec', '-i', 'supabase_db_lift-log-app', 'tee', restoreListPath],
      { input: restoreList, windowsHide: true, timeout: 10000, stdio: ['pipe', 'ignore', 'pipe'] });
    execFileSync('docker', ['exec', '-i', 'supabase_db_lift-log-app', 'pg_restore', '-U', 'postgres',
      '--dbname', databaseName, '--no-owner', '--exit-on-error', '--use-list', restoreListPath],
    { input: archive, windowsHide: true, timeout: 120000, maxBuffer: 16 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (error) {
    await writeFile(resolve(directory, 'restore-error.log'), error.stderr ?? String(error), { mode: 0o600 });
    throw new Error('Local archive restore failed. The original database was not changed; the private archive was retained for investigation.');
  } finally {
    assert.match(restoreListPath, /^\/tmp\/liftlog-recovery-[a-f0-9]{32}\.list$/);
    execFileSync('docker', ['exec', 'supabase_db_lift-log-app', 'rm', '-f', restoreListPath],
      { windowsHide: true, timeout: 10000, stdio: ['ignore', 'ignore', 'pipe'] });
  }
  const actual = await inspect(restored);
  for (const category of Object.keys(expected)) {
    assert.deepEqual(actual[category], expected[category], `Restored ${category} differ from the backup snapshot`);
  }
  assert.ok(actual.constraints.every((row) => row.validated), 'A restored constraint is not validated');
  const report = { passed: true, source: 'isolated local Supabase', originalDatabaseModified: false,
    archiveSha256: createHash('sha256').update(archive).digest('hex'), archiveBytes: archive.length,
    backupMs, totalRehearsalMs: Date.now() - started,
    verified: { tables: actual.counts.length, rows: actual.counts.reduce((total, row) => total + Number(row.count), 0),
      constraints: actual.constraints.length, functions: actual.routines.length, policies: actual.policies.length, triggers: actual.triggers.length },
    schemaAndDataCountDigest: digest(actual),
    limitation: 'Local logical application/Auth restore rehearsal only. Does not prove hosted backup, PITR, OAuth provider configuration, storage objects, secrets, provider-owned default privilege templates or cron-job restoration.' };
  await writeFile(resolve(directory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, reportPath: resolve(directory, 'report.json') }, null, 2));
} finally {
  if (restored) await restored.end({ timeout: 2 });
  try {
    if (created) {
      assert.match(databaseName, /^liftlog_recovery_review_[a-f0-9]{32}$/);
      await db.unsafe(`drop database "${databaseName}"`);
    }
  } finally { await db.end({ timeout: 2 }); }
}
