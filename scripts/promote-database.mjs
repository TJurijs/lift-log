import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import {
  validateMigrationTarget, loadMigrationManifest, planMigrations,
  inspectMigrationHistory, applyMigrationPlan,
} from './lib/portable-migrations.mjs';

const options = { target: 'local', apply: false, acknowledgeSkips: false };
for (const argument of process.argv.slice(2)) {
  if (argument === '--apply') options.apply = true;
  else if (argument === '--acknowledge-operational-skips') options.acknowledgeSkips = true;
  else if (argument.startsWith('--target=')) options.target = argument.slice(9);
  else if (argument.startsWith('--project-ref=')) options.projectRef = argument.slice(14);
  else if (argument.startsWith('--through=')) options.through = argument.slice(10);
  else if (argument === '--help') {
    console.log('Usage: node scripts/promote-database.mjs [--target=local|nonprod|production] [--project-ref=exact-ref] [--through=version] [--apply --acknowledge-operational-skips]\nConnection: LIFTLOG_MIGRATION_DATABASE_URL (defaults to loopback only). Without --apply this prints a read-only plan.');
    process.exit(0);
  } else throw new Error(`Unknown migration argument: ${argument}`);
}
const databaseUrl = process.env.LIFTLOG_MIGRATION_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const binding = validateMigrationTarget(databaseUrl, options.target, options.projectRef);
const registry = JSON.parse(await readFile(new URL('../supabase/operational-migrations.json', import.meta.url), 'utf8'));
const manifest = await loadMigrationManifest(new URL('../supabase/migrations/', import.meta.url), registry);
const db = postgres(databaseUrl, {
  ssl: binding.ssl, max: 1, connect_timeout: 8, onnotice: () => {},
  connection: { application_name: 'liftlog-portable-migrations', statement_timeout: 120000, lock_timeout: 10000 },
});
try {
  // A session-level advisory lock covers the entire chain, including history
  // inspection; individual SQL+receipt transactions remain independently atomic.
  if (options.apply) await db`select pg_advisory_lock(173528912, 20260907)`;
  const { history, receipts } = await inspectMigrationHistory(db);
  const plan = planMigrations(manifest, history, receipts, options.through);
  console.log(JSON.stringify({ target: binding.target, projectRef: binding.projectRef,
    mode: options.apply ? 'apply' : 'plan', appliedCount: history.length,
    pending: plan.map(({ file, sha256, action, reason }) => ({ file, sha256, action, reason })),
  }, null, 2));
  if (options.apply) {
    if (plan.some((entry) => entry.action !== 'apply') && !options.acknowledgeSkips) {
      throw new Error('Review the listed historical data-operation skips, then pass --acknowledge-operational-skips.');
    }
    await applyMigrationPlan(db, plan, binding);
    await db`select pg_notify('pgrst', 'reload schema')`;
    console.log(`Applied ${plan.length} migration history entries atomically, preserving existing history.`);
  }
} finally {
  await db.end({ timeout: 2 });
}
