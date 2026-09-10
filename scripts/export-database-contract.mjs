import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import postgres from 'postgres';
import { assertLoopbackPostgresUrl } from './lib/local-database-verification.mjs';
import { loadMigrationManifest } from './lib/portable-migrations.mjs';

let output = 'artifacts/database-contract';
for (const argument of process.argv.slice(2)) {
  if (argument.startsWith('--output=')) output = argument.slice(9);
  else throw new Error(`Unknown database contract argument: ${argument}`);
}
const artifactRoot = resolve('artifacts');
const directory = resolve(output);
const destination = relative(artifactRoot, directory);
if (!destination || destination.startsWith('..') || isAbsolute(destination)) throw new Error('Contract output must be a directory below artifacts/.');
const databaseUrl = process.env.LIFTLOG_CONTRACT_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const target = assertLoopbackPostgresUrl(databaseUrl);
if (target.pathname !== '/postgres' || target.port !== '54322') {
  throw new Error('The contract dump targets the local Supabase postgres database on port 54322.');
}
const db = postgres(databaseUrl, { max: 1, connect_timeout: 5, onnotice: () => {},
  connection: { default_transaction_read_only: 'on', statement_timeout: 30000 } });
try {
  const registry = JSON.parse(await readFile(new URL('../supabase/operational-migrations.json', import.meta.url), 'utf8'));
  const manifest = await loadMigrationManifest(new URL('../supabase/migrations/', import.meta.url), registry);
  const functions = await db`select namespace.nspname as schema, routine.proname as name,
      pg_get_function_identity_arguments(routine.oid) as arguments,
      pg_get_function_result(routine.oid) as result,
      routine.prosecdef as security_definer, routine.proconfig as configuration,
      has_function_privilege('anon', routine.oid, 'execute') as anon_execute,
      has_function_privilege('authenticated', routine.oid, 'execute') as authenticated_execute,
      has_function_privilege('service_role', routine.oid, 'execute') as service_role_execute,
      pg_get_functiondef(routine.oid) as definition
    from pg_proc routine join pg_namespace namespace on namespace.oid = routine.pronamespace
    where namespace.nspname in ('public', 'private') and routine.prokind = 'f'
    order by namespace.nspname, routine.proname, pg_get_function_identity_arguments(routine.oid)`;
  const tables = await db`select table_schema, table_name, column_name, ordinal_position,
      data_type, udt_schema, udt_name, is_nullable, column_default
    from information_schema.columns where table_schema in ('public', 'private')
    order by table_schema, table_name, ordinal_position`;
  const policies = await db`select * from pg_policies where schemaname in ('public', 'private') order by schemaname, tablename, policyname`;
  const constraints = await db`select namespace.nspname as schema, relation.relname as table_name,
      constraint_row.conname as name, pg_get_constraintdef(constraint_row.oid) as definition
    from pg_constraint constraint_row join pg_class relation on relation.oid = constraint_row.conrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('public', 'private') order by 1, 2, 3`;
  const triggers = await db`select namespace.nspname as schema, relation.relname as table_name,
      trigger_row.tgname as name, pg_get_triggerdef(trigger_row.oid) as definition, trigger_row.tgenabled as enabled
    from pg_trigger trigger_row join pg_class relation on relation.oid = trigger_row.tgrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('public', 'private') and not trigger_row.tgisinternal order by 1, 2, 3`;
  const grants = await db`select namespace.nspname as schema, relation.relname as table_name,
      relation.relrowsecurity as rls_enabled, role_name,
      has_table_privilege(role_name, relation.oid, 'SELECT') as can_select,
      has_table_privilege(role_name, relation.oid, 'INSERT') as can_insert,
      has_table_privilege(role_name, relation.oid, 'UPDATE') as can_update,
      has_table_privilege(role_name, relation.oid, 'DELETE') as can_delete
    from pg_class relation join pg_namespace namespace on namespace.oid = relation.relnamespace
    cross join unnest(array['anon','authenticated','service_role']) role_name
    where namespace.nspname in ('public', 'private') and relation.relkind in ('r','p','v') order by 1, 2, 4`;
  const history = await db`select version, name from supabase_migrations.schema_migrations order by version`;
  await mkdir(directory, { recursive: true });
  const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(resolve(directory, 'schema.json'), json({ tables, policies, constraints, triggers, grants }));
  await writeFile(resolve(directory, 'rpc-permissions.json'), json(functions.map((entry) => {
    const permission = { ...entry };
    delete permission.definition;
    return permission;
  })));
  await writeFile(resolve(directory, 'effective-functions.sql'), functions.map((entry) => `${entry.definition};`).join('\n\n'));
  await writeFile(resolve(directory, 'migration-manifest.json'), json({ history,
    source: manifest.map(({ file, version, sha256, action, reason }) => ({ file, version, sha256, action, reason })) }));
  // The local CLI's own pg_dump runs in its matching Postgres container. No
  // credentials are passed in argv and no user rows are exported.
  const dump = execFileSync('docker', ['exec', 'supabase_db_lift-log-app', 'pg_dump',
    '-U', 'postgres', '-d', 'postgres', '--schema-only', '--schema=public', '--schema=private', '--no-owner'],
  { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 20 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  await writeFile(resolve(directory, 'schema.sql'), dump);
  console.log(`Exported ${functions.length} effective functions, ${grants.length / 3} relation permissions and ${history.length} applied migrations to ${directory}.`);
} finally { await db.end({ timeout: 2 }); }
