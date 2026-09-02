import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appPath = new URL("../app/LiftLogApp.tsx", import.meta.url);
const programViewPath = new URL(
  "../app/features/programs/ProgramView.tsx",
  import.meta.url,
);
async function readAppSource() {
  const [app, programView] = await Promise.all([
    readFile(appPath, "utf8"),
    readFile(programViewPath, "utf8"),
  ]);
  return `${app}\n${programView}`;
}
const primitivesPath = new URL("../app/ui-primitives.tsx", import.meta.url);
const progressPath = new URL("../lib/program-progress.ts", import.meta.url);
const migrationPath = new URL(
  "../supabase/migrations/202608290001_v1_performance_data_architecture.sql",
  import.meta.url,
);

test("finalized Own and assigned programs schedule one selected occurrence", async () => {
  const [app, migration, primitives, progress, repository] = await Promise.all([
    readAppSource(),
    readFile(migrationPath, "utf8"),
    readFile(primitivesPath, "utf8"),
    readFile(progressPath, "utf8"),
    readFile(new URL("../lib/repository.ts", import.meta.url), "utf8"),
  ]);

  assert.match(
    migration,
    /create or replace function public\.create_scheduled_occurrence[\s\S]*target_workout_id uuid[\s\S]*target_idempotency_key uuid/,
    "the mutation must identify exactly one workout and be safe to retry",
  );
  assert.match(
    migration.match(
      /create or replace function public\.create_scheduled_occurrence[\s\S]*?\$\$;/i,
    )?.[0] ?? "",
    /insert into public\.scheduled_workouts/,
  );
  assert.equal(
    (
      migration.match(
        /create or replace function public\.create_scheduled_occurrence[\s\S]*?\$\$;/i,
      )?.[0] ?? ""
    ).match(/insert into public\.scheduled_workouts/g)?.length,
    1,
  );
  assert.match(
    migration,
    /drop function if exists public\.prepare_program_schedule\(uuid\);/i,
    "the obsolete program-wide schedule prepopulation API must be removed",
  );
  assert.match(
    migration,
    /drop function if exists public\.set_program_availability\(uuid, boolean\);/i,
    "the obsolete availability toggle must be removed with schedule prepopulation",
  );
  assert.match(repository, /async listSchedulableWorkouts/);
  assert.match(repository, /rpc\("list_schedulable_workouts"/);
  assert.match(
    repository,
    /async createScheduledOccurrence[\s\S]*rpc\("create_scheduled_occurrence_for_use"[\s\S]*target_idempotency_key: idempotencyKey/,
  );
  assert.doesNotMatch(repository, /prepareProgramSchedule/);
  assert.doesNotMatch(app, /availabilityAction|onAvailability|In schedule/);
  assert.match(
    progress,
    /schedule\.status === "completed"[\s\S]*schedule\.status === "skipped"[\s\S]*plannedDate < today[\s\S]*"overdue"/,
    "completion, skipping, and overdue dates must remain distinct workout states",
  );
  assert.match(primitives, /editable: "Editable"[\s\S]*locked: "Locked"[\s\S]*completed: "Completed"/);
  assert.match(
    app,
    /No workouts available to schedule[\s\S]*Save a workout or program first/,
    "the empty scheduler must explain the saved-content rule",
  );
});

test("program assignment is hidden without active coachees", async () => {
  const app = await readAppSource();
  assert.match(
    app,
    /onAssignProgram=\{[\s\S]*capabilitiesForProgram\(program\)\.assign/,
  );
});

test("saving stays editable and first use locks content", async () => {
  const app = await readAppSource();
  assert.doesNotMatch(app, /onRemoveAvailable/);
  assert.match(
    app,
    /Program saved\. It stays editable until you schedule or assign it\./,
    "saving must not lock unused content",
  );
  assert.match(
    app,
    /<Save size=\{15\} \/>[\s\S]*?Save program/,
    "the editor must use consistent save language",
  );
  assert.match(
    app,
    /onSchedule=\{capabilitiesForProgram\(item\)\.schedule \? \(\) => onSchedule\(item\) : undefined\}/,
    "schedulable Own and Coach rows must expose one Schedule action",
  );
  assert.doesNotMatch(
    app,
    /title=\{copyToOwn \? "Copy to Own" : "Copy"\}/,
    "program copy controls must not survive the template-free model",
  );
  assert.match(
    app,
    /capabilitiesForProgram\(program\)\.schedule[\s\S]*?openScheduleForProgram\(program\)/,
    "a program can be scheduled directly from its detail",
  );
  assert.doesNotMatch(app, /This is the stable version used by scheduled workouts\./);
  assert.match(
    app,
    /\{editable && pickerOpen && \([\s\S]*?<ModalShell[\s\S]*?className="exercise-picker-modal"/,
    "the Exercise Library picker must open only for an editable workout",
  );
  assert.doesNotMatch(app, /className="exercise-picker desktop-exercise-picker panel"/);
});

test("available programs visualize every workout's scheduling state", async () => {
  const [app, styles, progress] = await Promise.all([
    readFile(appPath, "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(progressPath, "utf8"),
  ]);

  assert.match(progress, /"editable"[\s\S]*"locked"[\s\S]*"scheduled"[\s\S]*"in_progress"[\s\S]*"needs_attention"[\s\S]*"completed"/);
  assert.match(progress, /workoutStates\.includes\("overdue"\)[\s\S]*"needs_attention"/);
  assert.match(app, /className="program-card-workout-progress"/);
  assert.match(styles, /\.program-card-workout-progress i\.due/);
  assert.match(styles, /\.program-card-workout-progress i\.overdue/);
  assert.match(styles, /\.program-card-workout-progress i\.scheduled/);
  assert.match(styles, /\.program-card-workout-progress i\.completed/);
  assert.match(styles, /\.program-card-workout-progress i\.skipped/);
});
