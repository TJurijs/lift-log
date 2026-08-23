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

test("the week controls offer direct blank and current-week copy actions", async () => {
  const app = await readFile(appPath, "utf8");

  assert.match(app, /aria-label="Add blank week"/);
  assert.match(app, /aria-label=\{`Duplicate Week \$\{selectedWeek\}`\}/);
  assert.doesNotMatch(app, /Extend this program/);
  assert.doesNotMatch(app, /week-create-menu/);
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

test("the compact week controls retain progress feedback", async () => {
  const app = await readFile(appPath, "utf8");

  assert.match(app, /localWeekAction === "blank"/);
  assert.match(app, /localWeekAction === "copy"/);
  assert.match(app, /runWeekAction\("copy", \(\) => onCopyWeek\(1\)\)/);
  assert.match(app, /weekMutationRef\.current/);
  assert.match(app, /localWeekActionRef\.current/);
});
