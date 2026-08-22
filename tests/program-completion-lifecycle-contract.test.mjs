import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appPath = new URL("../app/LiftLogApp.tsx", import.meta.url);
const migrationPath = new URL(
  "../supabase/migrations/202608220005_complete_fixed_program_cycles.sql",
  import.meta.url,
);

test("completed fixed programs leave scheduling and can be explicitly repeated", async () => {
  const [app, migration] = await Promise.all([
    readFile(appPath, "utf8"),
    readFile(migrationPath, "utf8"),
  ]);

  assert.match(
    migration,
    /complete_workout_session[\s\S]*completed_planning_mode = 'fixed_weeks'[\s\S]*not exists[\s\S]*scheduled\.status in \('planned', 'in_progress'\)[\s\S]*delete from public\.program_availability/i,
    "the last outstanding fixed-program workout must remove program availability",
  );
  assert.match(
    migration,
    /prepare_program_schedule[\s\S]*cycle_start := cycle_start \+ workout_count[\s\S]*sequence_value := cycle_start[\s\S]*insert into public\.scheduled_workouts/i,
    "adding a terminal program again must create a fresh occurrence cycle",
  );
  assert.match(
    migration,
    /Bring existing fixed programs into the same lifecycle immediately[\s\S]*delete from public\.program_availability/i,
    "existing completed programs must be reconciled",
  );
  assert.match(
    app,
    /const completedIds = new Set[\s\S]*availableIds\.includes\(program\.id\)[\s\S]*schedule\.status === "completed" \|\|[\s\S]*schedule\.status === "skipped"/,
    "terminal finite programs must be recognized in the source list",
  );
  assert.match(
    app,
    /completed[\s\S]*\? "Completed"[\s\S]*: "Not available"/,
    "the source list must distinguish completed from merely unavailable programs",
  );
  assert.match(
    app,
    /Completed[\s\S]*programs can be added again whenever you want to run them another[\s\S]*time/,
    "the empty scheduler must explain that completed programs may be repeated",
  );
});

test("program assignment is hidden without active coachees", async () => {
  const app = await readFile(appPath, "utf8");
  assert.match(
    app,
    /onAssignProgram=\{[\s\S]*workspace\.coachedAthletes\.length > 0 &&[\s\S]*program\.sourceType === "self"/,
  );
});

test("availability is managed from program lists rather than the open program", async () => {
  const app = await readFile(appPath, "utf8");
  assert.doesNotMatch(app, /onRemoveAvailable/);
  assert.match(
    app,
    /title=\{available \? "Remove from available" : "Add to available"\}/,
  );
});
