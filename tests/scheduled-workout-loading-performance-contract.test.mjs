import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("../app/LiftLogApp.tsx", import.meta.url);
const repositoryUrl = new URL("../lib/repository.ts", import.meta.url);
const migrationUrl = new URL(
  "../supabase/migrations/202608290001_v1_performance_data_architecture.sql",
  import.meta.url,
);

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);

  assert.notEqual(startIndex, -1, `expected source marker: ${start}`);
  assert.notEqual(endIndex, -1, `expected source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("calendar and training lists use bounded summary RPCs", async () => {
  const [repository, migration] = await Promise.all([
    readFile(repositoryUrl, "utf8"),
    readFile(migrationUrl, "utf8"),
  ]);
  const calendar = sourceBetween(
    repository,
    "async listCalendarOccurrences(",
    "async listCompletedSessionSummaries(",
  );
  const training = sourceBetween(
    repository,
    "async listProgramRuns(",
    "async loadProgramRunDetail(",
  );

  assert.match(calendar, /rpc\("list_calendar_occurrences"/);
  assert.match(calendar, /rpc\("list_calendar_session_summaries"/);
  assert.match(calendar, /range_start: rangeStart[\s\S]*range_end: rangeEnd/);
  assert.match(calendar, /page_limit: limit \+ 1/);
  assert.match(calendar, /after_planned_date:[\s\S]*after_id:/);
  assert.match(calendar, /parseScheduledWorkoutSummary\(row, this\.viewerId\)/);
  const summaryParser = sourceBetween(repository, "function parseScheduledWorkoutSummary(", "function parseOwnSessionNotes(");
  assert.match(summaryParser, /jsonInteger\(row, "estimated_minutes", "estimatedMinutes"\) \?\? undefined/);
  assert.match(summaryParser, /durationMinutes: estimatedMinutes/);
  assert.match(summaryParser, /detailsLoaded: false/);
  assert.match(summaryParser, /sections: \[\]/);
  assert.doesNotMatch(calendar, /\.from\("(?:workout_sections|workout_items|prescribed_entries)"\)/);

  const calendarWorkspace = sourceBetween(
    repository,
    "async loadCalendarRange(",
    "async loadCoachingWorkspace(",
  );
  assert.match(
    calendarWorkspace,
    /Promise\.all\(\[[\s\S]*listCalendarOccurrences\(rangeStart, rangeEnd[\s\S]*listCalendarSessionSummaries\(rangeStart, rangeEnd\)/,
  );
  assert.doesNotMatch(calendarWorkspace, /listCompletedSessionSummaries/);

  assert.match(training, /rpc\("list_program_run_summaries"/);
  assert.match(training, /page_limit: limit \+ 1/);
  assert.match(training, /status_scope: statusScope/);
  assert.match(training, /after_sort_date: options\.cursor\?\.sortDate/);
  assert.doesNotMatch(training, /getProgramVersionDetail|loadProgramDetail|\.from\(/);
  assert.doesNotMatch(repository, /async (?:listSchedulableWorkouts|listFrequentSchedulableWorkouts|listUpcomingScheduledWorkouts|createScheduledQuickWorkoutRun|unassignProgram)\(/);

  assert.match(migration, /create or replace function public\.list_calendar_occurrences/);
  assert.match(migration, /create or replace function public\.list_calendar_session_summaries/);
  assert.match(migration, /idx_scheduled_workouts_athlete_calendar/);
  assert.match(migration, /idx_scheduled_workouts_assignment_sequence/);
});

test("a selected scheduled workout hydrates its full tree with one RPC", async () => {
  const [app, repository, migration] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(repositoryUrl, "utf8"),
    readFile(migrationUrl, "utf8"),
  ]);
  const detail = sourceBetween(
    repository,
    "async loadScheduledWorkoutDetail(",
    "async updateOwnProfile(",
  );

  assert.match(detail, /rpc\("get_scheduled_workout_detail"/);
  assert.match(detail, /target_schedule_id: scheduleId/);
  assert.match(detail, /parseWorkoutPayload/);
  assert.match(detail, /detailsLoaded: true/);
  assert.doesNotMatch(detail, /\.from\(/);
  assert.match(
    migration,
    /create or replace function public\.get_scheduled_workout_detail\([\s\S]*target_schedule_id uuid/,
  );
  assert.match(
    app,
    /async function ensureScheduledWorkoutDetails[\s\S]*repository\.loadScheduledWorkoutDetail/,
  );
  assert.match(
    app,
    /async function openWorkoutPreview[\s\S]*ensureScheduledWorkoutDetails/,
  );
  assert.match(app, /async function startWorkout[\s\S]*ensureScheduledWorkoutDetails/);
});
