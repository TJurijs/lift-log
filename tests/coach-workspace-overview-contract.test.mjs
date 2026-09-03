import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("../app/LiftLogApp.tsx", import.meta.url);
const domainUrl = new URL("../lib/domain.ts", import.meta.url);
const repositoryUrl = new URL("../lib/repository.ts", import.meta.url);
const stylesUrl = new URL("../app/globals.css", import.meta.url);
const coachWorkspaceUrl = new URL(
  "../app/features/coaching/CoachWorkspace.tsx",
  import.meta.url,
);

test("coach detail combines bounded activity with complete run aggregates", async () => {
  const [domain, repository, coachWorkspace] = await Promise.all([
    readFile(domainUrl, "utf8"),
    readFile(repositoryUrl, "utf8"),
    readFile(coachWorkspaceUrl, "utf8"),
  ]);

  assert.match(
    repository,
    /async loadCoachedAthleteDetail[\s\S]*Promise\.all\(\[[\s\S]*rpc\("get_coach_athlete_detail"[\s\S]*this\.listProgramRuns\(athleteId\)/,
    "the bounded agenda and complete run summaries should load independently in parallel",
  );
  assert.match(
    repository,
    /program_limit: 25[\s\S]*upcoming_limit: 6[\s\S]*completed_limit: 6/,
  );
  assert.match(
    repository,
    /assignedProgramCount:[\s\S]*programRunPage\.items\.length[\s\S]*programRuns: programRunPage\.items[\s\S]*agenda:/,
  );
  assert.match(domain, /export interface AthleteSummary[\s\S]*programRuns\?: ProgramRunSummary\[]/);
  assert.match(coachWorkspace, /function runsForAthlete[\s\S]*athlete\.programRuns\?\.length/);
  assert.match(coachWorkspace, /className="coach-run-card"/);
  assert.match(
    coachWorkspace,
    /program\.completedWorkouts[\s\S]*program\.totalWorkouts[\s\S]*program\.completionPercent/,
    "coach progress must use aggregate run counters rather than the bounded agenda rows",
  );
  assert.doesNotMatch(coachWorkspace, /completedHistory\(athlete\)\.length\s*\/\s*program\.totalWorkouts/);
});

test("coach history opens an exact completed result without requiring an active assignment", async () => {
  const [app, coachWorkspace] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(coachWorkspaceUrl, "utf8"),
  ]);

  assert.match(
    app,
    /function openCoachAgendaEntry[\s\S]*entry\.kind === "completed" && entry\.sessionId[\s\S]*openCalendarResults\([\s\S]*id: entry\.sessionId[\s\S]*programVersionId: entry\.programVersionId[\s\S]*athlete\.id,[\s\S]*"coaching"[\s\S]*return;/,
  );
  assert.match(
    app,
    /entry\.programRunId[\s\S]*athlete\.programRuns\?\.find[\s\S]*openAthleteProgram\([\s\S]*entry\.workoutId,[\s\S]*entry\.programVersionId/,
    "planned run entries must open the immutable revision associated with that run",
  );
  assert.match(coachWorkspace, /onOpenAgendaEntry\?:/);
  assert.match(coachWorkspace, /if \(onOpenAgendaEntry\) onOpenAgendaEntry\(entry\)/);
  assert.doesNotMatch(
    coachWorkspace,
    /disabled=\{!program\}/,
    "ended runs must not make completed history inaccessible",
  );
});

test("athlete planning and history are separate drill-in tabs, not a second calendar", async () => {
  const coachWorkspace = await readFile(coachWorkspaceUrl, "utf8");

  assert.match(coachWorkspace, /value: "plan"[\s\S]*label: "Plan"/);
  assert.match(coachWorkspace, /value: "history"[\s\S]*label: "History"/);
  assert.match(coachWorkspace, /className="coach-run-timeline"/);
  assert.match(coachWorkspace, /className="coach-history-list"/);
  assert.doesNotMatch(
    coachWorkspace,
    /Athlete calendar|Your programs on their agenda|CoachAgendaGroup/,
  );
});

test("coach master and detail screens do not stack on mobile", async () => {
  const [styles, coachWorkspace] = await Promise.all([
    readFile(stylesUrl, "utf8"),
    readFile(coachWorkspaceUrl, "utf8"),
  ]);

  assert.match(coachWorkspace, /className="coach-mobile-back"/);
  assert.match(coachWorkspace, /className="[^"]*coach-athlete-directory[^"]*"/);
  assert.match(coachWorkspace, /className="coach-athlete-detail"/);
  assert.match(
    styles,
    /@media \(max-width: 700px\)[\s\S]*\.coach-athlete-detail\s*\{[^}]*display:\s*none[\s\S]*\.coach-workspace\.mobile-detail-open \.coach-athlete-directory\s*\{[^}]*display:\s*none[\s\S]*\.coach-workspace\.mobile-detail-open \.coach-athlete-detail\s*\{[^}]*display:\s*block/,
  );
});
