import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("../app/LiftLogApp.tsx", import.meta.url);
const unitsUrl = new URL("../lib/units.ts", import.meta.url);

test("weight targets respect the account unit and retain planned-effort guidance", async () => {
  const [app, units] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(unitsUrl, "utf8"),
  ]);

  assert.match(units, /export const KG_PER_LB = 0\.45359237/);
  assert.match(units, /export function formatWeight\(/);
  assert.match(units, /export function weightKgValue\(/);
  assert.match(app, /from "\.\.\/lib\/units"/);
  assert.match(app, /label=\{`Weight \(\$\{weightUnit\}\)`\}/);
  assert.match(app, /sets the intended difficulty by how many good reps should remain\./);
  assert.match(app, /Load \{weightUnit\}/);
  assert.match(app, /completedEntryLabel\(entry, weightUnit\)/);
  assert.match(app, /targetRpe: nextFields\.includes\("rpe"\)[\s\S]*wholeRpe\(entry\.rpe\) \|\| undefined/);
  assert.doesNotMatch(app, /% of max/i);
});
