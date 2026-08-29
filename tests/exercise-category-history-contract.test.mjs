import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../supabase/migrations/202608300001_session_exercise_category_snapshots.sql",
  import.meta.url,
);
const canonicalWarmupMigrationPath = new URL(
  "../supabase/migrations/202608300002_canonical_weightlifting_warmup.sql",
  import.meta.url,
);
const correctedWarmupMigrationPath = new URL(
  "../supabase/migrations/202608300003_correct_weightlifting_warmup_category.sql",
  import.meta.url,
);
const reconnectedWarmupMigrationPath = new URL(
  "../supabase/migrations/202608300004_reconnect_weightlifting_warmup_identity.sql",
  import.meta.url,
);

test("completed workout logs retain canonical exercise categories for icons", async () => {
  const migration = await readFile(migrationPath, "utf8");

  assert.match(
    migration,
    /session_item_logs[\s\S]*add column snapshot_category text not null default 'General'/,
  );
  assert.match(
    migration,
    /before insert or update of source_workout_item_id, snapshot_name[\s\S]*set_session_item_category_snapshot/,
  );
  assert.match(
    migration,
    /update public\.session_item_logs item[\s\S]*resolve_exercise_category/,
  );
  assert.match(
    migration,
    /'exerciseCategory', item\.snapshot_category/,
  );
});

test("the built-in warmup has a canonical category in plans and history", async () => {
  const migration = await readFile(canonicalWarmupMigrationPath, "utf8");
  const correction = await readFile(correctedWarmupMigrationPath, "utf8");
  const reconnection = await readFile(reconnectedWarmupMigrationPath, "utf8");

  assert.match(migration, /'Weightlifting warmup',[\s\S]*'Weightlifting'/);
  assert.match(
    migration,
    /update public\.workout_items[\s\S]*source_exercise_id = exercise\.id/,
  );
  assert.match(
    migration,
    /update public\.session_item_logs[\s\S]*snapshot_category = 'Weightlifting'/,
  );
  assert.match(
    correction,
    /update public\.exercises[\s\S]*category = 'Weightlifting'/,
  );
  assert.match(
    reconnection,
    /update public\.workout_items[\s\S]*source_exercise_id = canonical\.id/,
  );
});
