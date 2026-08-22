import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appPath = new URL("../app/LiftLogApp.tsx", import.meta.url);

test("start and finish actions give immediate feedback and reject repeat clicks", async () => {
  const app = await readFile(appPath, "utf8");

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
    /disabled=\{Boolean\(workoutAction\)\}[\s\S]*Starting workout…/,
  );
  assert.match(
    app,
    /disabled=\{Boolean\(workoutAction\)\}[\s\S]*Finishing session…/,
  );
});
