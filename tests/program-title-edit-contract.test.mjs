import { readAppSource as readAuthoringSource } from "./helpers/app-source.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const programViewPath = new URL(
  "../app/features/programs/ProgramView.tsx",
  import.meta.url,
);
async function readAppSource() {
  const [app, programView] = await Promise.all([
    readAuthoringSource(),
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
  assert.match(app, /aria-label=\{`\$\{objectLabel\} name`\}/);
  assert.match(app, /className="form-field program-editor-description-field"/);
  assert.match(app, /onClick=\{\(\) => onSave\(title, description\)\}/);
  assert.match(app, /useProgramMetadataDraft\(program\)/);
  assert.match(app, /repository\.updateProgramTitle\(targetProgram\.id, title\)/);
  assert.match(app, /repository\.updateProgramDescription\(targetProgram\.id, description\)/);
  assert.match(
    app,
    /targetProgram\.contentType === "quick_workout"[\s\S]*repository\.updateWorkout\(quickWorkout\.id, title/,
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
