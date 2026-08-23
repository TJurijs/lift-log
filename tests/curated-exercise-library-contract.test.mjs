import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../supabase/migrations/202608230002_curated_global_exercise_library.sql",
  import.meta.url,
);

test("the global exercise catalogue covers the core training styles without duplicate names", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const entries = [...migration.matchAll(/^\s*\('([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)'/gm)];
  const names = entries.map((entry) => entry[1]);
  const categories = new Set(entries.map((entry) => entry[2]));

  assert.ok(entries.length >= 100, "the curated catalogue should be substantial");
  assert.equal(new Set(names.map((name) => name.toLowerCase())).size, names.length);
  for (const category of [
    "Weightlifting",
    "Bodybuilding",
    "Functional fitness",
    "Gymnastics",
    "Core",
    "Cardio",
    "Mobility",
  ]) {
    assert.ok(categories.has(category), `missing ${category} coverage`);
  }
  assert.match(migration, /where not exists \([\s\S]*lower\(existing\.name\) = lower\(curated\.name\)/);
  assert.match(migration, /Power snatch[\s\S]*?Snatch pull/);
  assert.match(migration, /Dumbbell bench press[\s\S]*?Leg press/);
  assert.match(migration, /Kettlebell swing[\s\S]*?Burpee/);
});
