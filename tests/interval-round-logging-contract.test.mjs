import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("interval execution mirrors prescribed rounds in a five-column grid", async () => {
  const [app, repository, migration] = await Promise.all([
    readFile(new URL("app/LiftLogApp.tsx", root), "utf8"),
    readFile(new URL("lib/repository.ts", root), "utf8"),
    readFile(
      new URL(
        "supabase/migrations/202608250002_interval_round_session_entries.sql",
        root,
      ),
      "utf8",
    ),
  ]);

  assert.match(app, /function IntervalLogTable/);
  assert.match(app, /Round[\s\S]*Plan[\s\S]*Distance[\s\S]*Avg HR[\s\S]*RPE/);
  assert.match(app, /round\.\$\{index\}\.completed/);
  assert.match(repository, /touchedIntervalPositions/);
  assert.match(repository, /round\.\$\{position\}\.distance/);
  assert.match(
    migration,
    /item\.entry_mode in \(''result'', ''intervals''\)[\s\S]*item\.entry_mode = ''result''/,
  );
});
