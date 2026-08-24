import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appPath = new URL("../app/LiftLogApp.tsx", import.meta.url);
const primitivesPath = new URL("../app/ui-primitives.tsx", import.meta.url);
const migrationPath = new URL(
  "../supabase/migrations/202608220005_complete_fixed_program_cycles.sql",
  import.meta.url,
);

test("completed fixed programs leave scheduling and can be explicitly repeated", async () => {
  const [app, migration, primitives] = await Promise.all([
    readFile(appPath, "utf8"),
    readFile(migrationPath, "utf8"),
    readFile(primitivesPath, "utf8"),
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
    /const available = programs\.filter\(\(program\) =>[\s\S]*availableIds\.includes\(program\.id\)/,
    "the source list must derive scheduling availability only from availability",
  );
  assert.doesNotMatch(
    app,
    /completedIds/,
    "occurrence completion must not be collapsed into program availability",
  );
  assert.match(
    app,
    /program\.versionStatus === "draft"[\s\S]*\? "draft"[\s\S]*: available[\s\S]*\? "in_schedule"[\s\S]*: "ready"/,
    "content lifecycle and scheduling availability must remain separate badge dimensions",
  );
  assert.match(
    app,
    /schedule\.status === "completed" \? "completed" : "scheduled"/,
    "completion must remain visible at the workout-occurrence level",
  );
  assert.match(primitives, /ready: "Ready"[\s\S]*in_schedule: "In schedule"[\s\S]*completed: "Completed"/);
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
    /onAssignProgram=\{[\s\S]*capabilitiesForProgram\(program\)\.assign/,
  );
});

test("saving a program is separate from making it available", async () => {
  const app = await readFile(appPath, "utf8");
  assert.doesNotMatch(app, /onRemoveAvailable/);
  assert.match(
    app,
    /await repository\.publishProgram\(program\.versionId\);[\s\S]*?Program saved\. Add it to scheduling when you are ready\./,
    "saving must not make an Own program available automatically",
  );
  assert.match(
    app,
    /<Save size=\{15\} \/>[\s\S]*?Save program/,
    "the editor must clearly describe its save action",
  );
  assert.match(
    app,
    /available[\s\S]*?canEdit=\{capabilitiesForProgram\(item\)\.edit\}[\s\S]*?canDelete=\{capabilitiesForProgram\(item\)\.deleteOwn\}[\s\S]*?capabilitiesForProgram\(item\)\.manageAvailability[\s\S]*?\? "remove"[\s\S]*?capabilitiesForProgram\(item\)\.schedule[\s\S]*?onAvailability=\{\(\) => onAvailability\(item, false\)\}/,
    "the Available list exposes scheduling before its removal action",
  );
  assert.match(
    app,
    /availabilityAction === "remove"[\s\S]*?<X size=\{15\} \/>[\s\S]*?: \([\s\S]*?<Check size=\{15\} \/>/,
    "availability uses a cross to remove and a checkmark to make available",
  );
  const libraryPanel =
    app.match(/\{source === "library" && \([\s\S]*?\n {8}\)\}/)?.[0] ?? "";
  assert.ok(libraryPanel, "the Library tab must remain present");
  assert.match(
    libraryPanel,
    /capabilitiesForProgram\(instance\)\.manageAvailability/,
    "library instances must use the same capability policy before direct scheduling",
  );
  assert.match(
    app,
    /copyToOwn=\{false\}/,
    "Own programs must opt into the concise Copy tooltip",
  );
  assert.match(
    app,
    /title=\{copyToOwn \? "Copy to Own" : "Copy"\}/,
    "the copy control must respect the source-specific tooltip",
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
  const [app, styles] = await Promise.all([
    readFile(appPath, "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(
    app,
    /schedule\.status === "skipped"[\s\S]*?"unscheduled"[\s\S]*?schedule\.status === "completed" \? "completed" : "scheduled"/,
  );
  assert.match(app, /className="program-card-workout-progress"/);
  assert.match(styles, /\.program-card-workout-progress i\.scheduled/);
  assert.match(styles, /\.program-card-workout-progress i\.completed/);
});
