import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/202608240002_align_copy_capability_and_availability_grant.sql",
  import.meta.url,
);

test("copy-to-own and availability reads follow the capability contract", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  assert.match(
    migration,
    /grant select on table public\.program_availability to authenticated/i,
  );
  assert.match(
    migration,
    /program\.athlete_id = current_user_id[\s\S]*program\.source_type in \('library', 'coach'\)/i,
  );
  assert.match(
    migration,
    /version\.status in \('published', 'superseded'\)/i,
  );
  assert.doesNotMatch(
    migration,
    /public\.can_read_program\(program\.id\)/i,
  );
});
