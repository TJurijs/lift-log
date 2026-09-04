import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("../app/LiftLogApp.tsx", import.meta.url);
const nextViewUrl = new URL("../app/features/next-workouts/NextWorkoutsView.tsx", import.meta.url);
const stylesUrl = new URL("../app/globals.css", import.meta.url);
const repositoryUrl = new URL("../lib/repository.ts", import.meta.url);
const migrationUrl = new URL(
  "../supabase/migrations/202608220012_complete_sessions_on_scheduled_date.sql",
  import.meta.url,
);
const statusMigrationUrl = new URL(
  "../supabase/migrations/202608220013_skip_or_restore_scheduled_workouts.sql",
  import.meta.url,
);

test("Next workouts opens a full read-only workout preview before starting", async () => {
  const app = `${await readFile(appUrl, "utf8")}\n${await readFile(nextViewUrl, "utf8")}`;

  assert.match(app, /title="Next workouts"/);
  assert.match(app, /function NextWorkoutsView/);
  assert.match(app, /schedules=\{upcomingWorkouts\}/);
  assert.match(app, /onOpen=\{\(schedule\) => \{[\s\S]*?openWorkoutPreview\(schedule\)/);
  assert.match(app, /onStart=\{\(schedule\) => \{[\s\S]*?startWorkout\(schedule\)/);
  assert.match(app, /workoutPreviewSchedule/);
  assert.match(app, /viewMode=\{showingWorkoutPreview\}/);
  assert.match(
    app,
    /const showingWorkoutPreview = Boolean\(workoutPreviewSchedule\)[\s\S]*?\(\(showingWorkoutPreview && workoutPreviewSchedule\)[\s\S]*?allowStart=\{!showingWorkoutPreview \|\| !activeSession\}/,
    "another planned workout remains previewable while an active session is safely preserved",
  );
  assert.match(app, /Workout preview/);
  assert.match(app, /Next workouts/);
  assert.match(app, /Set back to planned/);
  assert.match(app, /statusAction === "skipped"[\s\S]*"Skip"/);
  assert.match(
    app,
    /onRemoveFromCalendar=\{[\s\S]*?workoutPreviewSchedule[\s\S]*?saveSchedule\(scheduleId, null\)/,
    "an unstarted workout can be removed from the calendar from its preview",
  );
  assert.match(app, /className="icon-button"[\s\S]*aria-label="Remove workout from calendar"/);
  assert.match(app, /className=\{`workout-preview-actions\$\{workoutStarted/);
  assert.match(app, /className="workout-action-compact">Workouts</);
  assert.match(app, /const isQuickWorkout = program\?\.contentType === "quick_workout"/);
  assert.match(app, /isQuickWorkout\s*\?\s*undefined/);
  assert.match(app, /!isQuickWorkout && \([\s\S]*?Session \$\{workoutIndex \+ 1\} of/);
  assert.match(app, /isQuickWorkout \? \([\s\S]*?program\.description/);
  assert.match(app, /workout-preview-actions\$\{workoutStarted \? " started"/);
  assert.match(app, /className="workout-action-compact">Planned</);
  assert.match(app, /const \[activeWorkoutVisible, setActiveWorkoutVisible\]/);
  assert.match(
    app,
    /if \(view === "today" && activeSession && activeWorkoutVisible\)[\s\S]*?setActiveWorkoutVisible\(false\)/,
  );
  assert.match(app, /activeSession\s*\?\s*\(\) => leaveDetail\("today"\)/);
  assert.match(app, /view === "today" && activeSession && activeWorkoutVisible[\s\S]*?setActiveWorkoutVisible\(false\)/);
  assert.match(app, /activeScheduleId === schedule\.id[\s\S]*?"Resume workout"/);
  assert.match(app, /viewScheduledPlan\(workoutPreviewSchedule\)/);
  assert.match(app, /loadOwnScheduledProgramVersionById/);
  assert.match(app, /previewProgram\?\.contentType !== "quick_workout"/);
  assert.match(app, /viewMode && onViewProgram/);
  assert.match(app, /className="icon-button"[\s\S]*aria-label="View program"/);
  assert.match(
    app,
    /aria-label="View program"[\s\S]*aria-label="Remove workout from calendar"[\s\S]*statusAction === "skipped"/,
    "preview actions should be ordered as program, unschedule, then skip",
  );
  assert.match(
    app,
    /programWorkoutPreviewOriginRef\.current = \{[\s\S]*schedule,[\s\S]*returnView: workoutPreviewReturnView/,
  );
  assert.match(
    app,
    /const workoutPreviewOrigin = programWorkoutPreviewOriginRef\.current[\s\S]*openWorkoutPreview\([\s\S]*workoutPreviewOrigin\.schedule,[\s\S]*workoutPreviewOrigin\.returnView,[\s\S]*false/,
    "program Back should restore the workout preview that opened it",
  );
  assert.doesNotMatch(app, />\s*Edit plan\s*</);
  assert.match(app, /Every workout scheduled from today onward/);
});

test("mobile workout cards reserve stable action space", async () => {
  const [app, styles] = await Promise.all([
    readFile(nextViewUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
  ]);

  assert.match(app, /loadingLabel="Starting…"/);
  assert.match(styles, /\.next-workout-card\s*\{[^}]*grid-template-areas:[^}]*"date action"[^}]*"summary action"/s);
  assert.match(styles, /\.next-workout-card > \.button\s*\{[^}]*width: 132px[^}]*white-space: nowrap/s);
  assert.match(styles, /\.workout-preview-actions\.started\s*\{[^}]*grid-template-columns:/s);
});

test("Next workouts renders server-loaded pages without hiding items in local pagination", async () => {
  const component = await readFile(nextViewUrl, "utf8");

  assert.match(component, /hasMore = false/);
  assert.match(component, /loading = false/);
  assert.match(component, /error = null/);
  assert.match(component, /hasMore\?: boolean/);
  assert.match(component, /loading\?: boolean/);
  assert.match(component, /error\?: string \| null/);
  assert.match(component, /onLoadMore\?: \(\) => void/);
  assert.match(component, /schedules\.map\(\(schedule\) =>/);
  assert.doesNotMatch(component, /schedules\.slice\(/);
  assert.doesNotMatch(component, /currentPage|pageCount|Upcoming workout pages/);
  assert.match(component, /role="alert"[\s\S]*?Try again/);
  assert.match(
    component,
    /<AsyncButton[\s\S]*?loading=\{loading\}[\s\S]*?loadingLabel="Loading workouts…"[\s\S]*?>\s*Load more workouts/,
  );
  assert.match(component, /if \(loading \|\| error \|\| hasMore\)/);
});

test("Next paging preserves reset retries and queues mutation refreshes", async () => {
  const app = await readFile(appUrl, "utf8");
  const loader = app.slice(
    app.indexOf("const loadUpcomingWorkouts = useCallback"),
    app.indexOf("const loadProgramForRunWizard"),
  );

  assert.match(loader, /upcomingLoadingRef\.current[\s\S]*if \(reset\) upcomingPendingResetRef\.current = true/);
  assert.match(loader, /upcomingCursorRef\.current = page\.nextCursor/);
  assert.match(loader, /upcomingFailedResetRef\.current = reset/);
  assert.match(loader, /upcomingPendingResetRef\.current[\s\S]*upcomingLoaderRef\.current\?\.\(true\)/);
  assert.match(
    app,
    /loadUpcomingWorkouts\([\s\S]*upcomingFailedResetRef\.current \|\|[\s\S]*!upcomingInitializedRef\.current/,
  );
});

test("new scheduling uses a bounded server page and offers only eligible workouts", async () => {
  const [app, repository] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(repositoryUrl, "utf8"),
  ]);
  const scheduler = app.slice(app.indexOf("function ScheduleModal"));
  const choiceLabel = scheduler.slice(
    scheduler.indexOf("function workoutChoice"),
    scheduler.indexOf("async function save"),
  );

  assert.match(
    app,
    /repository\.listSchedulableWorkouts\(\{[\s\S]*limit:\s*50[\s\S]*cursor:/,
    "the scheduler must request a bounded keyset page instead of hydrating every program tree",
  );
  assert.match(repository, /async listSchedulableWorkouts\(/);
  assert.match(repository, /rpc\("list_schedulable_workouts"/);
  assert.match(repository, /page_limit:\s*limit \+ 1/);
  assert.match(repository, /after_program_title:[\s\S]*after_week_index:[\s\S]*after_workout_position:[\s\S]*after_id:/);
  assert.match(
    scheduler,
    /!candidate\.isQuickWorkout[\s\S]*latest\.status === "in_progress"[\s\S]*latest\.status === "completed"[\s\S]*latest\.status === "planned"/,
    "a program workout already planned, active, or completed must not be offered again",
  );
  assert.match(
    choiceLabel,
    /candidate\.workoutTitle[\s\S]*!candidate\.quickWorkout && <small>\{candidate\.programTitle\}<\/small>/,
    "quick workouts use only their name while program options use program and workout names",
  );
  assert.doesNotMatch(
    choiceLabel,
    /scheduleLabel|slotLabel/,
    "the compact picker label must omit version, week, and slot metadata",
  );
  assert.match(
    scheduler,
    /editingId[\s\S]*schedules\.find\(\(candidate\) => candidate\.id === editingId\)/,
    "editing must retain the exact existing occurrence even when it is not in the current page",
  );
  assert.match(
    scheduler,
    /latest\?\.status === "planned" && !latest\.plannedDate/,
    "an old unscheduled occurrence may be reused without creating duplicates",
  );
});

test("skipping or restoring a scheduled workout abandons an active draft safely", async () => {
  const [repository, migration] = await Promise.all([
    readFile(repositoryUrl, "utf8"),
    readFile(statusMigrationUrl, "utf8"),
  ]);

  assert.match(repository, /async setScheduledWorkoutStatus\(/);
  assert.match(repository, /set_scheduled_workout_status/);
  assert.match(migration, /target_status not in \('planned', 'skipped'\)/i);
  assert.match(
    migration,
    /update public\.workout_sessions[\s\S]*set status = 'abandoned'[\s\S]*status = 'in_progress'/i,
  );
  assert.match(migration, /set status = target_status/i);
});

test("starting and resetting a workout keep the occurrence state coherent", async () => {
  const app = await readFile(appUrl, "utf8");

  assert.match(
    app,
    /candidate\.id === schedule\.id[\s\S]*status: "in_progress"/,
  );
  assert.match(
    app,
    /activeSession\?\.scheduledWorkoutId === targetSchedule\.id[\s\S]*"resetToPlanned"/,
  );
});

test("finishing a scheduled workout keeps its planned calendar date", async () => {
  const [repository, migration] = await Promise.all([
    readFile(repositoryUrl, "utf8"),
    readFile(migrationUrl, "utf8"),
  ]);

  assert.match(
    repository,
    /date: session\.completed_for_date \?\? localDateOnly\(start\)/,
  );
  assert.match(migration, /add column if not exists completed_for_date date/i);
  assert.match(
    migration,
    /completed_for_date = coalesce\(scheduled_date, current_date\)/i,
  );
});
