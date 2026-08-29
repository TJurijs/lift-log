import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("../app/LiftLogApp.tsx", import.meta.url);

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);

  assert.notEqual(startIndex, -1, `expected source marker: ${start}`);
  assert.notEqual(endIndex, -1, `expected source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("the schedule picker puts fail-soft frequent choices before searchable deduplicated results", async () => {
  const app = await readFile(appUrl, "utf8");
  const loader = sourceBetween(
    app,
    "async function loadScheduleCandidates(",
    "function openSchedule(",
  );
  const picker = sourceBetween(app, "function ScheduleModal(", "function AccountModal(");

  assert.match(
    loader,
    /Promise\.all\(\[[\s\S]*repository\.listSchedulableWorkouts\(\{[\s\S]*limit:\s*50[\s\S]*repository\.listFrequentSchedulableWorkouts\(6\)/,
    "the first load must request the ordinary bounded page and frequent quick workouts together",
  );
  assert.match(
    loader,
    /listFrequentSchedulableWorkouts\(6\)\.catch\(\(\) => \[\]\)/,
    "frequent ranking is an enhancement and must not block ordinary scheduling",
  );

  const mostUsedIndex = picker.indexOf("Most used");
  const allWorkoutsIndex = picker.indexOf("All workouts");
  assert.notEqual(mostUsedIndex, -1);
  assert.notEqual(allWorkoutsIndex, -1);
  assert.ok(
    mostUsedIndex < allWorkoutsIndex,
    "Most used must render before All workouts",
  );

  assert.match(
    picker,
    /aria-label="Search workouts"[\s\S]*value=\{workoutQuery\}[\s\S]*onChange=\{\(event\) => setWorkoutQuery\(event\.target\.value\)\}/,
  );
  assert.match(
    picker,
    /const matchingChoices = availableCandidates\.filter\([\s\S]*candidate\.programTitle[\s\S]*candidate\.workoutTitle[\s\S]*includes\(normalizedWorkoutQuery\)/,
    "search must cover both the workout name and its parent program",
  );

  assert.match(
    picker,
    /<strong>\{candidate\.workoutTitle\}<\/strong>[\s\S]*\{!candidate\.quickWorkout && <small>\{candidate\.programTitle\}<\/small>\}/,
    "quick workouts must show only their workout name while program workouts retain context",
  );
  assert.doesNotMatch(
    sourceBetween(picker, "function workoutChoice(", "async function save("),
    /scheduleLabel|weekLabel|programVersionId/,
    "picker rows must not expose persistence or week metadata",
  );

  assert.match(
    picker,
    /id: `\$\{candidate\.assignmentId \?\? `program:\$\{candidate\.programId\}`\}:\$\{candidate\.programVersionId\}:\$\{candidate\.workoutId\}`/,
    "choice identity must use source IDs rather than labels",
  );
  assert.match(
    picker,
    /const merged = \[\.\.\.frequentCandidates, \.\.\.candidates\];[\s\S]*const seen = new Set<string>\(\);[\s\S]*seen\.has\(mapped\.id\)[\s\S]*seen\.add\(mapped\.id\)/,
    "the frequent and ordinary responses must collapse to one choice per stable identity",
  );
});
