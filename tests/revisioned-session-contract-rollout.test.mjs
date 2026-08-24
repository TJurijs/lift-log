import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const contract = await readFile(
  new URL(
    "../supabase/dev-rollouts/enforce_revisioned_session_contract.sql",
    import.meta.url,
  ),
  "utf8",
);
const rollback = await readFile(
  new URL(
    "../supabase/dev-rollbacks/restore_pre_author_scope_read_compatibility.sql",
    import.meta.url,
  ),
  "utf8",
);
const migration = await readFile(
  new URL(
    "../supabase/migrations/202608240006_enforce_author_scoped_revisioned_contract.sql",
    import.meta.url,
  ),
  "utf8",
);

test("post-smoke contract closes every legacy session-write bypass", () => {
  assert.match(
    contract,
    /revoke insert, update, delete on public\.session_entries\s+from anon, authenticated/i,
  );
  assert.match(
    contract,
    /revoke execute on function public\.complete_workout_session\(uuid, numeric, text\)\s+from public, anon, authenticated/i,
  );
});

test("emergency compatibility rollback restores only the old entry/completion path", () => {
  assert.match(
    rollback,
    /grant insert, update, delete on public\.session_entries to authenticated/i,
  );
  assert.match(
    rollback,
    /grant execute on function public\.complete_workout_session\(uuid, numeric, text\)\s+to authenticated/i,
  );
  assert.doesNotMatch(
    rollback,
    /grant insert, update, delete on public\.session_item_logs/i,
  );
});

test("the recorded contract migration reconciles rollback policies before closing writes", () => {
  assert.match(
    migration,
    /program\.created_by_id = \(select auth\.uid\(\)\)[\s\S]*program\.source_type = 'coach'/i,
  );
  assert.match(
    migration,
    /drop policy if exists profiles_read_connected on public\.profiles[\s\S]*create policy profiles_read_self/i,
  );
  assert.match(
    migration,
    /create policy workout_sessions_read_owner[\s\S]*session\.athlete_id = \(select auth\.uid\(\)\)/i,
  );
  assert.match(
    migration,
    /workout_session_id is not null[\s\S]*public\.can_read_authored_session\(workout_session_id\)/i,
  );
  assert.match(
    migration,
    /revoke insert, update, delete on public\.session_entries\s+from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /revoke execute on function public\.complete_workout_session\(uuid, numeric, text\)\s+from public, anon, authenticated/i,
  );
});
