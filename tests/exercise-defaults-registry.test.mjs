import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const registry = JSON.parse(await readFile(new URL('supabase/exercise-defaults/2026-09-10.json', root), 'utf8'));
const review = JSON.parse(await readFile(new URL('docs/review/EXERCISE_CATALOG_DEFAULTS_2026_09_10.json', root), 'utf8'));
const migration = await readFile(new URL('supabase/migrations/202609100002_reviewed_exercise_catalog_defaults.sql', root), 'utf8');

test('reviewed defaults contain exactly the 84 approved corrections and exclude deferred identities', () => {
  const approved = review.findings.filter((entry) => !entry.kind.startsWith('defer'));
  const deferred = review.findings.filter((entry) => entry.kind.startsWith('defer'));
  assert.equal(approved.length, 84);
  assert.equal(deferred.length, 10);
  assert.equal(registry.deferredCount, deferred.length);
  assert.deepEqual(registry.overrides.map((entry) => entry.auditedId).sort(), approved.map((entry) => entry.id).sort());
  assert.equal(new Set(registry.overrides.map((entry) => `${entry.sourceProvider}:${entry.sourceExternalId}`)).size, 84);
  for (const entry of registry.overrides) {
    const proposal = approved.find((candidate) => candidate.id === entry.auditedId);
    assert.deepEqual(entry.expected, proposal.current);
    assert.deepEqual(entry.recommended, proposal.recommended);
    assert.equal(entry.kind, proposal.kind);
    assert.equal(entry.name, proposal.name);
    assert.equal(entry.sourceProvider, 'catalyst-athletics');
    assert.equal(new URL(entry.sourceUrl).pathname.split('/')[2], entry.sourceExternalId);
    assert.equal(entry.expected.fields.includes('rpe'), entry.recommended.fields.includes('rpe'), 'Optional RPE defaults are preserved independently');
  }
});

test('SQL replay uses every exact portable registry identity and reviewed before/after value', () => {
  const quote = (value) => `'${value.replaceAll("'", "''")}'`;
  const fields = (values) => `array[${values.map(quote).join(', ')}]::text[]`;
  for (const entry of registry.overrides) {
    const row = `(${quote(entry.auditedId)}::uuid, ${quote(entry.sourceProvider)}, ${quote(entry.sourceExternalId)}, ${quote(entry.sourceUrl)}, ${quote(entry.name)}, ${quote(entry.expected.mode)}, ${fields(entry.expected.fields)}, ${quote(entry.recommended.mode)}, ${fields(entry.recommended.fields)})`;
    assert.ok(migration.includes(row), `Migration must exactly match ${entry.name}`);
  }
  assert.equal((migration.match(/::uuid, 'catalyst-athletics'/g) ?? []).length, 84);
  assert.doesNotMatch(migration, /update\s+public\.(?:workout_items|session_item_logs|session_entries|prescribed_entries)\b/i);
});

test('representative movement defaults distinguish bodyweight steps, static holds, dynamic planks and loaded lifts', () => {
  const fieldMap = new Map(registry.overrides.map((entry) => [entry.name, entry.recommended]));
  assert.deepEqual(fieldMap.get('Step-up'), { mode: 'sets', fields: ['reps', 'rpe'] });
  assert.deepEqual(fieldMap.get('Wall Sit'), { mode: 'result', fields: ['duration', 'rpe'] });
  assert.deepEqual(fieldMap.get('Dip Clean'), { mode: 'sets', fields: ['reps', 'load', 'rpe'] });
  assert.deepEqual(fieldMap.get('Sledgehammer Wrist Rotation'), { mode: 'sets', fields: ['reps', 'load', 'rpe'] });
  assert.deepEqual(fieldMap.get('Copenhagen Plank Lift'), { mode: 'sets', fields: ['reps'] });
});
