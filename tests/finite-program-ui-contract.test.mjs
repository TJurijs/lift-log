import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appPath = new URL("../app/LiftLogApp.tsx", import.meta.url);
const cssPath = new URL("../app/globals.css", import.meta.url);

test("program creation always starts a finite one-week program", async () => {
  const app = await readFile(appPath, "utf8");
  const programModal = app.slice(
    app.indexOf("function ProgramModal"),
    app.indexOf("function ScheduleModal"),
  );

  assert.match(
    app,
    /repository\.createBlankProgram\(target\.id, title\)/,
    "program creation should not require a planning-mode choice",
  );
  assert.doesNotMatch(app, /program\.mode|template\.mode/);
  assert.doesNotMatch(
    programModal,
    /Repeating|repeating|Fixed number of weeks/,
  );
  assert.match(programModal, /Start with Week 1/);
  assert.match(programModal, /copy any week as many times as you need/);
});

test("the week add control offers blank, one-copy, and multi-copy paths", async () => {
  const app = await readFile(appPath, "utf8");

  assert.match(app, /aria-label="Add or copy weeks"/);
  assert.match(app, /Add blank week/);
  assert.match(app, /Copy Week \$\{selectedWeek\} once/);
  assert.match(app, /Copy Week \{selectedWeek\} multiple times/);
  assert.match(
    app,
    /repository\.duplicateWeekTimes\(currentWeek\.id, copyCount\)/,
  );
  assert.match(app, /52 - program\.weeks\.length/);
  assert.match(
    app,
    /duplicateWeekTimes\(currentWeek\.id, copyCount\)[\s\S]*const lastWeek = refreshed\.weeks\.at\(-1\)[\s\S]*selectProgram\(refreshed, \{ weekIndex: lastWeek\?\.index \}\)/,
  );
});

test("multi-copy previews its result and visibly guards long-running actions", async () => {
  const app = await readFile(appPath, "utf8");
  const css = await readFile(cssPath, "utf8");
  const copyModal = app.slice(
    app.indexOf("function CopyWeekModal"),
    app.indexOf("function ProgramModal"),
  );

  assert.match(copyModal, /Weeks \$\{nextWeekIndex\}–\$\{finalWeekIndex\}/);
  assert.match(copyModal, /savingRef\.current/);
  assert.match(copyModal, /Creating weeks…/);
  assert.match(copyModal, /disabled=\{!validCount \|\| saving\}/);
  assert.match(app, /weekMutationRef\.current/);
  assert.match(app, /localWeekActionRef\.current/);
  assert.match(
    css,
    /\.week-create-actions[\s\S]*grid-template-columns: repeat\(3/,
  );
  assert.match(
    css,
    /@media \(max-width: 700px\)[\s\S]*\.week-create-actions[\s\S]*grid-template-columns: 1fr/,
  );
});
