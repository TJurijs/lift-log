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
  assert.match(app, /<select[\s\S]*aria-label=\{ariaLabel\}/);
  assert.doesNotMatch(app, /7–8", label/);
  assert.match(app, /function RpeSelect/);
  assert.match(app, /function RpeLegend/);
  assert.match(app, /function workoutLogFields\(mode: EntryMode\)/);
  assert.match(app, /if \(mode === "result"\) return \["duration", "distance", "heartRate", "rpe"\]/);
  assert.doesNotMatch(app, /Athlete records/);
  assert.match(app, /about 2 reps left/);
  assert.match(app, /rpe: "",/);
  assert.match(styles, /\.rpe-select-trigger:is\(select\)/);
  assert.doesNotMatch(styles, /\.rpe-select-menu/);
  assert.match(styles, /\.rpe-result-input > \.rpe-select[\s\S]*overflow: visible/);
  assert.match(styles, /\.planned-rpe-select/);
  assert.match(styles, /\.rpe-very-hard/);
  assert.match(styles, /\.rpe-legend/);
});
