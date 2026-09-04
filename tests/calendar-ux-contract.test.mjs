import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("../app/LiftLogApp.tsx", import.meta.url);
const calendarViewUrl = new URL(
  "../app/features/calendar/CalendarView.tsx",
  import.meta.url,
);
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

  assert.match(
    app,
    /const CalendarView = lazy\(\(\) => import\("\.\/features\/calendar\/CalendarView"\)\)/,
    "the calendar must stay outside the initial application chunk",
  );
  assert.match(
    app,
    /loadingWorkspaceFeature[\s\S]*Loading \{loadingWorkspaceFeature\}…/,
    "opening a lazily loaded workspace feature must expose progress",
  );
  assert.ok(scheduleModal.includes("Add to calendar"));
  assert.ok(scheduleModal.includes("Reschedule"));
  assert.ok(scheduleModal.includes("Unschedule"));
  assert.ok(
    /LoaderCircle[\s\S]*button-spinner/.test(scheduleModal),
    "the save action must have an animated progress icon",
  );
  assert.ok(scheduleModal.includes("plannedDate"));
  assert.match(
    scheduleModal,
    /setDate\(\(currentDate\) => candidate\.plannedDate \?\? currentDate\)/,
    "switching workouts must preserve the date chosen from Calendar",
  );
  assert.doesNotMatch(
    scheduleModal,
    /setDate\(next\?\.plannedDate \?\? localDateOnly\(\)\)/,
    "switching workouts must not reset the chosen date to today",
  );
  assert.ok(
    /const action = originalDate[\s\S]*date === originalDate[\s\S]*"unschedule"[\s\S]*"reschedule"/.test(
      scheduleModal,
    ),
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

test("the mobile calendar fits all seven days without horizontal scrolling", async () => {
  const styles = await readFile(stylesUrl, "utf8");

  assert.match(
    styles,
    /\.calendar-grid\s*\{[^}]*grid-template-columns:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\)[^}]*overflow-x:\s*hidden/s,
  );
  assert.doesNotMatch(
    styles,
    /\.calendar-grid\s*\{[^}]*grid-template-columns:\s*repeat\(7,\s*minmax\(46px,\s*1fr\)\)/s,
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
  const [app, calendarView, repository] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(calendarViewUrl, "utf8"),
    readFile(repositoryUrl, "utf8"),
  ]);

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
  assert.match(
    app,
    /restoreCompletedWorkoutFromHistory[\s\S]*repository[\s\S]*\.loadCompletedSessionDetail\(/,
  );
  assert.ok(/async loadCompletedSessionDetail\s*\(/.test(repository));
  assert.match(
    app,
    /function openCalendarPlan[\s\S]*openWorkoutPreview\(schedule, "calendar", false\)[\s\S]*setActiveView\("today"\)[\s\S]*pushAppDetailHistory\("workout", "today"\)/,
    "planned calendar events must use the shared full workout preview",
  );
  assert.match(
    app,
    /function openCalendarResults[\s\S]*pushAppDetailHistory\("workout-log", "today"[\s\S]*kind: "workout-log"[\s\S]*session[\s\S]*restoreCompletedWorkoutFromHistory/,
    "completed calendar events must use the shared full workout result screen",
  );
  assert.match(app, /function CompletedWorkoutView/);
  assert.doesNotMatch(app, /function CalendarWorkoutModal/);
});

test("calendar always shows completed history without a visibility control", async () => {
  const calendarView = await readFile(calendarViewUrl, "utf8");

  assert.match(calendarView, /for \(const session of sessions\)/);
  assert.doesNotMatch(calendarView, /Show completed|Hide completed/);
});

test("Next workouts keeps completed history optional and opens results back to Next workouts", async () => {
  const app = `${await readFile(appUrl, "utf8")}\n${await readFile(new URL("../app/features/next-workouts/NextWorkoutsView.tsx", import.meta.url), "utf8")}`;

  assert.match(
    app,
    /function NextWorkoutsView[\s\S]*const \[showCompleted, setShowCompleted\] = useState\(false\)/,
  );
  assert.match(app, /showCompleted \? "Hide completed" : "Show completed"/);
  assert.match(
    app,
    /onOpenCompleted=\{\(session\) =>[\s\S]*openCalendarResults\(session, undefined, "today"\)/,
  );
});

test("completed workout logs mirror the active logging grid and RPE palette", async () => {
  const [app, styles] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
  ]);
  const completedView = sourceBetween(
    app,
    "function CompletedWorkoutView",
    "function inferredExerciseDiscipline",
  );

  assert.match(completedView, /completed-log-header/);
  assert.match(completedView, /completed-log-entry/);
  assert.match(completedView, /completed-log-value/);
  assert.match(completedView, /rpe-\$\{rpeTone\(String\(value\)\)\}/);
  assert.match(styles, /\.completed-log-value\s*\{[^}]*font-size:\s*16px/s);
  assert.match(styles, /\.completed-log-value\.rpe-easy/);
  assert.match(styles, /\.completed-log-value\.rpe-hard/);
  assert.match(styles, /\.completed-log-value\.rpe-very-hard/);
});

test("calendar days schedule on a chosen date and allow quick drag rescheduling", async () => {
  const [app, calendarView, styles] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(calendarViewUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
  ]);

  assert.match(calendarView, /onScheduleDay\(date\)/);
  assert.match(app, /initialDate \?\? localDateOnly\(\)/);
  assert.match(
    calendarView,
    /draggable[\s\S]*?setData\("text\/plain", schedule\.id\)/,
  );
  assert.match(calendarView, /onMoveSchedule\(scheduleId, date\)/);
  assert.match(
    calendarView,
    /onVisibleRangeChange\?\.\(monthStart, monthEnd\)/,
    "month navigation must request only the visible server-backed date range",
  );
  assert.match(styles, /\.calendar-day\.schedule-target/);
});

test("user settings keep Monday and metric units as clean account defaults", async () => {
  const [app, calendarView, repository, calendarMigration, unitsMigration] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(calendarViewUrl, "utf8"),
    readFile(repositoryUrl, "utf8"),
    readFile(calendarPreferenceMigrationUrl, "utf8"),
    readFile(accountUnitsMigrationUrl, "utf8"),
  ]);
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
  const [app, calendarView, styles, migration] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(calendarViewUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
    readFile(availabilityMigrationUrl, "utf8"),
  ]);
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

test("Calendar owns occurrence removal while reusable content stays in Programs", async () => {
  const app = await readFile(appUrl, "utf8");
  const programsHome = sourceBetween(app, "function ProgramsHome", "function CoachProgramEmpty");
  const programRow = sourceBetween(app, "function ProgramRow", "function ProgramsHome");

  assert.doesNotMatch(programsHome, /In schedule|availabilityAction|onAvailability/);
  assert.match(
    programsHome,
    /saved for future (?:runs|uses) without altering active or completed plans/i,
  );
  assert.match(programsHome, /programItems[\s\S]*workoutItems/);
  assert.match(programsHome, />Programs<[/]strong>/);
  assert.match(programsHome, />Single workouts<[/]strong>/);
  assert.match(programRow, /onSchedule[\s\S]*?CalendarPlus/);
  assert.match(programRow, /canDelete && onDelete/);
});

test("Programs have no template route and reusable content can be duplicated", async () => {
  const [app, styles] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
  ]);
  assert.doesNotMatch(app, /function LibraryProgramsView|function LibraryTemplateCard/);
  assert.doesNotMatch(app, /handleTemplateAction/);
  assert.match(app, /copyProgramToOwn/);
  assert.match(
    styles,
    /\.program-card-description\s*\{[^}]*color: var\(--text-soft\)[^}]*font-size: var\(--font-caption\)[^}]*white-space: normal/,
    "program descriptions must remain visible rather than truncate to a faint single line",
  );
});
