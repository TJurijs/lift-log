import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { validateMigrationTarget } from './lib/portable-migrations.mjs';
import { applyTemplateUpdate, inspectTemplateUpdate, templatePlanHash } from './lib/future-template-update.mjs';

const options = { apply: false };
for (const argument of process.argv.slice(2)) {
  if (argument === '--apply') options.apply = true;
  else if (argument.startsWith('--plan=')) options.plan = argument.slice(7);
  else if (argument.startsWith('--project-ref=')) options.projectRef = argument.slice(14);
  else if (argument.startsWith('--expected-plan-sha=')) options.expectedHash = argument.slice(20);
  else throw new Error(`Unknown template update argument: ${argument}`);
}
if (!options.plan || options.projectRef !== 'ofyeejyfroblunbspgve') {
  throw new Error('Supply a reviewed --plan file and --project-ref=ofyeejyfroblunbspgve. This operation is development-only.');
}
const binding = validateMigrationTarget(process.env.LIFTLOG_TEMPLATE_DATABASE_URL, 'nonprod', options.projectRef);
const plan = JSON.parse(await readFile(options.plan, 'utf8'));
const planSha = templatePlanHash(plan);
if (options.apply && options.expectedHash !== planSha) throw new Error('Applying requires the exact SHA-256 of the reviewed plan via --expected-plan-sha.');
const db = postgres(process.env.LIFTLOG_TEMPLATE_DATABASE_URL, { ssl: binding.ssl, max: 1, connect_timeout: 10, onnotice: () => {},
  connection: { default_transaction_read_only: options.apply ? 'off' : 'on', statement_timeout: 30000, lock_timeout: 10000, application_name: 'liftlog-reviewed-template-update' } });
try {
  const result = await db.begin(options.apply ? 'isolation level serializable' : 'read only', async (tx) => {
    if (options.apply) await tx`select pg_advisory_xact_lock(173528912, 20260910)`;
    return options.apply ? applyTemplateUpdate(tx, plan) : inspectTemplateUpdate(tx, plan);
  });
  console.log(JSON.stringify({ target: 'nonprod', projectRef: options.projectRef, planSha, mode: options.apply ? 'apply' : 'plan', ...result }, null, 2));
} finally { await db.end({ timeout: 2 }); }
