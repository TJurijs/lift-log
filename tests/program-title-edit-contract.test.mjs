import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appPath = new URL("../app/LiftLogApp.tsx", import.meta.url);
const repositoryPath = new URL("../lib/repository.ts", import.meta.url);

test("editable program and workout headers expose persisted name and description controls", async () => {
  const [app, repository] = await Promise.all([
    readFile(appPath, "utf8"),
    readFile(repositoryPath, "utf8"),
  ]);

  assert.match(repository, /async updateProgramTitle\(programId: string, title: string\)/);
  assert.match(repository, /async updateProgramDescription\(programId: string, description: string\)/);
  assert.match(app, /repository\.updateProgramTitle\(program\.id, nextTitle\)/);
  assert.match(app, /onRenameProgram=\{updateProgramDetails\}/);
  assert.match(app, /function RenameProgramModal\(/);
  assert.match(app, /title=\{`\$\{label === "program" \? "Program" : "Workout"\} details`\}/);
  assert.match(app, /What is this \$\{label\} for\?/);
  assert.match(app, /program\?\.contentType === "quick_workout"[\s\S]*program\.description/);
  assert.match(app, /What is this workout for\?/);
  assert.match(app, /titleAction=\{/);
  assert.match(app, /aria-label="Rename workout"/);
  assert.match(app, /className="editor-title-row"/);
  assert.match(app, /syncQuickWorkoutTitle/);
  assert.match(app, /repository\.updateProgramDescription\(program\.id, nextDescription\)/);
  assert.match(app, /previous\.contentType === "quick_workout" \? title : previous\.title/);
  assert.match(app, /title=\{isQuickWorkout \? selectedWorkout\?\.title \?\? program\.title : program\.title\}/);
});
