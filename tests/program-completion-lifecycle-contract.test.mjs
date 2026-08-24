import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appPath = new URL("../app/LiftLogApp.tsx", import.meta.url);
const primitivesPath = new URL("../app/ui-primitives.tsx", import.meta.url);
const progressPath = new URL("../lib/program-progress.ts", import.meta.url);
const migrationPath = new URL(
  "../supabase/migrations/202608250001_final_content_is_schedulable.sql",
  import.meta.url,
);

test("finalized Own and Coach programs can prepare fresh calendar cycles", async () => {
  const [app, migration, primitives, progress] = await Promise.all([
    readFile(appPath, "utf8"),
    readFile(migrationPath, "utf8"),
    readFile(primitivesPath, "utf8"),
    readFile(progressPath, "utf8"),
  ]);

  assert.match(
    migration,
    /prepare_program_schedule[\s\S]*version\.status = 'published'[\s\S]*program\.source_type in \('self', 'coach'\)[\s\S]*cycle_start := cycle_start \+ workout_count[\s\S]*insert into public\.scheduled_workouts/i,
    "published athlete-owned content must prepare a new occurrence cycle without availability",
  );
  assert.match(
    app,
    /const schedulablePrograms =[\s\S]*workspace\.schedulablePrograms/,
    "the workspace must derive scheduling from finalized content",
  );
  assert.doesNotMatch(
    app,
    /availabilityAction|onAvailability|In schedule/,
    "the UI must not expose a separate scheduling-availability state",
  );
  assert.match(
    app,
    /label=\{programRunStatusLabel\(runStatus\)\}/,
    "program cards must surface the derived run lifecycle",
  );
  assert.match(
    progress,
    /schedule\.status === "completed"[\s\S]*schedule\.status === "skipped"[\s\S]*plannedDate < today[\s\S]*"overdue"/,
    "completion, skipping, and overdue dates must remain distinct workout states",
  );
  assert.match(primitives, /ready: "Final"[\s\S]*completed: "Completed"/);
  assert.match(
    app,
    /No workouts available to schedule[\s\S]*Finalize an Own program or workout first/,
    "the empty scheduler must explain the final-content rule",
  );
});

test("program assignment is hidden without active coachees", async () => {
  const app = await readFile(appPath, "utf8");
  assert.match(
    app,
    /onAssignProgram=\{[\s\S]*capabilitiesForProgram\(program\)\.assign/,
  );
});

test("finalizing a program makes it directly schedulable", async () => {
  const app = await readFile(appPath, "utf8");
  assert.doesNotMatch(app, /onRemoveAvailable/);
  assert.match(
    app,
    /await repository\.publishProgram\(program\.versionId\);[\s\S]*?Program finalized\. It is ready to schedule\./,
    "finalizing must make an Own program ready to schedule",
  );
  assert.match(
    app,
    /<Save size=\{15\} \/>[\s\S]*?Finalize program/,
    "the editor must clearly describe its finalization action",
  );
  assert.match(
    app,
    /onSchedule=\{capabilitiesForProgram\(item\)\.schedule \? onSchedule : undefined\}/,
    "final Own and Coach rows must expose one Schedule action",
  );
  assert.doesNotMatch(
    app,
    /title=\{copyToOwn \? "Copy to Own" : "Copy"\}/,
    "program copy controls must not survive the template-free model",
  );
  assert.match(
    app,
    /capabilitiesForProgram\(program\)\.schedule[\s\S]*?\? \(\) => openSchedule\(\)/,
    "a program can be scheduled only after it is made available",
  );
  assert.doesNotMatch(app, /This is the stable version used by scheduled workouts\./);
  assert.match(
    app,
    /\{editable && \([\s\S]*?<aside className="exercise-picker panel"/,
    "the Exercise Library must be hidden outside edit mode",
  );
});

test("available programs visualize every workout's scheduling state", async () => {
  const [app, styles, progress] = await Promise.all([
    readFile(appPath, "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(progressPath, "utf8"),
  ]);

  assert.match(progress, /"draft"[\s\S]*"ready"[\s\S]*"scheduled"[\s\S]*"in_progress"[\s\S]*"needs_attention"[\s\S]*"completed"/);
  assert.match(progress, /workoutStates\.includes\("overdue"\)[\s\S]*"needs_attention"/);
  assert.match(app, /className="program-card-workout-progress"/);
  assert.match(styles, /\.program-card-workout-progress i\.due/);
  assert.match(styles, /\.program-card-workout-progress i\.overdue/);
  assert.match(styles, /\.program-card-workout-progress i\.scheduled/);
  assert.match(styles, /\.program-card-workout-progress i\.completed/);
  assert.match(styles, /\.program-card-workout-progress i\.skipped/);
});
