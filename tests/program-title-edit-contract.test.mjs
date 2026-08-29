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
const repositoryPath = new URL("../lib/repository.ts", import.meta.url);

test("editable program and workout headers expose persisted name and description controls", async () => {
  const [app, repository] = await Promise.all([
    readAppSource(),
    readFile(repositoryPath, "utf8"),
  ]);

  assert.match(repository, /async updateProgramTitle\(programId: string, title: string\)/);
  assert.match(repository, /async updateProgramDescription\(programId: string, description: string\)/);
  assert.match(app, /className="program-editor-heading-icon"/);
  assert.match(app, /className="program-editor-title-input"/);
  assert.match(app, /aria-label=\{`\$\{isQuickWorkout \? "Workout" : "Program"\} name`\}/);
  assert.match(app, /className="form-field program-editor-description-field"/);
  assert.match(app, /onClick=\{\(\) => onSave\(title, description\)\}/);
  assert.match(app, /async function publishProgram\(title: string, description: string\)/);
  assert.match(app, /repository\.updateProgramTitle\(program\.id, nextTitle\)/);
  assert.match(app, /repository\.updateProgramDescription\(program\.id, nextDescription\)/);
  assert.match(
    app,
    /program\.contentType === "quick_workout"[\s\S]*repository\.updateWorkout\([\s\S]*selectedWorkout\.id,[\s\S]*nextTitle/,
    "quick-workout names must remain synchronized with their single workout row",
  );
  assert.doesNotMatch(
    app,
    /function RenameProgramModal\(/,
    "top-level names and descriptions must not require a separate edit modal",
  );
  assert.doesNotMatch(
    app,
    /className="program-summary panel"/,
    "the redundant content-type summary card must be removed",
  );
});
