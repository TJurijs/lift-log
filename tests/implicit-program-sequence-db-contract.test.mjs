import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/202608290002_implicit_program_workout_sequence.sql",
  import.meta.url,
);
const repositoryUrl = new URL("../lib/repository.ts", import.meta.url);
const operationalMigrationUrl = new URL(
  "../supabase/migrations/202608210001_operational_mvp.sql",
  import.meta.url,
);
const templateCreationMigrationUrl = new URL(
  "../supabase/migrations/202608210008_library_instances_are_immutable.sql",
  import.meta.url,
);
const copyMigrationUrl = new URL(
  "../supabase/migrations/202608240002_align_copy_capability_and_availability_grant.sql",
  import.meta.url,
);
const forkMigrationUrl = new URL(
  "../supabase/migrations/202608290001_v1_performance_data_architecture.sql",
  import.meta.url,
);

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `expected source marker: ${start}`);
  assert.notEqual(endIndex, -1, `expected source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("existing program versions are normalized without replacing workouts", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const normalization = sourceBetween(
    migration,
    "alter table public.program_weeks disable trigger",
    "-- Clone one implicit container",
  );

  assert.match(normalization, /insert into public\.program_weeks[\s\S]*where not exists/i);
  assert.match(
    normalization,
    /row_number\(\) over \([\s\S]*partition by week\.program_version_id[\s\S]*order by week\.week_index, workout\.position, workout\.id/i,
    "legacy week order must become deterministic workout sequence order",
  );
  assert.match(
    normalization,
    /update public\.workouts workout[\s\S]*program_week_id = ordered\.canonical_week_id[\s\S]*position = ordered\.next_position/i,
  );
  assert.doesNotMatch(normalization, /delete from public\.workouts/i);
  assert.doesNotMatch(normalization, /insert into public\.workouts/i);
  assert.match(normalization, /enable trigger guard_program_weeks_draft/i);
  assert.match(normalization, /enable trigger guard_workouts_draft/i);
  assert.match(
    normalization,
    /create unique index idx_program_weeks_one_per_version[\s\S]*on public\.program_weeks \(program_version_id\)/i,
  );
});

test("clone and template paths create one implicit container", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const clone = sourceBetween(
    migration,
    "create or replace function private.clone_program_version_tree",
    "-- Template `week_count`",
  );
  const template = sourceBetween(
    migration,
    "create or replace function private.populate_program_from_template",
    "-- New blank programs",
  );

  assert.equal(
    (clone.match(/insert into public\.program_weeks/gi) ?? []).length,
    1,
  );
  assert.doesNotMatch(clone, /for source_week_row in/i);
  assert.match(clone, /private\.clone_week_contents\(source_week_id, target_week_id\)/i);

  assert.equal(
    (template.match(/insert into public\.program_weeks/gi) ?? []).length,
    1,
  );
  assert.match(template, /workout_position integer := 0/i);
  assert.match(template, /for cycle_number in 1\.\.greatest/i);
  assert.match(template, /'Workout ' \|\| \(workout_position \+ 1\)/i);
  assert.match(template, /workout_position := workout_position \+ 1/i);
});

test("draft, copy, fork, and template creation converge on normalized helpers", async () => {
  const [operational, templateCreation, copy, fork] = await Promise.all([
    readFile(operationalMigrationUrl, "utf8"),
    readFile(templateCreationMigrationUrl, "utf8"),
    readFile(copyMigrationUrl, "utf8"),
    readFile(forkMigrationUrl, "utf8"),
  ]);

  assert.match(
    operational,
    /create or replace function public\.create_program_draft[\s\S]*private\.clone_program_version_tree\(source_version_id, new_version_id\)/i,
  );
  assert.match(
    copy,
    /create or replace function public\.copy_program_to_own[\s\S]*private\.clone_program_version_tree\(source_version_id, new_version_id\)/i,
  );
  assert.match(
    fork,
    /create or replace function public\.fork_program_assignment[\s\S]*private\.clone_program_version_tree\(content_version_id, new_version_id\)/i,
  );
  assert.match(
    templateCreation,
    /create or replace function public\.create_program_from_template[\s\S]*private\.populate_program_from_template\(published_version_id, template_row\.id\)/i,
  );
});

test("new content uses the implicit sequence and one exercise list", async () => {
  const [migration, repository, workoutMigration] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(repositoryUrl, "utf8"),
    readFile(new URL("../supabase/migrations/202608290004_flat_workout_exercises.sql", import.meta.url), "utf8"),
  ]);
  const blankProgram = sourceBetween(
    migration,
    "create or replace function public.create_blank_program",
    "create or replace function public.create_blank_quick_workout",
  );
  const quickWorkout = sourceBetween(
    migration,
    "create or replace function public.create_blank_quick_workout",
    "-- Week mutation endpoints",
  );

  assert.match(blankProgram, /values \(version_id, phase_id, 1, 'Program'\)/i);
  assert.match(quickWorkout, /values \(version_id, phase_id, 1, 'Workout'\)/i);
  assert.match(workoutMigration, /create or replace function public\.create_blank_quick_workout[\s\S]*'Exercises', 'main', 0/i);
  assert.match(repository, /title: "Exercises"[\s\S]*section_kind: "main"/i);
  assert.match(repository, /sectionResult\.data\.length !== 1/i);
  assert.match(
    repository,
    /async addWorkout\(\s*program: Program,\s*title: string,[\s\S]*implicitProgramWeek\(program\)/i,
  );
  assert.match(
    repository,
    /async reorderWorkouts\(program: Program, workoutIds: string\[\]\)[\s\S]*implicitProgramWeek\(program\)/i,
  );
  assert.doesNotMatch(repository, /async (?:addWorkout|reorderWorkouts)\(weekId:/i);

  for (const signature of [
    "add_program_week(uuid)",
    "delete_program_week(uuid)",
    "duplicate_program_week(uuid, uuid)",
    "duplicate_program_week_times(uuid, integer)",
  ]) {
    assert.match(
      migration,
      new RegExp(`drop function if exists public\\.${signature.replace(/[()]/g, "\\$&")}`, "i"),
    );
  }
  assert.match(
    migration,
    /create or replace function public\.ensure_starter_program[\s\S]*Starter program creation is retired[\s\S]*revoke all on function public\.ensure_starter_program\(uuid\)[\s\S]*from public, anon, authenticated/i,
  );
});
