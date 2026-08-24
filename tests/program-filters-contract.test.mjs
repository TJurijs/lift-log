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
