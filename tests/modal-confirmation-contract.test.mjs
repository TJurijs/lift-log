import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appPath = new URL("../app/LiftLogApp.tsx", import.meta.url);
const stylesPath = new URL("../app/globals.css", import.meta.url);

test("destructive confirmations always use the shared application overlay", async () => {
  const [app, styles] = await Promise.all([
    readFile(appPath, "utf8"),
    readFile(stylesPath, "utf8"),
  ]);

  assert.doesNotMatch(app, /window\.(?:confirm|alert|prompt)\s*\(/);
  assert.equal(
    [...app.matchAll(/setModal\("delete-content"\)/g)].length,
    4,
    "program, assignment, workout, and workout-item deletion must open the shared overlay",
  );
  assert.match(app, /function DeleteContentModal[\s\S]*<ModalShell/);
  assert.match(app, /kind: "workout"[\s\S]*kind: "workout-item"[\s\S]*kind: "assignment"[\s\S]*kind: "program"/);
  assert.doesNotMatch(app, /kind: "week"/);
  assert.match(app, /modal === "delete-exercise"[\s\S]*<DeleteExerciseModal/);
  assert.doesNotMatch(app, /modal === "delete-section"|DeleteSectionModal/);
  assert.match(
    styles,
    /\.modal-backdrop\s*\{[\s\S]*?position: fixed;[\s\S]*?inset: 0;[\s\S]*?z-index: 80;/,
  );
});
