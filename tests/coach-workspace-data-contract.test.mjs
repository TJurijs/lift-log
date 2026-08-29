import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const domainUrl = new URL("../lib/domain.ts", import.meta.url);
const repositoryUrl = new URL("../lib/repository.ts", import.meta.url);
const appUrl = new URL("../app/LiftLogApp.tsx", import.meta.url);
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

function sqlFunction(source, name) {
  const match = source.match(
    new RegExp(
      `create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  );
  assert.ok(match, `expected SQL function: ${name}`);
  return match[0];
}

test("coach summaries expose aggregate progress, stable assignment identity, and a scoped agenda", async () => {
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

  for (const field of [
    "id",
    "programId",
    "assignmentId",
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
  assert.match(agendaEntry, /kind: "upcoming" \| "completed"/);
  assert.match(
    agendaEntry,
    /status: "planned" \| "overdue" \| "in_progress" \| "completed"/,
  );
  for (const field of [
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
});

test("coach list and selected detail are keyset-bounded and authorize the active relationship", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const list = sqlFunction(migration, "list_coach_athletes");
  const detail = sqlFunction(migration, "get_coach_athlete_detail");

  assert.match(list, /after_display_name[\s\S]*after_id/);
  assert.match(list, /relationship\.coach_id = current_user_id/);
  assert.match(list, /relationship\.ended_at is null/);
  assert.match(list, /least\(greatest\(coalesce\(page_limit, 50\), 1\), 50\)/);
  assert.doesNotMatch(list, /workout_sessions|scheduled_workouts/);

  assert.match(detail, /relationship\.athlete_id = target_athlete_id/);
  assert.match(detail, /relationship\.coach_id = current_user_id/);
  assert.match(detail, /relationship\.ended_at is null/);
  assert.match(detail, /coalesce\(program_limit, 25\)[\s\S]*50/);
  assert.match(detail, /coalesce\(upcoming_limit, 6\)[\s\S]*12/);
  assert.match(detail, /coalesce\(completed_limit, 6\)[\s\S]*12/);
  assert.doesNotMatch(detail, /athlete_note|item_note|entry_note|workoutProgress/);
});

test("repository uses only the new bounded coach projections", async () => {
  const repository = await readFile(repositoryUrl, "utf8");
  const list = sourceBetween(
    repository,
    "async listCoachAthletes",
    "invalidatePrograms",
  );
  const detail = sourceBetween(
    repository,
    "async loadCoachedAthleteDetail",
    "async resolveCoachInviteTarget",
  );

  assert.match(list, /rpc\("list_coach_athletes"/);
  assert.match(list, /page_limit: limit \+ 1/);
  assert.match(list, /after_display_name:[\s\S]*after_id:/);
  assert.doesNotMatch(list, /\.from\(|collectAll|250/);

  assert.match(detail, /rpc\("get_coach_athlete_detail"/);
  assert.match(detail, /program_limit: 25/);
  assert.match(detail, /upcoming_limit: 6/);
  assert.match(detail, /completed_limit: 6/);
  assert.doesNotMatch(
    repository,
    /list_authored_coach_athlete_overviews|get_authored_coach_athlete_detail|target_progress_limit|target_program_limit: 250/,
  );
});

test("coaching workspace is two bounded requests and exposes its athlete cursor", async () => {
  const [domain, repository, migration] = await Promise.all([
    readFile(domainUrl, "utf8"),
    readFile(repositoryUrl, "utf8"),
    readFile(migrationUrl, "utf8"),
  ]);
  const workspace = sourceBetween(
    repository,
    "async loadCoachingWorkspace",
    "async loadProgramDetail",
  );
  const access = sqlFunction(migration, "get_coaching_access_summary");

  assert.match(domain, /coachAthleteCursor\?: CoachAthleteCursor/);
  assert.match(
    workspace,
    /Promise\.all\(\[[\s\S]*this\.loadCoachingAccessSummary\(\)[\s\S]*this\.listCoachAthletes\(\{ limit: 25 \}\)[\s\S]*coachAthleteCursor/,
  );
  assert.match(repository, /rpc\("get_coaching_access_summary"\)/);
  assert.doesNotMatch(
    workspace,
    /loadCoachConnections|loadPendingCoachInvites|loadOutgoingCoachInvites|list_connected_profile_summaries/,
  );
  assert.match(access, /'coachConnections'[\s\S]*'pendingCoachInvites'[\s\S]*'outgoingCoachInvites'/);
  assert.equal((access.match(/limit 25/g) ?? []).length, 3);
  assert.match(access, /relationship\.athlete_id = current_user_id[\s\S]*relationship\.ended_at is null/);
  assert.match(access, /request\.invited_profile_id = current_user_id/);
  assert.match(access, /request\.athlete_id = current_user_id/);
});

test("selected athlete detail remains lazy in coach mode and on explicit selection", async () => {
  const app = await readFile(appUrl, "utf8");
  const detailLoader = sourceBetween(
    app,
    "async function loadCoachedAthleteDetail",
    "async function refreshCoachWorkspace",
  );
  const modeAndSelection = sourceBetween(
    app,
    "function changeCoachMode",
    "async function updateWorkoutSettings",
  );

  assert.match(
    detailLoader,
    /current\?\.detailsLoaded !== false[\s\S]*repository\.loadCoachedAthleteDetail\(athleteId\)/,
  );
  assert.match(
    modeAndSelection,
    /nextMode === "coach"[\s\S]*detailsLoaded === false[\s\S]*loadCoachedAthleteDetail/,
  );
  assert.match(
    modeAndSelection,
    /function selectCoachedAthlete[\s\S]*detailsLoaded === false[\s\S]*loadCoachedAthleteDetail/,
  );
});

test("specific program and completed-result paths remain read-only and server-authorized", async () => {
  const repository = await readFile(repositoryUrl, "utf8");
  const migration = await readFile(migrationUrl, "utf8");
  const programDetail = sourceBetween(
    repository,
    "async getProgramVersionDetail",
    "async loadProgramForAthleteById",
  );
  const completedDetail = sourceBetween(
    repository,
    "async loadCompletedSessionDetail",
    "private async loadCoachingAccessSummary",
  );

  assert.match(programDetail, /rpc\("get_program_version_detail"/);
  assert.match(programDetail, /target_program_id:[\s\S]*target_assignment_id:[\s\S]*target_version_id:/);
  assert.doesNotMatch(programDetail, /createProgramDraft|\.from\(/);
  assert.match(
    sqlFunction(migration, "get_program_version_detail"),
    /relationship\.coach_id = current_user_id[\s\S]*relationship\.ended_at is null/,
  );

  assert.match(
    completedDetail,
    /athleteId !== this\.viewerId[\s\S]*"get_authored_coach_session_detail"[\s\S]*target_session_id: sessionId/,
  );
  assert.match(
    completedDetail,
    /\.eq\("athlete_id", this\.viewerId\)[\s\S]*\.eq\("status", "completed"\)/,
  );
  assert.match(completedDetail, /this\.loadOwnSessionNotes\(session\.id\)/);
  assert.doesNotMatch(completedDetail, /athlete_note|\.select\("\*"\)/);
});
