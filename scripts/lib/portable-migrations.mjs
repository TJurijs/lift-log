import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_REFS = Object.freeze({
  nonprod: 'ofyeejyfroblunbspgve',
  production: 'awdgjgziyrqdkybmlime',
});

export function validateMigrationTarget(rawUrl, target = 'local', projectRef) {
  const url = new URL(rawUrl);
  if (!/^postgres(?:ql)?:$/.test(url.protocol) || url.pathname !== '/postgres') {
    throw new Error('Expected a PostgreSQL connection to the postgres database.');
  }
  if (target === 'local') {
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || projectRef) {
      throw new Error('Local migrations require a loopback database and no project ref.');
    }
  } else {
    if (!PROJECT_REFS[target] || projectRef !== PROJECT_REFS[target]) {
      throw new Error('Hosted migrations require an explicit target and its exact project ref.');
    }
    const direct = url.hostname === `db.${projectRef}.supabase.co` && decodeURIComponent(url.username) === 'postgres';
    const pooler = url.hostname.endsWith('.pooler.supabase.com') && decodeURIComponent(url.username) === `postgres.${projectRef}`;
    if (!direct && !pooler) throw new Error('Database connection does not match the explicitly selected Supabase project.');
    if (pooler && url.port !== '5432') throw new Error('Migrations require a direct connection or the session pooler on port 5432.');
    if (url.searchParams.has('sslmode') && url.searchParams.get('sslmode') !== 'require') {
      throw new Error('Hosted database connections require TLS.');
    }
  }
  return { target, projectRef: projectRef ?? null, ssl: target === 'local' ? false : 'require' };
}

// SQL-aware splitting keeps BEGIN/COMMIT inside dollar-quoted functions and
// comments intact. Only the historical outer transaction wrappers are removed;
// the runner supplies one atomic transaction for SQL and its history receipt.
export function migrationStatements(source) {
  const statements = [];
  let start = 0;
  let quote = null;
  let dollar = null;
  let commentDepth = 0;
  let lineComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) { if (char === '\n') lineComment = false; continue; }
    if (commentDepth) {
      if (char === '/' && next === '*') { commentDepth += 1; index += 1; }
      else if (char === '*' && next === '/') { commentDepth -= 1; index += 1; }
      continue;
    }
    if (dollar) {
      if (source.startsWith(dollar, index)) { index += dollar.length - 1; dollar = null; }
      continue;
    }
    if (quote) {
      if (char === quote && next === quote) { index += 1; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '-' && next === '-') { lineComment = true; index += 1; continue; }
    if (char === '/' && next === '*') { commentDepth = 1; index += 1; continue; }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (char === '$') {
      const marker = source.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (marker) { dollar = marker; index += marker.length - 1; continue; }
    }
    if (char === ';') { statements.push(source.slice(start, index + 1)); start = index + 1; }
  }
  if (quote || dollar || commentDepth) throw new Error('Unterminated SQL quote or comment.');
  if (source.slice(start).trim()) statements.push(source.slice(start));
  const withoutComments = (sql) => {
    let value = sql.trim();
    while (value.startsWith('--') || value.startsWith('/*')) {
      if (value.startsWith('--')) {
        const end = value.indexOf('\n');
        value = end < 0 ? '' : value.slice(end + 1).trim();
      } else {
        let depth = 1;
        let end = 2;
        for (; end < value.length && depth; end += 1) {
          if (value.slice(end, end + 2) === '/*') { depth += 1; end += 1; }
          else if (value.slice(end, end + 2) === '*/') { depth -= 1; end += 1; }
        }
        value = value.slice(end).trim();
      }
    }
    return value;
  };
  return statements.filter((sql) => {
    const command = withoutComments(sql);
    if (!command) return false;
    if (/^(?:begin(?:\s+transaction)?|commit|end)\s*;?$/i.test(command)) return false;
    if (/^(?:rollback|start\s+transaction|commit\s|begin\s)/i.test(command)) {
      throw new Error('Unsupported top-level transaction control in migration.');
    }
    return true;
  });
}

export async function loadMigrationManifest(directory, operationalRegistry) {
  if (directory instanceof URL) directory = fileURLToPath(directory);
  const files = (await readdir(directory)).filter((file) => /^\d+_.+\.sql$/.test(file)).sort();
  const manifest = [];
  const versions = new Set();
  for (const file of files) {
    const [, version, name] = file.match(/^(\d+)_(.+)\.sql$/);
    if (versions.has(version)) throw new Error(`Duplicate migration version: ${version}`);
    versions.add(version);
    const source = await readFile(join(directory, file), 'utf8');
    // Normalize transport line endings, not the content of historical SQL.
    const sha256 = createHash('sha256').update(source.replace(/\r\n/g, '\n')).digest('hex');
    const operational = operationalRegistry.find((entry) => entry.file === file);
    if (operational && operational.sha256 !== sha256) {
      throw new Error(`Reviewed operational migration changed: ${file}`);
    }
    manifest.push({ version, name, file, sha256, source,
      action: operational ? 'skip-historical-development-operation' : 'apply',
      reason: operational?.reason ?? null,
      prerequisites: operational?.prerequisites ?? [],
    });
  }
  for (const entry of operationalRegistry) {
    if (!files.includes(entry.file)) throw new Error(`Registered operational migration is missing: ${entry.file}`);
  }
  return manifest;
}

export function planMigrations(manifest, history, receipts = [], through) {
  const local = new Map(manifest.map((entry) => [entry.version, entry]));
  if (through && !local.has(through)) throw new Error('Requested final migration version does not exist.');
  for (const entry of history) {
    if (!local.has(entry.version)) throw new Error(`Target contains an unknown migration: ${entry.version}`);
  }
  for (const receipt of receipts) {
    if (local.get(receipt.version)?.sha256 !== receipt.source_sha256) {
      throw new Error(`Previously recorded migration changed: ${receipt.version}`);
    }
  }
  const applied = new Set(history.map((entry) => entry.version));
  const latestApplied = history.map((entry) => entry.version).sort().at(-1);
  const gap = manifest.find((entry) => entry.version < latestApplied && !applied.has(entry.version) && entry.action === 'apply');
  if (gap) throw new Error(`Target history has a missing schema migration: ${gap.version}; refusing an inferred baseline repair.`);
  return manifest.filter((entry) => !applied.has(entry.version) && (!through || entry.version <= through));
}

export async function inspectMigrationHistory(db) {
  const [tables] = await db`select
    to_regclass('supabase_migrations.schema_migrations') as history,
    to_regclass('supabase_migrations.liftlog_migration_receipts') as receipts,
    to_regclass('public.profiles') as profiles`;
  const history = tables.history ? await db`select version from supabase_migrations.schema_migrations order by version` : [];
  const receipts = tables.receipts ? await db`select version, source_sha256 from supabase_migrations.liftlog_migration_receipts order by version` : [];
  if (!history.length && tables.profiles) throw new Error('Existing Lift Log schema has no migration history; refusing to infer or repair a baseline.');
  return { history, receipts };
}

export async function applyMigrationPlan(db, plan, binding) {
  for (const entry of plan) {
    await db.begin(async (tx) => {
      await tx.unsafe('create schema if not exists supabase_migrations');
      await tx.unsafe('create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)');
      await tx.unsafe(`create table if not exists supabase_migrations.liftlog_migration_receipts (
        version text primary key references supabase_migrations.schema_migrations(version),
        source_sha256 text not null, action text not null, target text not null,
        project_ref text, reason text, recorded_at timestamptz not null default now()
      )`);
      for (const relation of entry.prerequisites) {
        const [row] = await tx`select to_regclass(${relation}) as relation`;
        if (!row.relation) throw new Error(`Operational skip prerequisite is absent: ${relation}`);
      }
      const statements = entry.action === 'apply' ? migrationStatements(entry.source) : [];
      for (const sql of statements) await tx.unsafe(sql);
      const historyStatements = statements.length ? statements : [
        `-- Deliberately skipped historical development data operation. SHA256 ${entry.sha256}. ${entry.reason}`,
      ];
      await tx`insert into supabase_migrations.schema_migrations (version, name, statements)
        values (${entry.version}, ${entry.name}, ${historyStatements})`;
      await tx`insert into supabase_migrations.liftlog_migration_receipts
        (version, source_sha256, action, target, project_ref, reason)
        values (${entry.version}, ${entry.sha256}, ${entry.action}, ${binding.target}, ${binding.projectRef}, ${entry.reason})`;
    });
  }
}
