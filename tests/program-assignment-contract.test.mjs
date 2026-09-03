import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/202608290001_v1_performance_data_architecture.sql",
  import.meta.url,
);
const runMigrationUrl = new URL(
  "../supabase/migrations/202609020003_program_runs.sql",
  import.meta.url,
);

function sqlFunction(source, name) {
  const match = source.match(
    new RegExp(
      `create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  );
  assert.ok(match, `expected SQL function: ${name}`);
  return match[0];
}

test("legacy shared assignments remain historical schema but all new use goes through program runs", async () => {
  const [migration, runMigration, domain, repository] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(runMigrationUrl, "utf8"),
    readFile(new URL("../lib/domain.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/repository.ts", import.meta.url), "utf8"),
  ]);
  const assign = sqlFunction(migration, "assign_published_program_version");
  const fork = sqlFunction(migration, "fork_program_assignment");

  assert.match(
    migration,
    /create table public\.program_assignments[\s\S]*source_version_id uuid[\s\S]*customized_program_id uuid/,
  );
  assert.match(
    migration,
    /create unique index idx_program_assignments_request_key/,
  );
  assert.match(assign, /target_athlete_ids uuid\[\]/);
  assert.match(assign, /cardinality\(target_athlete_ids\) > 50/);
  assert.match(assign, /with requested as materialized/);
  assert.match(assign, /insert into public\.program_assignments/);
  assert.match(
    assign,
    /relationship_count <> cardinality\(normalized_athlete_ids\)/,
    "the complete batch must be authorized before shared references are inserted",
  );
  assert.doesNotMatch(assign, /clone_program_version_tree|foreach|\bloop\b/i);
  assert.doesNotMatch(assign, /insert into public\.scheduled_workouts/);

  assert.match(fork, /target_idempotency_key uuid/);
  assert.match(fork, /private\.clone_program_version_tree/);
  assert.match(fork, /customized_program_id = new_program_id/);
  assert.match(
    runMigration,
    /revoke all on function public\.assign_published_program_version\(uuid, uuid, uuid\[\], uuid\)[\s\S]*from public, anon, authenticated/i,
  );

  assert.match(
    domain,
    /export interface ProgramAssignment[\s\S]*athleteId: string;[\s\S]*assignmentId: string;[\s\S]*programId: string;[\s\S]*created: boolean;/,
  );
  assert.doesNotMatch(
    repository,
    /assignOwnProgramToAthletes|rpc\("assign_program_for_use"/,
    "the retired whole-program assignment writer must not remain callable from the app",
  );
  assert.match(
    repository,
    /async createProgramRuns\([\s\S]*rpc\("create_program_runs"[\s\S]*target_program_id: programId,[\s\S]*target_athlete_ids: uniqueAthleteIds,[\s\S]*target_idempotency_key: idempotencyKey/,
  );
  assert.doesNotMatch(
    repository,
    /forkProgramAssignment|assignQuickWorkoutToAthletes|rpc\("(?:fork_program_assignment|assign_quick_workout_for_use)"/,
    "the app repository must not expose superseded assignment writers",
  );
});
