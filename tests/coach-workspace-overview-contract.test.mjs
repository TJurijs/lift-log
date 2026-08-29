import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("../app/LiftLogApp.tsx", import.meta.url);
const domainUrl = new URL("../lib/domain.ts", import.meta.url);
const repositoryUrl = new URL("../lib/repository.ts", import.meta.url);
const stylesUrl = new URL("../app/globals.css", import.meta.url);

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);

  assert.notEqual(startIndex, -1, "expected source marker: " + start);
  assert.notEqual(endIndex, -1, "expected source marker: " + end);
  return source.slice(startIndex, endIndex);
}

test("coach athlete overview uses bounded aggregate assignment progress", async () => {
  const [app, domain, repository] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(domainUrl, "utf8"),
    readFile(repositoryUrl, "utf8"),
  ]);
  const coaching = sourceBetween(
    app,
    "function CoachAthleteOverview",
    "function CoachAgendaGroup",
  );

  assert.doesNotMatch(
    coaching,
    /athlete\.programTitle|selectedAthlete\.programTitle|Open latest plan|Check in/,
  );
  assert.doesNotMatch(
    coaching,
    /completedThisWeek|plannedThisWeek|lastTrainingLabel|upcomingSessions/,
  );
  assert.match(coaching, /athlete\.assignedPrograms\.map/);
  assert.match(coaching, /coachProgramStatusLabel\(assignedProgram\.status\)/);
  assert.match(
    domain,
    /scheduledWorkouts: number[\s\S]*scheduledPercent: number[\s\S]*completedWorkouts: number[\s\S]*completionPercent: number[\s\S]*nextWorkout\?:/,
  );
  assert.doesNotMatch(domain, /workoutProgress|hiddenWorkoutCount/);
  assert.match(
    repository,
    /rpc\("get_coach_athlete_detail"[\s\S]*program_limit: 25[\s\S]*upcoming_limit: 6[\s\S]*completed_limit: 6/,
  );
  assert.match(
    coaching,
    /assignedProgram\.completionPercent[\s\S]*assignedProgram\.completedWorkouts[\s\S]*assignedProgram\.scheduledPercent[\s\S]*assignedProgram\.nextWorkout/,
  );
  assert.doesNotMatch(coaching, /workoutProgress|hiddenWorkoutCount/);
  assert.match(
    coaching,
    /<SourceTag[\s\S]*presentation=\{presentProvenance\(\{[\s\S]*origin: "coach"[\s\S]*viewerId,[\s\S]*athleteOwnerId: athlete\.id,[\s\S]*athleteOwnerName: athlete\.name,[\s\S]*authorId: viewerId,[\s\S]*\}\)\}[\s\S]*compact/,
    "coach-assigned content must use the viewer-aware provenance projection",
  );
  assert.match(coaching, /coachProgramDisplayStatus\(assignedProgram\.status\)/);
  assert.match(coaching, /onOpenProgram\(assignedProgram\)/);
  assert.match(coaching, /No programs assigned by you/);
  assert.match(coaching, /aria-busy=\{openingProgramId === assignedProgram\.id\}/);
  assert.match(coaching, /LoaderCircle className="button-spinner"/);
});

test("coach agenda opens the exact historical program version", async () => {
  const app = await readFile(appUrl, "utf8");

  assert.match(
    app,
    /programVersionId\s*\?\s*await repository\.loadProgramVersionForAthleteById\([\s\S]*athlete\.id,[\s\S]*assignedProgram\.programId \?\? assignedProgram\.id,[\s\S]*programVersionId,[\s\S]*assignedProgram\.assignmentId/,
  );
  assert.match(
    app,
    /openCoachAgendaEntry[\s\S]*candidate\.assignmentId === entry\.assignmentId[\s\S]*entry\.workoutId,[\s\S]*entry\.programVersionId/,
  );
});

test("coach agenda separates future and completed work with readable RPE states", async () => {
  const [app, styles] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
  ]);
  const overview = sourceBetween(
    app,
    "function CoachAthleteOverview",
    "function ExerciseModal",
  );

  assert.match(overview, /entry\.kind === "upcoming"/);
  assert.match(overview, /entry\.kind === "completed"/);
  assert.match(overview, /title="Scheduled"/);
  assert.match(overview, /title="Recently completed"/);
  assert.match(overview, /Read only/);
  assert.match(overview, /entry\.workoutTitle/);
  assert.match(overview, /entry\.programTitle/);
  assert.match(overview, /"RPE " \+ entry\.rpe/);
  assert.match(overview, /"Completed · RPE —"/);
  assert.match(overview, /coachAgendaStatusLabel\(entry\.status\)/);
  assert.match(overview, /\.slice\(0, 6\)/);
  assert.match(overview, /RPE 1–4 · low/);
  assert.match(overview, /RPE 5–8 · usual range/);
  assert.match(overview, /RPE 9–10 · high/);
  assert.match(styles, /\.coach-rpe\.low[\s\S]*var\(--blue\)/);
  assert.match(styles, /\.coach-rpe\.balanced[\s\S]*var\(--accent\)/);
  assert.match(styles, /\.coach-rpe\.high[\s\S]*var\(--orange\)/);
  assert.match(
    styles,
    /\.coach-agenda-state\.overdue[\s\S]*var\(--orange\)/,
  );
});

test("coach rows remain keyboard-visible and stack without mobile overflow", async () => {
  const styles = await readFile(stylesUrl, "utf8");
  const mobile = sourceBetween(
    styles,
    "@media (max-width: 520px)",
    "@media (prefers-reduced-motion: reduce)",
  );

  assert.match(styles, /\.program-catalog-card:hover/);
  assert.match(
    styles,
    /\.coach-agenda-list > button:hover,\s*\.coach-agenda-list > button:focus-visible/,
  );
  assert.match(mobile, /\.coach-assigned-program\s*\{[^}]*min-height:\s*0/);
  assert.match(
    mobile,
    /\.coach-agenda-list > button\s*\{[^}]*min-height:\s*68px[^}]*grid-template-columns:\s*38px minmax\(0, 1fr\) 15px/,
  );
});
