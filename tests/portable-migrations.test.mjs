import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  validateMigrationTarget, migrationStatements, loadMigrationManifest, planMigrations, applyMigrationPlan,
} from '../scripts/lib/portable-migrations.mjs';

test('portable migration destinations require exact project identity and session connections', () => {
  assert.equal(validateMigrationTarget('postgresql://postgres:x@127.0.0.1:54322/postgres').target, 'local');
  const ref = 'awdgjgziyrqdkybmlime';
  assert.equal(validateMigrationTarget(`postgresql://postgres:x@db.${ref}.supabase.co/postgres`, 'production', ref).ssl, 'require');
  assert.equal(validateMigrationTarget(`postgresql://postgres.${ref}:x@aws-0-eu-north-1.pooler.supabase.com:5432/postgres`, 'production', ref).ssl, 'require');
  for (const url of [
    'postgresql://postgres:x@unknown.example/postgres',
    'postgresql://postgres:x@db.ofyeejyfroblunbspgve.supabase.co/postgres',
    `postgresql://postgres.${ref}:x@aws-0-eu-north-1.pooler.supabase.com:6543/postgres`,
    `postgresql://postgres:x@db.${ref}.supabase.co/postgres?sslmode=disable`,
  ]) assert.throws(() => validateMigrationTarget(url, 'production', ref));
  assert.throws(() => validateMigrationTarget(`postgresql://postgres:x@db.${ref}.supabase.co/postgres`));
  assert.throws(() => validateMigrationTarget('postgresql://postgres:x@localhost/postgres', 'production', ref));
});

test('outer SQL transactions are replaced without splitting function bodies or quoted semicolons', () => {
  const sql = "-- rollout\nbegin;\ncreate function test() returns void language plpgsql as $fn$ begin perform ';'; end; $fn$;\nselect 'it''s; fine'; /* nested /* ; */ comment */ commit;";
  const statements = migrationStatements(sql);
  assert.equal(statements.length, 2);
  assert.match(statements[0], /begin perform ';'; end;/);
  assert.match(statements[1], /it''s; fine/);
  assert.throws(() => migrationStatements("select 'unterminated"));
});

test('every reviewed operational skip is hash-pinned and original migration files stay intact', async () => {
  const registry = JSON.parse(await readFile(new URL('../supabase/operational-migrations.json', import.meta.url), 'utf8'));
  const manifest = await loadMigrationManifest(new URL('../supabase/migrations/', import.meta.url), registry);
  const skips = manifest.filter((entry) => entry.action !== 'apply');
  assert.equal(skips.length, 11);
  assert.ok(skips.every((entry) => entry.reason && entry.prerequisites.length));
  assert.match(skips.find((entry) => entry.version === '202609030002').source, /Expected exactly 12/);
  assert.match(skips.find((entry) => entry.version === '202609030003').source, /Expected exactly 23/);
  for (const entry of manifest) assert.doesNotThrow(() => migrationStatements(entry.source), entry.file);
  const plan = planMigrations(manifest, [{ version: manifest[0].version }]);
  assert.equal(plan.length, manifest.length - 1);
  assert.throws(() => planMigrations(manifest, [{ version: '999999999999' }]));
  assert.throws(() => planMigrations(manifest, [{ version: manifest[1].version }]), /missing schema migration/);
  assert.throws(() => planMigrations(manifest, [], [{ version: manifest[0].version, source_sha256: 'changed' }]));
  await assert.rejects(loadMigrationManifest(new URL('../supabase/migrations/', import.meta.url),
    [{ ...registry[0], sha256: 'changed' }, ...registry.slice(1)]), /changed/);
});

test('an operational skip checks schema prerequisites and records a receipt without executing its SQL', async () => {
  const calls = [];
  const tx = async (parts, ...values) => {
    calls.push({ sql: parts.join('?'), values });
    if (parts.join('').includes('to_regclass')) return [{ relation: 'public.programs' }];
    return [];
  };
  tx.unsafe = async (sql) => { calls.push({ sql }); return []; };
  const entry = { version: '1', name: 'operation', sha256: 'reviewed', source: 'delete from public.programs;',
    action: 'skip-historical-development-operation', reason: 'Dev-only operation', prerequisites: ['public.programs'] };
  await applyMigrationPlan({ begin: async (work) => work(tx) }, [entry], { target: 'local', projectRef: null });
  assert.ok(calls.some((call) => call.sql.includes('to_regclass')));
  assert.ok(calls.some((call) => call.sql.includes('liftlog_migration_receipts') && call.values));
  assert.ok(!calls.some((call) => call.sql.includes('delete from public.programs')));
});
