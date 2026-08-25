import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const helperPath = fileURLToPath(
  new URL("../lib/workout-focus.ts", import.meta.url),
);
const dateOnlyPath = fileURLToPath(
  new URL("../lib/date-only.ts", import.meta.url),
);
const [helperSource, dateOnlySource] = await Promise.all([
  readFile(helperPath, "utf8"),
  readFile(dateOnlyPath, "utf8"),
]);
const transpileOptions = {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
};
const compiledDateOnly = ts
  .transpileModule(dateOnlySource, {
    ...transpileOptions,
    fileName: dateOnlyPath,
  })
  .outputText.replace(/\bexport\s+/g, "");
const compiledHelper = ts.transpileModule(helperSource, {
  ...transpileOptions,
  fileName: helperPath,
}).outputText.replace(
  /import \{ localDateOnly \} from "\.\/date-only";\s*/,
  compiledDateOnly,
);
const helperModule = await import(
  `data:text/javascript;base64,${Buffer.from(compiledHelper).toString("base64")}`
);
const { listUpcomingWorkouts, selectNextWorkoutFocus } = helperModule;

function workout(id, title = id) {
  return {
    id,
    title,
    dayLabel: "Workout 1",
    durationMinutes: 45,
    sections: [],
  };
}

function schedule({
  id,
  workoutId = id,
  date,
  status = "planned",
  sequence = 1,
  versionId = "version-1",
}) {
  const plannedWorkout = workout(workoutId);
  return {
    id,
    programId: "program-1",
    programTitle: "Program",
    programVersionId: versionId,
    workoutId,
    workoutTitle: plannedWorkout.title,
    slotLabel: plannedWorkout.dayLabel,
    plannedDate: date,
    sequenceNumber: sequence,
    status,
    workout: plannedWorkout,
  };
}

function activeSession({
  workoutId,
  scheduledWorkoutId,
  versionId = "version-1",
}) {
  return {
    id: "session-1",
    workoutId,
    programVersionId: versionId,
    scheduledWorkoutId,
    itemLogIds: {},
    setLogs: {},
    resultLogs: {},
    sessionRpe: "7",
    sessionNote: "",
  };
}

function program(programWorkout, versionId = "version-1") {
  return {
    id: "program-1",
    athleteId: "athlete-1",
    createdById: "athlete-1",
    ownerName: "Athlete",
    createdByName: "Athlete",
    title: "Program",
    description: "",
    phase: "Base",
    activeWeek: 1,
    versionId,
    versionNumber: 1,
    versionStatus: "published",
    planningMode: "fixed",
    sourceType: "self",
    sourceLabel: "Created by you",
    weeks: [
      {
        id: "week-1",
        index: 1,
        label: "Week 1",
        workouts: [programWorkout],
      },
    ],
  };
}

test("an active session wins over an earlier dated planned workout", () => {
  const earlier = schedule({ id: "earlier", date: "2026-08-20" });
  const active = schedule({
    id: "active",
    workoutId: "active-workout",
    date: "2026-08-28",
    status: "in_progress",
  });

  const focus = selectNextWorkoutFocus(
    [],
    activeSession({
      workoutId: active.workoutId,
      scheduledWorkoutId: active.id,
    }),
    [earlier, active],
    "2026-08-21",
  );

  assert.equal(focus?.schedule?.id, active.id);
  assert.equal(focus?.workout.id, active.workoutId);
  assert.equal(focus?.timing, "active");
  assert.equal(focus?.plannedDate, "2026-08-28");
});

test("an active session can fall back to its program workout", () => {
  const activeWorkout = workout("active-workout");
  const focus = selectNextWorkoutFocus(
    [program(activeWorkout)],
    activeSession({ workoutId: activeWorkout.id }),
    [],
    "2026-08-21",
  );

  assert.equal(focus?.schedule, null);
  assert.equal(focus?.workout, activeWorkout);
  assert.equal(focus?.timing, "active");
  assert.equal(focus?.plannedDate, undefined);
});

test("an unresolved active session does not fall through to another workout", () => {
  const focus = selectNextWorkoutFocus(
    [],
    activeSession({ workoutId: "missing-active-workout" }),
    [schedule({ id: "next", date: "2026-08-21" })],
    "2026-08-21",
  );

  assert.equal(focus, null);
});

test("the oldest dated outstanding workout remains visible as overdue", () => {
  const candidates = [
    schedule({ id: "undated", date: undefined }),
    schedule({ id: "completed", date: "2026-08-18", status: "completed" }),
    schedule({ id: "skipped", date: "2026-08-17", status: "skipped" }),
    schedule({ id: "future", date: "2026-08-25" }),
    schedule({
      id: "overdue",
      date: "2026-08-19",
      status: "in_progress",
    }),
  ];

  const focus = selectNextWorkoutFocus([], null, candidates, "2026-08-21");

  assert.equal(focus?.schedule?.id, "overdue");
  assert.equal(focus?.timing, "overdue");
  assert.equal(focus?.plannedDate, "2026-08-19");
});

test("dated workouts are classified as today or future", () => {
  const todayFocus = selectNextWorkoutFocus(
    [],
    null,
    [schedule({ id: "today", date: "2026-08-21" })],
    "2026-08-21",
  );
  const futureFocus = selectNextWorkoutFocus(
    [],
    null,
    [schedule({ id: "future", date: "2026-08-22" })],
    "2026-08-21",
  );

  assert.equal(todayFocus?.timing, "today");
  assert.equal(futureFocus?.timing, "future");
});

test("next workouts lists every planned calendar occurrence from today onward", () => {
  const schedules = [
    schedule({ id: "past", date: "2026-08-20" }),
    schedule({ id: "today", date: "2026-08-21", sequence: 2 }),
    schedule({ id: "first-future", date: "2026-08-23", sequence: 2 }),
    schedule({ id: "second-future", date: "2026-08-23", sequence: 3 }),
    schedule({ id: "active", date: "2026-08-24", status: "in_progress" }),
    schedule({ id: "skipped", date: "2026-08-24", status: "skipped" }),
    schedule({ id: "finished", date: "2026-08-24", status: "completed" }),
  ];

  assert.deepEqual(
    listUpcomingWorkouts(schedules, "2026-08-21").map(({ id }) => id),
    ["today", "first-future", "second-future", "active", "skipped"],
  );
});

test("same-day choices use sequence then id without mutating input", () => {
  const schedules = [
    schedule({ id: "z", date: "2026-08-21", sequence: 2 }),
    schedule({ id: "b", date: "2026-08-21", sequence: 1 }),
    schedule({ id: "a", date: "2026-08-21", sequence: 1 }),
  ];
  const originalOrder = schedules.map((item) => item.id);

  const focus = selectNextWorkoutFocus([], null, schedules, "2026-08-21");

  assert.equal(focus?.schedule?.id, "a");
  assert.deepEqual(
    schedules.map((item) => item.id),
    originalOrder,
  );
});

test("there is no focus when every occurrence is unscheduled or finished", () => {
  const focus = selectNextWorkoutFocus(
    [],
    null,
    [
      schedule({ id: "undated", date: undefined }),
      schedule({ id: "completed", date: "2026-08-21", status: "completed" }),
      schedule({ id: "skipped", date: "2026-08-22", status: "skipped" }),
    ],
    "2026-08-21",
  );

  assert.equal(focus, null);
});
