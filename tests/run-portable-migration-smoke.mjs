import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { assertLoopbackPostgresUrl } from '../scripts/lib/local-database-verification.mjs';
import { loadMigrationManifest, migrationStatements, planMigrations, inspectMigrationHistory, applyMigrationPlan } from '../scripts/lib/portable-migrations.mjs';

const databaseUrl = process.env.LIFTLOG_PORTABLE_SMOKE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const target = assertLoopbackPostgresUrl(databaseUrl);
if (target.pathname !== '/postgres' || target.port !== '54322') {
  throw new Error('The portability rehearsal requires the local Supabase postgres database on port 54322.');
}
// A separate, uniquely named database exercises a complete historical replay
// without resetting, changing or seeding the developer's existing app database.
const databaseName = `liftlog_migration_review_${randomUUID().replaceAll('-', '')}`;
const db = postgres(databaseUrl, { max: 1, connect_timeout: 5, onnotice: () => {} });
let rehearsal;
let created = false;
try {
  const registry = JSON.parse(await readFile(new URL('../supabase/operational-migrations.json', import.meta.url), 'utf8'));
  const manifest = await loadMigrationManifest(new URL('../supabase/migrations/', import.meta.url), registry);
  const authDump = execFileSync('docker', ['exec', 'supabase_db_lift-log-app', 'pg_dump', '-U', 'postgres',
    '-d', 'postgres', '--schema-only', '--schema=auth', '--no-owner', '--no-privileges', '--no-comments'],
  { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  // psql's restrict/unrestrict meta-commands are not SQL. The sole public
  // dependency in the auth dump is the app trigger recreated by migration 1.
  const authStatements = migrationStatements(authDump.replace(/^\\(?:un)?restrict[^\r\n]*$/gm, ''))
    .filter((sql) => !/CREATE TRIGGER[\s\S]*public\.handle_new_user\(\)/i.test(sql));
  await db.unsafe(`create database "${databaseName}" template template0`);
  created = true;
  target.pathname = `/${databaseName}`;
  rehearsal = postgres(target.toString(), { max: 1, connect_timeout: 5, onnotice: () => {},
    connection: { statement_timeout: 120000 } });
  await rehearsal.unsafe('create schema extensions; create extension pgcrypto with schema extensions');
  for (const sql of authStatements) await rehearsal.unsafe(sql);
  // This is deliberately the email used by the historical cleanup. It exists
  // before schema creation, has different IDs/data, and must survive promotion.
  const owner = randomUUID();
  await rehearsal`insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
    values (${owner}::uuid, 'toyurit@gmail.com', '{}'::jsonb,
      '{"given_name":"Portable","family_name":"Existing account"}'::jsonb)`;
  const boundary = '202609020003';
  await applyMigrationPlan(rehearsal, planMigrations(manifest, [], [], boundary), { target: 'local', projectRef: null });
  const before = await inspectMigrationHistory(rehearsal);
  const remaining = planMigrations(manifest, before.history, before.receipts);
  assert.ok(remaining.some((entry) => entry.version === '202609030002' && entry.action !== 'apply'));
  await applyMigrationPlan(rehearsal, remaining, { target: 'local', projectRef: null });
  const [survivor] = await rehearsal`select id from auth.users where email = 'toyurit@gmail.com'`;
  assert.equal(survivor.id, owner);
  const [unexpected] = await rehearsal`select count(*)::integer as count from public.programs where title = 'Elina — General Fitness'`;
  assert.equal(unexpected.count, 0);
  const after = await inspectMigrationHistory(rehearsal);
  assert.equal(after.history.length, manifest.length);
  assert.equal(planMigrations(manifest, after.history, after.receipts).length, 0);
  const skips = await rehearsal`select version from supabase_migrations.liftlog_migration_receipts
    where action = 'skip-historical-development-operation'`;
  assert.equal(skips.length, registry.length);
  console.log(`Portable promotion smoke passed: all ${manifest.length} migrations replayed in an isolated database; ${skips.length} reviewed dev operations skipped; preexisting real-email account retained; second promotion is a no-op.`);
} finally {
  if (rehearsal) await rehearsal.end({ timeout: 2 });
  try {
    if (created) {
      assert.match(databaseName, /^liftlog_migration_review_[a-f0-9]{32}$/);
      await db.unsafe(`drop database "${databaseName}"`);
    }
  } finally { await db.end({ timeout: 2 }); }
}
