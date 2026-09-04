import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appPath = new URL("../app/LiftLogApp.tsx", import.meta.url);
const primitivesPath = new URL("../app/ui-primitives.tsx", import.meta.url);

test("start and finish actions give immediate feedback and reject repeat clicks", async () => {
  const [app, primitives, nextView] = await Promise.all([
    readFile(appPath, "utf8"),
    readFile(primitivesPath, "utf8"),
    readFile(new URL("../app/features/next-workouts/NextWorkoutsView.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(
    app,
    /workoutActionRef = useRef<"starting" \| "finishing" \| null>/,
  );
  assert.match(
    app,
    /async function startWorkout\(schedule: ScheduledWorkout\)[\s\S]*workoutActionRef\.current[\s\S]*setWorkoutAction\("starting"\)[\s\S]*finally[\s\S]*setWorkoutAction\(null\)/,
  );
  assert.match(
    app,
    /async function finishWorkout\(\)[\s\S]*workoutActionRef\.current[\s\S]*setWorkoutAction\("finishing"\)[\s\S]*finally[\s\S]*setWorkoutAction\(null\)/,
  );
  assert.match(
    app,
    /loading=\{workoutAction === "starting"\}[\s\S]*Starting workout…/,
  );
  assert.match(app, /startingScheduleId=\{startingScheduleId\}/);
  assert.match(nextView, /loading=\{startingScheduleId === schedule\.id\}/);
  assert.match(
    app,
    /loading=\{workoutAction === "finishing"\}[\s\S]*Finishing session…/,
  );
  assert.match(
    primitives,
    /disabled=\{disabled \|\| loading\}/,
    "shared async buttons must reject repeat clicks while loading",
  );
});
