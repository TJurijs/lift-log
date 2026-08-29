import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("../app/LiftLogApp.tsx", import.meta.url);
const stylesUrl = new URL("../app/globals.css", import.meta.url);

test("planned and actual RPE remain distinct and guided", async () => {
  const [app, styles] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
  ]);

  assert.match(app, /function TargetRpeBadge/);
  assert.match(app, /<small>Target<\/small>/);
  assert.match(app, /<strong className=\{`rpe-\$\{rpeTone\(normalizedValue\)\}`\}>RPE \{normalizedValue\}<\/strong>/);
  assert.match(app, /<span>Actual RPE<\/span>/);
  assert.match(app, /<span id="session-rpe-label">Session RPE<\/span>/);
  assert.match(app, /function PlannedRpeSelect/);
  assert.match(
    app,
    /function PlannedRpeSelect[\s\S]*?<RpeSelect[\s\S]*?intent="planned"/,
    "planned and logged effort share the same compact RPE control",
  );
  assert.doesNotMatch(app, /7–8", label/);
  assert.match(app, /function RpeSelect/);
  assert.match(app, /function RpeLegend/);
  assert.match(app, /function workoutLogFields\(item: Pick<WorkoutItem, "mode" \| "fields">\)/);
  assert.match(app, /trackingFieldsForMode\(item\.mode, item\.fields\)/);
  assert.doesNotMatch(app, /Athlete records/);
  assert.match(app, /detail: "2 left"/);
  assert.match(app, /rpe: "",/);
  assert.match(styles, /\.rpe-select-menu/);
  assert.match(app, /shows how hard the set felt by how many good reps you had left/);
  assert.match(app, /sets the intended difficulty by how many good reps should remain/);
  assert.match(styles, /\.rpe-select-options > button\.rpe-very-hard strong/);
  assert.match(styles, /\.rpe-result-input > \.rpe-select[\s\S]*overflow: visible/);
  assert.match(styles, /\.planned-rpe-select/);
  assert.match(styles, /\.rpe-very-hard/);
  assert.match(styles, /\.rpe-legend/);
  assert.match(
    styles,
    /\.exercise-heading:not\(\.builder-exercise-heading\)[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) auto/,
    "desktop and mobile execution cards share the compact title and target layout",
  );
  assert.match(
    styles,
    /\.exercise-heading > \.exercise-prescription[\s\S]*flex-wrap:\s*nowrap/,
    "prescription and target RPE stay on one line",
  );
});
