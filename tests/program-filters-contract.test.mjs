import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appPath = new URL("../app/LiftLogApp.tsx", import.meta.url);
const stylesPath = new URL("../app/globals.css", import.meta.url);

test("Programs mirror the compact searchable tag-filter pattern", async () => {
  const [app, styles] = await Promise.all([
    readFile(appPath, "utf8"),
    readFile(stylesPath, "utf8"),
  ]);

  assert.match(app, /aria-label="Search programs and workouts"/);
  assert.match(app, /selectedTypes[\s\S]*selectedStatuses/);
  assert.match(app, /Type[\s\S]*Programs[\s\S]*Single workouts/);
  assert.match(app, /Status[\s\S]*statusOptions\.map/);
  assert.match(app, /programRunStatusLabel\(status\)/);
  assert.match(app, /No matching training content/);
  assert.match(styles, /\.program-filter-panel\s*\{[^}]*grid-template-columns: repeat\(2/);
  assert.match(styles, /\.program-filter-type[\s\S]*color: var\(--accent\)/);
  assert.match(styles, /\.program-filter-status[\s\S]*color: var\(--orange\)/);
  assert.match(styles, /\.program-card-meta > span\s*\{[^}]*height: 24px[^}]*font-size: 7\.5px/);
  assert.match(styles, /\.program-card-footer > \.status-badge\s*\{[^}]*height: 24px[^}]*font-size: 7\.5px/);
});

test("mobile program cards keep descriptions inside the detail view and inset actions", async () => {
  const styles = await readFile(stylesPath, "utf8");

  assert.match(styles, /\.program-card-description\s*\{\s*display:\s*none;/);
  assert.match(
    styles,
    /\.program-card-footer\s*\{[^}]*padding:\s*6px 16px 6px 0;/s,
  );
});

test("mobile program editing reserves aligned control rails", async () => {
  const [app, styles] = await Promise.all([
    readFile(appPath, "utf8"),
    readFile(stylesPath, "utf8"),
  ]);

  assert.match(app, /className="program-editor-header-actions"/);
  assert.match(app, /className="program-editor-secondary-actions"/);
  assert.match(styles, /\.program-editor-header-actions\s*\{[^}]*grid-template-columns: auto minmax\(72px, 1fr\) auto/s);
  assert.match(styles, /\.program-editor-header-actions \.program-editor-back\s*\{[^}]*grid-column: 1;[^}]*grid-row: 1/s);
  assert.match(styles, /\.program-editor-secondary-actions\s*\{[^}]*grid-column: 1 \/ -1;[^}]*grid-template-columns: repeat\(auto-fit, minmax\(132px, 1fr\)\)/s);
  assert.match(styles, /\.program-editor-header-actions \.program-editor-primary-action\s*\{[^}]*grid-column: 1 \/ -1;[^}]*width: 100%/s);
  assert.match(styles, /\.section-title-group\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) auto/s);
  assert.match(styles, /\.section-actions\s*\{[^}]*grid-template-columns: 44px 44px/s);
  assert.match(styles, /\.builder-exercise-preview \.builder-exercise-title-row\s*\{[^}]*padding-right: 96px[^}]*flex-wrap: nowrap/s);
  assert.match(styles, /\.builder-exercise-preview \.exercise-prescription\s*\{[^}]*width: 100%[^}]*flex-wrap: nowrap/s);
  assert.match(styles, /\.builder-exercise-preview-actions\s*\{[^}]*right: 6px[^}]*grid-template-columns: 44px 44px/s);
  assert.match(styles, /\.builder-exercise-preview \.item-position\s*\{[^}]*display: none/s);
});
