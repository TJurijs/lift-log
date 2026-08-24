import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("../app/LiftLogApp.tsx", import.meta.url);
const repositoryUrl = new URL("../lib/repository.ts", import.meta.url);
const stylesUrl = new URL("../app/globals.css", import.meta.url);
const availabilityMigrationUrl = new URL(
  "../supabase/migrations/202608220009_clear_calendar_when_removing_program_availability.sql",
  import.meta.url,
);
const calendarPreferenceMigrationUrl = new URL(
  "../supabase/migrations/202608220010_calendar_week_start_preference.sql",
  import.meta.url,
);
const accountUnitsMigrationUrl = new URL(
  "../supabase/migrations/202608220011_account_unit_preferences.sql",
  import.meta.url,
);

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

test("the primary training destination is labelled Next workouts", async () => {
  const app = await readFile(appUrl, "utf8");

  assert.ok(
    /\{\s*id:\s*["']today["'],\s*label:\s*["']Next workouts["']/.test(app),
    "the today route must be presented as Next workouts",
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
    /daySchedules\.map\(\(schedule\)[\s\S]*?event\.stopPropagation\(\)[\s\S]*?onOpenPlan\(schedule\)/.test(
      calendarView,
    ),
    "clicking a planned calendar event must open its workout plan",
  );
  assert.ok(
    /daySessions\.map\(\(session\)[\s\S]*?event\.stopPropagation\(\)[\s\S]*?onOpenResults\(session\)/.test(
      calendarView,
    ),
    "clicking a completed calendar event must open its saved results",
  );
  assert.ok(app.includes("repository.loadCompletedSessionDetail("));
  assert.ok(/async loadCompletedSessionDetail\s*\(/.test(repository));
  assert.match(
    app,
    /function openCalendarPlan[\s\S]*openWorkoutPreview\(schedule, "calendar"\)[\s\S]*navigate\("today"\)/,
    "planned calendar events must use the shared full workout preview",
  );
  assert.match(
    app,
    /function openCalendarResults[\s\S]*setDetail\(\{[\s\S]*kind: "completed-workout"[\s\S]*navigate\("today"\)/,
    "completed calendar events must use the shared full workout result screen",
  );
  assert.match(app, /function CompletedWorkoutView/);
  assert.doesNotMatch(app, /function CalendarWorkoutModal/);
});

test("calendar days schedule on a chosen date and allow quick drag rescheduling", async () => {
  const [app, styles] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
  ]);
  const calendarView = sourceBetween(
    app,
    "function CalendarView",
    "function ExercisesView",
  );

  assert.match(calendarView, /onScheduleDay\(date\)/);
  assert.match(app, /initialDate \?\? localDateOnly\(\)/);
  assert.match(
    calendarView,
    /draggable[\s\S]*?setData\("text\/plain", schedule\.id\)/,
  );
  assert.match(calendarView, /onMoveSchedule\(scheduleId, date\)/);
  assert.match(styles, /\.calendar-day\.schedule-target/);
});

test("user settings keep Monday and metric units as clean account defaults", async () => {
  const [app, repository, calendarMigration, unitsMigration] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(repositoryUrl, "utf8"),
    readFile(calendarPreferenceMigrationUrl, "utf8"),
    readFile(accountUnitsMigrationUrl, "utf8"),
  ]);
  const calendarView = sourceBetween(
    app,
    "function CalendarView",
    "function ExercisesView",
  );
  const accountModal = app.slice(app.indexOf("function AccountModal"));

  assert.match(
    calendarView,
    /weekStartsOnSunday[\s\S]*?\["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"\]/,
    "Monday must be the default first column",
  );
  assert.match(
    calendarView,
    /getDay\(\) - \(weekStartsOnSunday \? 0 : 1\) \+ 7/,
    "leading blank cells must follow the selected week start",
  );
  assert.match(accountModal, /User settings/);
  assert.match(accountModal, /Week starts on/);
  assert.match(accountModal, /<option value="monday">Monday<\/option>/);
  assert.match(accountModal, /<option value="sunday">Sunday<\/option>/);
  assert.match(accountModal, /Kilograms \(kg\)/);
  assert.match(accountModal, /Kilometres \(km\)/);
  assert.match(accountModal, /weightUnit,[\s\S]*?distanceUnit/);
  assert.match(repository, /target_week_starts_on_sunday: weekStartsOnSunday/);
  assert.match(calendarMigration, /week_starts_on_sunday boolean not null default false/i);
  assert.match(
    calendarMigration,
    /create or replace function public\.update_own_profile\([\s\S]*?target_week_starts_on_sunday boolean/i,
  );
  assert.match(unitsMigration, /weight_unit text not null default 'kg'/i);
  assert.match(unitsMigration, /distance_unit text not null default 'km'/i);
  assert.match(repository, /target_weight_unit: weightUnit/);
  assert.match(repository, /target_distance_unit: distanceUnit/);
});

test("scheduled workouts can be removed from plans, calendar hover, or availability", async () => {
  const [app, styles, migration] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
    readFile(availabilityMigrationUrl, "utf8"),
  ]);
  const calendarView = sourceBetween(
    app,
    "function CalendarView",
    "function ExercisesView",
  );
  assert.doesNotMatch(calendarView, /Next workout/);
  assert.match(calendarView, /calendar-event-remove[\s\S]*?onRemoveSchedule\(schedule\.id\)/);
  assert.match(calendarView, /CalendarMinus/);
  assert.doesNotMatch(calendarView, /onDeleteSchedule|Delete from calendar/);
  assert.match(styles, /\.calendar-planned-event:hover \.calendar-event-remove/);
  assert.match(
    app,
    /onRemoveFromCalendar[\s\S]*?Remove workout from calendar[\s\S]*?Remove from calendar/,
    "the shared workout preview must retain calendar removal",
  );
  assert.match(
    app,
    /onReschedule[\s\S]*?Reschedule workout[\s\S]*?Reschedule/,
    "the shared workout preview must retain calendar rescheduling",
  );
  assert.match(
    migration,
    /make_available then[\s\S]*?else[\s\S]*?delete from public\.scheduled_workouts[\s\S]*?scheduled\.status = 'planned'[\s\S]*?not exists[\s\S]*?workout_sessions/i,
    "removing availability must clear unstarted scheduled workouts",
  );
});

test("Calendar owns removal while permanent deletion stays in Programs", async () => {
  const app = await readFile(appUrl, "utf8");
  const programsHome = sourceBetween(app, "function ProgramsHome", "function CoachProgramEmpty");
  const programRow = sourceBetween(app, "function ProgramRow", "function ProgramsHome");

  assert.doesNotMatch(programsHome, /In schedule|availabilityAction|onAvailability/);
  assert.match(programsHome, /Final programs and workouts are ready to schedule/);
  assert.match(programsHome, /programItems[\s\S]*workoutItems/);
  assert.match(programsHome, />Programs<[/]strong>/);
  assert.match(programsHome, />Single workouts<[/]strong>/);
  assert.match(programRow, /onSchedule[\s\S]*?CalendarPlus/);
  assert.match(programRow, /canDelete && onDelete/);
});

test("Programs have no template-copy route and remain readable", async () => {
  const [app, styles] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
  ]);
  assert.doesNotMatch(app, /function LibraryProgramsView|function LibraryTemplateCard/);
  assert.doesNotMatch(app, /handleTemplateAction|copyProgramToOwn/);
  assert.match(
    styles,
    /\.program-card-description\s*\{[^}]*color: var\(--text-soft\)[^}]*font-size: 10px[^}]*white-space: normal/,
    "program descriptions must remain visible rather than truncate to a faint single line",
  );
});
