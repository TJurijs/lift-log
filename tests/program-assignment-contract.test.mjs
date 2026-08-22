import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/202608210016_assign_own_program_to_athletes.sql",
  import.meta.url,
);
const conflictFixUrl = new URL(
  "../supabase/migrations/202608220001_fix_program_assignment_conflict_resolution.sql",
  import.meta.url,
);
const concurrencyMigrationUrl = new URL(
  "../supabase/migrations/202608220002_harden_coach_workflow_concurrency.sql",
  import.meta.url,
);
const cleanupMigrationUrl = new URL(
  "../supabase/migrations/202608220003_preserve_assigned_copies_on_source_cleanup.sql",
  import.meta.url,
);

test("coach assignments clone a published own program into independent athlete programs", async () => {
  const [
    migration,
    conflictFix,
    concurrencyMigration,
    cleanupMigration,
    domain,
    repository,
  ] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(conflictFixUrl, "utf8"),
    readFile(concurrencyMigrationUrl, "utf8"),
    readFile(cleanupMigrationUrl, "utf8"),
    readFile(new URL("../lib/domain.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/repository.ts", import.meta.url), "utf8"),
  ]);
  const functionBody =
    migration.match(
      /create or replace function public\.assign_own_program_to_athletes[\s\S]*?\$\$;/i,
    )?.[0] ?? "";

  assert.ok(functionBody, "assignment must be implemented as one database RPC");
  assert.match(
    migration,
    /add column assigned_from_program_id[\s\S]*references public\.programs\(id\) on delete set null/i,
    "assigned athlete copies must survive deletion of the coach's source program",
  );
  assert.match(
    migration,
    /create unique index idx_programs_one_assignment_per_source[\s\S]*athlete_id, assigned_from_program_id/i,
  );
  assert.match(
    functionBody,
    /program\.athlete_id = current_user_id[\s\S]*program\.created_by_id = current_user_id[\s\S]*program\.source_type = 'self'/i,
  );
  assert.match(
    functionBody,
    /version\.status = 'published'/i,
    "draft source content must never be assigned",
  );
  assert.match(
    functionBody,
    /not public\.is_active_coach\(requested_id\)[\s\S]*foreach athlete_cursor/i,
    "the complete athlete batch must be authorized before any copy is created",
  );
  assert.match(
    functionBody,
    /source_type,[\s\S]*assigned_from_program_id[\s\S]*'coach'/i,
  );
  assert.match(
    functionBody,
    /based_on_version_id[\s\S]*source_version_id[\s\S]*private\.clone_program_version_tree\(source_version_id, new_version_id\)[\s\S]*status = 'published'/i,
  );
  assert.match(
    functionBody,
    /on conflict \(athlete_id, assigned_from_program_id\)[\s\S]*created := false/i,
    "retries must return the existing assignment instead of duplicating it",
  );
  assert.match(
    conflictFix,
    /create or replace function public\.assign_own_program_to_athletes[\s\S]*#variable_conflict use_column[\s\S]*on conflict \(athlete_id, assigned_from_program_id\)/i,
    "the table-returning RPC must resolve its athlete_id output variable as the conflict-target column",
  );
  assert.match(
    concurrencyMigration,
    /program\.archived_at is null[\s\S]*for share[\s\S]*version\.status = 'published'[\s\S]*for share/i,
    "the source program and published version must remain stable while they are cloned",
  );
  assert.match(
    concurrencyMigration,
    /from public\.coach_relationships relationship[\s\S]*relationship\.ended_at is null[\s\S]*for share[\s\S]*active_relationship_count <> cardinality\(normalized_athlete_ids\)/i,
    "active coaching authorization must be locked for the entire assignment transaction",
  );
  assert.match(
    cleanupMigration,
    /old\.assigned_from_program_id is not null[\s\S]*new\.assigned_from_program_id is null/i,
    "FK cleanup must not destroy independent athlete copies",
  );
  assert.doesNotMatch(
    functionBody,
    /insert into public\.program_availability/i,
  );
  assert.doesNotMatch(functionBody, /insert into public\.scheduled_workouts/i);
  assert.match(
    migration,
    /revoke all on function public\.assign_own_program_to_athletes\(uuid, uuid\[\]\) from public[\s\S]*grant execute[\s\S]*to authenticated/i,
  );

  assert.match(
    domain,
    /export interface ProgramAssignment[\s\S]*athleteId: string;[\s\S]*programId: string;[\s\S]*created: boolean;/i,
  );
  assert.match(
    repository,
    /async assignOwnProgramToAthletes\([\s\S]*target_program_id: programId,[\s\S]*target_athlete_ids: uniqueAthleteIds/i,
  );
  assert.match(
    repository,
    /athleteId: assignment\.athlete_id,[\s\S]*programId: assignment\.assigned_program_id,[\s\S]*created: assignment\.created/i,
  );
});
