import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("../app/LiftLogApp.tsx", import.meta.url);
const repositoryUrl = new URL("../lib/repository.ts", import.meta.url);
const stylesUrl = new URL("../app/globals.css", import.meta.url);

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);

  assert.notEqual(startIndex, -1, `expected source marker: ${start}`);
  assert.notEqual(endIndex, -1, `expected source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("calendar scheduling exposes progress and contextual actions", async () => {
  const app = await readFile(appUrl, "utf8");
  const scheduleModal = sourceBetween(
    app,
    "function ScheduleModal",
    "function AccountModal",
  );

  assert.ok(app.includes("Preparing calendar…"), "opening must show progress");
  assert.ok(scheduleModal.includes("Add to calendar"));
  assert.ok(scheduleModal.includes("Reschedule"));
  assert.ok(scheduleModal.includes("Unschedule"));
  assert.ok(
    /LoaderCircle[\s\S]*button-spinner/.test(scheduleModal),
    "the save action must have an animated progress icon",
  );
  assert.ok(scheduleModal.includes("plannedDate"));
  assert.ok(
    /(?:date\s*!==|!==\s*date|dateChanged|isReschedul)/.test(scheduleModal),
    "rescheduling must be driven by changing the selected date",
  );
});

test("the native date picker is visibly active in the dark theme", async () => {
  const styles = await readFile(stylesUrl, "utf8");

  assert.ok(
    /input\[type=["']date["']\][^{]*\{[^}]*color-scheme:\s*dark/i.test(styles),
    "date inputs must request dark native controls",
  );
});

test("the primary training destination is labelled Next workout", async () => {
  const app = await readFile(appUrl, "utf8");

  assert.ok(
    /\{\s*id:\s*["']today["'],\s*label:\s*["']Next workout["']/.test(app),
    "the today route must be presented as Next workout",
  );
});

test("calendar event clicks open plans and immutable completed results", async () => {
  const [app, repository] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(repositoryUrl, "utf8"),
  ]);
  const calendarView = sourceBetween(
    app,
    "function CalendarView",
    "function ExercisesView",
  );

  assert.ok(
    /daySchedules\.map\(\(schedule\)[\s\S]*?onClick=\{\(\)\s*=>\s*onOpenPlan\(schedule\)\}/.test(
      calendarView,
    ),
    "clicking a planned calendar event must open its workout plan",
  );
  assert.ok(
    /daySessions\.map\(\(session\)[\s\S]*?onClick=\{\(\)\s*=>\s*onOpenResults\(session\)\}/.test(
      calendarView,
    ),
    "clicking a completed calendar event must open its saved results",
  );
  assert.ok(app.includes("repository.loadCompletedSessionDetail("));
  assert.ok(/async loadCompletedSessionDetail\s*\(/.test(repository));
  assert.ok(app.includes("Workout plan"));
  assert.ok(app.includes("Completed results"));
});
