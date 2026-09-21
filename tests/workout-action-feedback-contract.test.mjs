import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appPath = new URL("../app/LiftLogApp.tsx", import.meta.url);
const primitivesPath = new URL("../app/ui-primitives.tsx", import.meta.url);

test("start and finish actions give immediate feedback and reject repeat clicks", async () => {
  const [app, primitives, training] = await Promise.all([
    readFile(appPath, "utf8"),
    readFile(primitivesPath, "utf8"),
    readFile(new URL("../app/features/programs/ProgramsHome.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(
    app,
    /workoutActionRef = useRef<"starting" \| "finishing" \| null>/,
  );
  assert.match(
    app.slice(app.indexOf("async function startWorkout("), app.indexOf("async function openWorkoutPreview(")),
    /if \(workoutActionRef\.current\) return;[\s\S]*workoutActionRef\.current = "starting"[\s\S]*setWorkoutAction\("starting"\)[\s\S]*finally[\s\S]*workoutActionRef\.current = null[\s\S]*setWorkoutAction\(null\)/,
    "starting must lock before the request and release both the lock and feedback state afterwards",
  );
  assert.match(
    app,
    /async function finishWorkout\(\)[\s\S]*workoutActionRef\.current[\s\S]*setWorkoutAction\("finishing"\)[\s\S]*finally[\s\S]*setWorkoutAction\(null\)/,
  );
  assert.match(
    app,
    /loading=\{workoutAction === "starting"\}[\s\S]*Starting workout…/,
  );
  assert.match(app, /startingTrainingId=\{startingScheduleId\}/);
  assert.match(training, /loading: starting/);
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
