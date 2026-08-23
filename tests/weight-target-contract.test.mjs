import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("../app/LiftLogApp.tsx", import.meta.url);

test("weight targets respect the account unit and retain planned-effort guidance", async () => {
  const app = await readFile(appUrl, "utf8");

  assert.match(app, /const KG_PER_LB = 0\.45359237/);
  assert.match(app, /function formatWeight\(valueKg: number, weightUnit: OwnProfile\["weightUnit"\]\)/);
  assert.match(app, /function weightKgValue\(value: string, weightUnit: OwnProfile\["weightUnit"\]\)/);
  assert.match(app, /label=\{`Target weight \(\$\{weightUnit\}\)`\}/);
  assert.match(app, /This guides effort alongside an exact weight target\./);
  assert.match(app, /Load \{weightUnit\}/);
  assert.match(app, /completedEntryLabel\(entry, weightUnit\)/);
  assert.match(app, /targetRpe: wholeRpe\(entry\.rpe\) \|\| undefined/);
  assert.doesNotMatch(app, /% of max/i);
});
