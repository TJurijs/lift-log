import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const domainUrl = new URL("../lib/domain.ts", import.meta.url);
const repositoryUrl = new URL("../lib/repository.ts", import.meta.url);

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
  assert.match(athleteSummary, /agenda: CoachAgendaEntry\[\]/);
  assert.doesNotMatch(
    athleteSummary,
    /programTitle|completedThisWeek|plannedThisWeek|latestRpe|lastTrainingLabel|trend|upcomingSessions/,
  );
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
    /\.from\("programs"\)[\s\S]*\.in\("athlete_id", athleteIds\)[\s\S]*\.eq\("created_by_id", this\.viewerId\)[\s\S]*\.eq\("source_type", "coach"\)[\s\S]*\.eq\("is_current", true\)[\s\S]*\.is\("archived_at", null\)/,
  );
  assert.match(
    loader,
    /const programIds = programs\.map[\s\S]*\.from\("program_versions"\)[\s\S]*\.in\("program_id", programIds\)/,
  );
  assert.match(
    loader,
    /const versionIds = versions\.map[\s\S]*\.from\("scheduled_workouts"\)[\s\S]*\.in\("athlete_id", athleteIds\)[\s\S]*\.in\("program_version_id", versionIds\)/,
  );
  assert.match(
    loader,
    /\.from\("workout_sessions"\)[\s\S]*\.in\("athlete_id", athleteIds\)[\s\S]*\.in\("program_version_id", versionIds\)[\s\S]*\.eq\("status", "completed"\)/,
  );
  assert.doesNotMatch(
    loader,
    /programs\.find\([\s\S]*program\.athlete_id === relationship\.athlete_id[\s\S]*\)\?\.title/,
    "the old fallback to another coach's or the athlete's own program must stay removed",
  );
});

test("program progress uses the latest sequence cycle and agenda entries retain navigation ids", async () => {
  const repository = await readFile(repositoryUrl, "utf8");
  const loader = sourceBetween(
    repository,
    "private async loadCoachedAthletes",
    "private async loadPendingCoachInvites",
  );

  assert.match(
    loader,
    /Math\.floor\(\(maximumSequence - 1\) \/ totalWorkouts\) \*\s*totalWorkouts/,
  );
  assert.match(
    loader,
    /completedWorkouts = cycle\.filter[\s\S]*schedule\.status === "completed"/,
  );
  assert.match(
    loader,
    /allTerminal =[\s\S]*cycle\.length >= totalWorkouts[\s\S]*"completed"[\s\S]*"skipped"/,
  );
  assert.match(
    loader,
    /hasScheduledDate[\s\S]*"completed"[\s\S]*"in_progress"[\s\S]*"scheduled"[\s\S]*"awaiting_schedule"/,
  );
  assert.match(
    loader,
    /Math\.min\(\s*100,[\s\S]*completedWorkouts \/ totalWorkouts/,
    "legacy or repeated occurrences must never report more than 100 percent",
  );
  assert.match(loader, /kind: "upcoming"[\s\S]*scheduleId: schedule\.id/);
  assert.match(
    loader,
    /schedule\.status === "in_progress"[\s\S]*"overdue"[\s\S]*"planned"/,
  );
  assert.match(
    loader,
    /kind: "completed"[\s\S]*rpe: numberValue\(session\.session_rpe\)[\s\S]*sessionId: session\.id/,
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
    /athleteId: string = this\.viewerId[\s\S]*\.eq\("athlete_id", athleteId\)/,
  );
  assert.match(detailLoader, /\.eq\("status", "completed"\)/);
});
