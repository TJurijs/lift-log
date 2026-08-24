import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const domainUrl = new URL("../lib/domain.ts", import.meta.url);
const repositoryUrl = new URL("../lib/repository.ts", import.meta.url);
const appUrl = new URL("../app/LiftLogApp.tsx", import.meta.url);
const overviewMigrationUrl = new URL(
  "../supabase/migrations/202608240008_bounded_coach_workspace_overview.sql",
  import.meta.url,
);

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);

  assert.notEqual(startIndex, -1, `expected source marker: ${start}`);
  assert.notEqual(endIndex, -1, `expected source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("coach athlete summaries expose assigned-program progress and a scoped agenda", async () => {
  const domain = await readFile(domainUrl, "utf8");
  const assignedProgram = sourceBetween(
    domain,
    "export interface CoachAssignedProgramSummary",
    "export interface CoachAgendaEntry",
  );
  const agendaEntry = sourceBetween(
    domain,
    "export interface CoachAgendaEntry",
    "export interface AthleteSummary",
  );
  const athleteSummary = sourceBetween(
    domain,
    "export interface AthleteSummary",
    "export interface CoachConnection",
  );

  assert.match(
    domain,
    /"awaiting_schedule"[\s\S]*"scheduled"[\s\S]*"in_progress"[\s\S]*"completed"/,
  );
  for (const field of [
    "id",
    "versionId",
    "title",
    "assignedAt",
    "status",
    "totalWorkouts",
    "scheduledWorkouts",
    "scheduledPercent",
    "completedWorkouts",
    "completionPercent",
    "nextWorkout",
  ]) {
    assert.match(assignedProgram, new RegExp(`\\b${field}\\??:`));
  }
  for (const field of [
    "status",
    "programId",
    "programVersionId",
    "programTitle",
    "workoutTitle",
    "date",
    "rpe",
    "scheduleId",
    "sessionId",
  ]) {
    assert.match(agendaEntry, new RegExp(`\\b${field}\\??:`));
  }
  assert.match(agendaEntry, /kind: "upcoming" \| "completed"/);
  assert.match(
    agendaEntry,
    /status: "planned" \| "overdue" \| "in_progress" \| "completed"/,
  );
  assert.match(
    athleteSummary,
    /assignedPrograms: CoachAssignedProgramSummary\[\]/,
  );
  assert.match(athleteSummary, /detailsLoaded\?: boolean/);
  assert.match(athleteSummary, /agenda: CoachAgendaEntry\[\]/);
  assert.doesNotMatch(
    athleteSummary,
    /programTitle|completedThisWeek|plannedThisWeek|latestRpe|lastTrainingLabel|trend|upcomingSessions/,
  );
});

test("coach overview is identity-only and selected detail is hard bounded", async () => {
  const migration = await readFile(overviewMigrationUrl, "utf8");
  const overview = sourceBetween(
    migration,
    "create or replace function public.list_authored_coach_athlete_overviews",
    "create or replace function public.get_authored_coach_athlete_detail",
  );
  const detail = sourceBetween(
    migration,
    "create or replace function public.get_authored_coach_athlete_detail",
    "revoke all on function private.authored_coach_program_summaries",
  );

  assert.match(overview, /target_limit integer default 250/);
  assert.match(overview, /relationship\.coach_id = \(select auth\.uid\(\)\)/);
  assert.match(overview, /relationship\.ended_at is null/);
  assert.match(
    overview,
    /limit least\(greatest\(coalesce\(target_limit, 250\), 1\), 250\)/,
  );
  assert.doesNotMatch(overview, /authored_coach_program_summaries/);
  assert.doesNotMatch(overview, /authored_coach_agenda_summaries/);
  assert.doesNotMatch(overview, /workout_sessions|scheduled_workouts/);

  assert.match(detail, /relationship\.athlete_id = target_athlete_id/);
  assert.match(detail, /relationship\.coach_id = \(select auth\.uid\(\)\)/);
  assert.match(detail, /relationship\.ended_at is null/);
  assert.match(detail, /authored_coach_program_summaries\([\s\S]*250/);
  assert.match(
    detail,
    /authored_coach_agenda_summaries\([\s\S]*target_upcoming_limit[\s\S]*target_completed_limit/,
  );
  assert.doesNotMatch(migration, /athlete_note|item_note|entry_note/);
});

test("coach workspace data is restricted to programs created by the current coach", async () => {
  const repository = await readFile(repositoryUrl, "utf8");
  const loader = sourceBetween(
    repository,
    "private async loadCoachedAthletes",
    "private async loadPendingCoachInvites",
  );

  assert.match(
    loader,
    /this\.client\.rpc\([\s\S]*"list_authored_coach_athlete_overviews"[\s\S]*target_limit: 250/,
  );
  assert.match(loader, /return parseCoachAthleteOverviews\(result\.data\)/);
  assert.doesNotMatch(loader, /\.from\(/);
  assert.doesNotMatch(loader, /collectAllPages|collectAllBatches|while \(/);
  assert.doesNotMatch(loader, /listAuthoredCoachSessionSummaries/);
  assert.doesNotMatch(loader, /athlete_note/);
});

test("selected athlete detail is loaded only when coach mode or selection requests it", async () => {
  const app = await readFile(appUrl, "utf8");
  const detailLoader = sourceBetween(
    app,
    "async function loadCoachedAthleteDetail",
    "async function refreshCoachWorkspace",
  );
  const modeAndSelection = sourceBetween(
    app,
    "function changeCoachMode",
    "function updateSet",
  );

  assert.match(
    detailLoader,
    /current\?\.detailsLoaded !== false[\s\S]*repository\.loadCoachedAthleteDetail\(athleteId\)/,
  );
  assert.match(
    detailLoader,
    /coachedAthletes: previous\.coachedAthletes\.map[\s\S]*athlete\.id === athleteId \? detail : athlete/,
  );
  assert.match(
    modeAndSelection,
    /nextMode === "coach"[\s\S]*selectedAthlete\.detailsLoaded === false[\s\S]*loadCoachedAthleteDetail\(selectedAthlete\.id\)/,
  );
  assert.match(
    modeAndSelection,
    /function selectCoachedAthlete[\s\S]*athlete\.detailsLoaded === false[\s\S]*loadCoachedAthleteDetail\(athlete\.id\)/,
  );
});

test("program progress uses the latest sequence cycle and agenda entries retain navigation ids", async () => {
  const migration = await readFile(overviewMigrationUrl, "utf8");

  assert.match(
    migration,
    /cycle_bound\.maximum_sequence[\s\S]*floor\([\s\S]*cycle_bound\.maximum_sequence - 1[\s\S]*workout_totals\.total_workouts/,
  );
  assert.match(
    migration,
    /count\(\*\) filter \([\s\S]*schedule\.status = 'completed'[\s\S]*as completed_workouts/,
  );
  assert.match(
    migration,
    /cycle_stats\.cycle_size >= workout_totals\.total_workouts[\s\S]*cycle_stats\.all_terminal/,
  );
  assert.match(
    migration,
    /cycle_stats\.has_started then 'in_progress'[\s\S]*cycle_stats\.has_scheduled_date then 'scheduled'[\s\S]*'awaiting_schedule'/,
  );
  assert.match(
    migration,
    /'completionPercent'[\s\S]*least\([\s\S]*100,[\s\S]*cycle_stats\.completed_workouts/,
    "legacy or repeated occurrences must never report more than 100 percent",
  );
  assert.match(migration, /'kind', 'upcoming'[\s\S]*'scheduleId', schedule\.id/);
  assert.match(
    migration,
    /schedule\.status = 'in_progress' then 'in_progress'[\s\S]*schedule\.planned_date < target_today then 'overdue'[\s\S]*'planned'/,
  );
  assert.match(
    migration,
    /'kind', 'completed'[\s\S]*'rpe', session\.session_rpe[\s\S]*'sessionId', session\.id/,
  );
});

test("coach agenda preserves completed history after program deactivation", async () => {
  const migration = await readFile(overviewMigrationUrl, "utf8");
  const agenda = sourceBetween(
    migration,
    "create or replace function private.authored_coach_agenda_summaries",
    "create or replace function public.list_authored_coach_athlete_overviews",
  );
  const authoredVersions = sourceBetween(
    agenda,
    "with authored_versions as materialized",
    "upcoming as",
  );
  const upcoming = sourceBetween(agenda, "upcoming as", "completed as");
  const completed = sourceBetween(
    agenda,
    "completed as",
    "select\n    coalesce",
  );

  assert.match(authoredVersions, /program\.is_current,[\s\S]*program\.archived_at/);
  assert.doesNotMatch(
    authoredVersions,
    /and program\.is_current = true[\s\S]*and program\.archived_at is null/,
  );
  assert.match(
    upcoming,
    /authored\.is_current = true[\s\S]*authored\.archived_at is null/,
  );
  assert.doesNotMatch(completed, /is_current|archived_at/);
});

test("coach overview evaluates calendar status in the athlete timezone", async () => {
  const migration = await readFile(overviewMigrationUrl, "utf8");
  const detail = sourceBetween(
    migration,
    "create or replace function public.get_authored_coach_athlete_detail",
    "revoke all on function private.authored_coach_program_summaries",
  );

  assert.match(detail, /from pg_catalog\.pg_timezone_names/);
  assert.match(
    detail,
    /current_timestamp at time zone athlete\.timezone\)::date/,
  );
  assert.match(
    detail,
    /authored_coach_program_summaries\([\s\S]*athlete_date\.today/,
  );
  assert.match(
    detail,
    /authored_coach_agenda_summaries\([\s\S]*athlete_date\.today/,
  );
});

test("specific athlete program and completed results have read-only coach paths", async () => {
  const repository = await readFile(repositoryUrl, "utf8");
  const programLoader = sourceBetween(
    repository,
    "async loadProgramForAthleteById",
    "async loadProgramVersionForAthleteById",
  );
  const versionLoader = sourceBetween(
    repository,
    "async loadProgramVersionForAthleteById",
    "private async loadProgramCatalog",
  );
  const detailLoader = sourceBetween(
    repository,
    "async loadCompletedSessionDetail",
    "private async listCompletedSessions",
  );

  assert.match(
    programLoader,
    /\.eq\("id", programId\)[\s\S]*\.eq\("athlete_id", athleteId\)[\s\S]*\.eq\("created_by_id", this\.viewerId\)[\s\S]*\.eq\("source_type", "coach"\)/,
  );
  assert.match(
    programLoader,
    /await this\.loadProgramPair\(athleteId, programId\)/,
  );
  assert.doesNotMatch(programLoader, /createProgramDraft|loadEditableProgram/);
  assert.match(
    versionLoader,
    /\.eq\("id", programId\)[\s\S]*\.eq\("athlete_id", athleteId\)[\s\S]*\.eq\("created_by_id", this\.viewerId\)[\s\S]*\.eq\("source_type", "coach"\)/,
  );
  assert.match(
    versionLoader,
    /\.from\("program_versions"\)[\s\S]*\.eq\("id", versionId\)[\s\S]*\.eq\("program_id", programId\)[\s\S]*\.in\("status", \["published", "superseded"\]\)/,
  );
  assert.match(
    versionLoader,
    /return this\.loadVersionTree\([\s\S]*programRow,[\s\S]*version,[\s\S]*ownerName,[\s\S]*createdByName/,
  );
  assert.doesNotMatch(
    versionLoader,
    /createProgramDraft|loadEditableProgram|loadProgramPair/,
  );
  assert.match(
    detailLoader,
    /athleteId !== this\.viewerId[\s\S]*"get_authored_coach_session_detail"[\s\S]*target_session_id: sessionId/,
  );
  assert.match(
    detailLoader,
    /\.eq\("athlete_id", this\.viewerId\)[\s\S]*\.eq\("status", "completed"\)/,
    "direct note-bearing history remains athlete-only",
  );
  assert.match(detailLoader, /this\.loadOwnSessionNotes\(session\.id\)/);
  assert.doesNotMatch(detailLoader, /athlete_note|\.select\("\*"\)/);
});
