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
test("program creation presents an ordered workout sequence instead of a week plan", async () => {
  const app = await readAppSource();
  const programModal = app.slice(
    app.indexOf("function ProgramModal"),
    app.indexOf("function ScheduleModal"),
  );

  assert.match(
    app,
    /repository\.createBlankProgram\(target\.id, title\)/,
    "program creation should not require a planning-mode choice",
  );
  assert.doesNotMatch(app, /program\.mode|template\.mode/);
  assert.doesNotMatch(
    programModal,
    /Repeating|repeating|Fixed number of weeks/,
  );
  assert.match(
    programModal,
    /Add workouts in training order\. Athletes schedule each session on the dates that suit them\./,
  );
  assert.doesNotMatch(programModal, /Week 1|week as many times|Duplicate week/);
});

test("the program editor exposes one workout sequence with explicit reorder mode", async () => {
  const programView = await readFile(programViewPath, "utf8");

  assert.match(programView, /workouts: PlannedWorkout\[\]/);
  assert.match(programView, />Workout sequence</);
  assert.match(programView, /workouts\.map\(\(workout, index\) =>/);
  assert.match(programView, /aria-pressed=\{reorderingWorkouts\}/);
  assert.match(programView, /\{reorderingWorkouts \? "Done" : "Reorder"\}/);
  assert.match(
    programView,
    /onReorderWorkouts\(arrayMove\(ids, from, to\)\)/,
  );
  assert.doesNotMatch(
    programView,
    /currentWeek|selectedWeek|onSelectWeek|onAddBlankWeek|onCopyWeek|onDeleteWeek/,
  );
  assert.doesNotMatch(
    programView,
    /Add blank week|Duplicate Week|week-tabs|week-create-menu/,
  );
});
