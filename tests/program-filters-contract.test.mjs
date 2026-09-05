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
const stylesPath = new URL("../app/globals.css", import.meta.url);

test("Programs expose reusable-content filters without run-status filtering", async () => {
  const [app, styles] = await Promise.all([
    readAppSource(),
    readFile(stylesPath, "utf8"),
  ]);

  assert.match(app, /aria-label="Search programs and workouts"/);
  assert.match(app, /selectedTypes/);
  assert.match(app, /Type[\s\S]*Programs[\s\S]*Single workouts/);
  assert.doesNotMatch(app, /selectedStatuses|statusOptions\.map|programRunStatusLabel\(status\)/);
  assert.match(app, /No matching training content/);
  assert.match(styles, /\.program-filter-panel\s*\{[^}]*grid-template-columns: repeat\(2/);
  assert.match(styles, /\.program-filter-type[\s\S]*color: var\(--accent\)/);
  assert.match(styles, /\.program-card-meta > span\s*\{[^}]*height: 24px[^}]*font-size: var\(--font-caption\)/);
  assert.match(styles, /\.program-card-status-row > \.status-badge\s*\{[^}]*height: 24px[^}]*font-size: var\(--font-caption\)/);
});

test("mobile program cards align status and actions in stable rows", async () => {
  const styles = await readFile(stylesPath, "utf8");

  assert.match(styles, /\.program-card-description\s*\{\s*display:\s*none;/);
  assert.match(
    styles,
    /\.program-card-footer\s*\{[^}]*padding:\s*0 12px 10px;[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s,
  );
  assert.match(styles, /\.program-card-status-row\s*\{[^}]*white-space:\s*nowrap;/s);
  assert.match(styles, /\.program-card-actions\s*\{[^}]*grid-template-columns:\s*repeat\(3, 32px\);/s);
  assert.match(styles, /\.program-card-action-template\s*\{[^}]*grid-column:\s*1;/s);
  assert.match(styles, /\.program-card-action-schedule\s*\{[^}]*grid-column:\s*2;/s);
  assert.match(styles, /\.program-card-action-delete\s*\{[^}]*grid-column:\s*3;/s);
});

test("mobile program editing reserves aligned controls and one exercise list", async () => {
  const [app, styles] = await Promise.all([
    readAppSource(),
    readFile(stylesPath, "utf8"),
  ]);

  assert.match(app, /className="program-editor-header-actions"/);
  assert.match(app, /className="program-editor-secondary-actions"/);
  assert.match(styles, /\.program-editor-header-actions\s*\{[^}]*grid-template-columns: minmax\(72px, 1fr\) auto/s);
  assert.match(styles, /\.program-editor-header-actions \.program-editor-back\s*\{[^}]*grid-column: 1;[^}]*grid-row: 1/s);
  assert.match(styles, /\.program-editor-header-actions \.source-tag\s*\{[^}]*grid-column: 1;[^}]*grid-row: 1/s);
  assert.match(styles, /\.program-editor-header-actions > \.status-badge\s*\{[^}]*grid-column: 2;[^}]*grid-row: 1/s);
  assert.match(styles, /\.program-editor-secondary-actions\s*\{[^}]*grid-column: 1 \/ -1;[^}]*grid-template-columns: repeat\(auto-fit, minmax\(132px, 1fr\)\)/s);
  assert.match(styles, /\.program-editor-header-actions \.program-editor-primary-action\s*\{[^}]*grid-column: 1 \/ -1;[^}]*width: 100%/s);
  assert.doesNotMatch(app, />Exercises<\/strong>/);
  assert.match(app, /setReorderingExercises/);
  assert.match(app, /className="text-button workout-reorder-toggle"/);
  assert.match(app, /className="button secondary full"[\s\S]*Add exercise/);
  assert.match(app, /reorderEnabled && "drag-enabled"/);
  assert.doesNotMatch(app, /className="section-actions"/);
  assert.doesNotMatch(app, /className="section-action"/);
  assert.match(styles, /\.builder-exercise-preview \.builder-exercise-title-row\s*\{[^}]*padding-right: 96px[^}]*flex-wrap: nowrap/s);
  assert.match(styles, /\.builder-exercise-preview \.exercise-prescription\s*\{[^}]*width: 100%[^}]*flex-wrap: nowrap/s);
  assert.match(styles, /\.builder-exercise-preview-actions\s*\{[^}]*right: 6px[^}]*grid-template-columns: 44px 44px/s);
  assert.match(styles, /\.builder-exercise-preview\s*\{[^}]*padding: 8px 12px;/s);
  assert.match(styles, /\.builder-exercise-preview\.drag-enabled\s*\{[^}]*padding-left: 42px;/s);
  assert.match(styles, /\.builder-exercise-preview \.item-position\s*\{[^}]*display: none/s);
});
