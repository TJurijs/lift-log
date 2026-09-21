import { readAppSource as readAuthoringSource } from "./helpers/app-source.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const programViewPath = new URL(
  "../app/features/programs/ProgramView.tsx",
  import.meta.url,
);
const repositoryPath = new URL("../lib/repository.ts", import.meta.url);
const progressPath = new URL("../lib/program-progress.ts", import.meta.url);
const runMigrationPath = new URL(
  "../supabase/migrations/202609020003_program_runs.sql",
  import.meta.url,
);

async function readAppSource() {
  const [app, programView] = await Promise.all([
    readAuthoringSource(),
    readFile(programViewPath, "utf8"),
  ]);
  return `${app}\n${programView}`;
}

test("one run owns every ordered workout and dates remain optional", async () => {
  const [migration, repository] = await Promise.all([
    readFile(runMigrationPath, "utf8"),
    readFile(repositoryPath, "utf8"),
  ]);
  const createRun = migration.match(
    /create or replace function public\.create_program_runs[\s\S]*?\n\$\$;/i,
  )?.[0] ?? "";
  const scheduleRun = migration.match(
    /create or replace function public\.schedule_program_run_workouts[\s\S]*?\n\$\$;/i,
  )?.[0] ?? "";

  assert.match(createRun, /target_athlete_ids uuid\[\]/);
  assert.match(createRun, /target_workout_dates jsonb/);
  assert.match(createRun, /target_idempotency_key uuid/);
  assert.match(createRun, /private\.materialize_program_run/);
  assert.match(scheduleRun, /status in \('unscheduled', 'scheduled'\)/);
  assert.match(scheduleRun, /requested\.planned_date is not null/);
  assert.match(
    repository,
    /async createProgramRuns[\s\S]*rpc\("create_program_runs"/,
  );
  assert.match(
    repository,
    /async scheduleProgramRunWorkouts[\s\S]*rpc\("schedule_program_run_workouts"/,
  );
});

test("planning a program preserves assigned snapshots and keeps autosave in its editor", async () => {
  const [app, migration] = await Promise.all([
    readAppSource(),
    readFile(runMigrationPath, "utf8"),
  ]);
  const snapshot = migration.match(
    /create or replace function private\.snapshot_program_for_run[\s\S]*?\n\$\$;/i,
  )?.[0] ?? "";
  const canEdit = migration.match(
    /create or replace function public\.can_edit_program[\s\S]*?\n\$\$;/i,
  )?.[0] ?? "";

  assert.match(snapshot, /publish_program_version\(draft_version_id/);
  assert.match(snapshot, /insert into public\.program_versions[\s\S]*'draft'/);
  assert.match(snapshot, /clone_program_version_tree/);
  assert.doesNotMatch(canEdit, /locked_at/);
  assert.match(
    app,
    /className="program-save-status" role="status"[\s\S]*?"Saving…"[\s\S]*?"Couldn't save"[\s\S]*?"Saved"/,
    "the workout and program editor reports its autosave state",
  );
  assert.match(
    app,
    /const editable = capabilities\.edit && editing;/,
    "being in editor mode never grants write permission on its own",
  );
  assert.match(
    app,
    /\{editable && pickerOpen && \([\s\S]*?<WorkoutExercisePicker[\s\S]*?pending=\{mutationPending\}/,
    "the Exercise Library picker must open only for an editable working revision",
  );
});

// The old template + "In use" card shape is intentionally gone. Actual
// training occurrences, hiding their source cards, and keeping independent
// repeats are covered by programs-home.test.tsx and training-workflows.test.tsx.

test("calendar and workout detail still distinguish due, overdue, skipped and completed", async () => {
  const progress = await readFile(progressPath, "utf8");

  assert.match(
    progress,
    /schedule\.status === "completed"[\s\S]*schedule\.status === "skipped"[\s\S]*plannedDate < today[\s\S]*"overdue"/,
  );
});
