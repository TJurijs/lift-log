import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/202608290001_v1_performance_data_architecture.sql",
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

test("coach assignment stores shared immutable references and forks only for explicit customization", async () => {
  const [migration, domain, repository] = await Promise.all([
    readFile(migrationUrl, "utf8"),
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
    migration,
    /revoke all on function public\.assign_published_program_version[\s\S]*grant execute[\s\S]*to authenticated/i,
  );

  assert.match(
    domain,
    /export interface ProgramAssignment[\s\S]*athleteId: string;[\s\S]*assignmentId: string;[\s\S]*programId: string;[\s\S]*created: boolean;/,
  );
  assert.match(
    repository,
    /async assignOwnProgramToAthletes\([\s\S]*rpc\("assign_published_program_version"[\s\S]*target_program_id: programId,[\s\S]*target_version_id: versionId,[\s\S]*target_athlete_ids: uniqueAthleteIds,[\s\S]*target_idempotency_key: idempotencyKey/,
  );
  assert.match(
    repository,
    /assignmentId:[\s\S]*"assignment_id"[\s\S]*programId,[\s\S]*created:/,
  );
  assert.match(
    repository,
    /async forkProgramAssignment\([\s\S]*rpc\("fork_program_assignment"[\s\S]*target_assignment_id: assignmentId,[\s\S]*target_idempotency_key: idempotencyKey/,
  );
  assert.match(
    repository,
    /async assignQuickWorkoutToAthletes\([\s\S]*rpc\("assign_quick_workout_to_athletes"[\s\S]*target_athlete_ids: uniqueAthleteIds,[\s\S]*target_planned_date: plannedDate,[\s\S]*target_idempotency_key: idempotencyKey/,
  );
});
