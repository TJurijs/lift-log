import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("../app/LiftLogApp.tsx", import.meta.url);
const domainUrl = new URL("../lib/domain.ts", import.meta.url);
const repositoryUrl = new URL("../lib/repository.ts", import.meta.url);
const stylesUrl = new URL("../app/globals.css", import.meta.url);
const programViewUrl = new URL("../app/features/programs/ProgramView.tsx", import.meta.url);

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
    "function ExerciseModal",
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
    /assignedProgram\.completionPercent[\s\S]*assignedProgram\.completedWorkouts[\s\S]*assignedProgram\.nextWorkout[\s\S]*No workout currently scheduled/,
  );
  assert.doesNotMatch(coaching, /assignedProgram\.scheduledPercent/);
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

test("athlete activity lives inside the program drill-in instead of a separate calendar", async () => {
  const [app, programView] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(programViewUrl, "utf8"),
  ]);
  const overview = sourceBetween(
    app,
    "function CoachAthleteOverview",
    "function ExerciseModal",
  );

  assert.doesNotMatch(overview, /Athlete calendar|Your programs on their agenda|CoachAgendaGroup/);
  assert.match(overview, /Schedule workout/);
  assert.match(programView, /workoutActivity\?: CoachAgendaEntry\[\]/);
  assert.match(programView, /Athlete activity/);
  assert.match(programView, /entry\.kind === "completed"/);
  assert.match(programView, /RPE \{entry\.rpe\}/);
  assert.match(programView, /onOpenActivity\?\.\(entry\)/);
});

test("coach rows remain keyboard-visible and stack without mobile overflow", async () => {
  const styles = await readFile(stylesUrl, "utf8");
  const mobile = sourceBetween(
    styles,
    "@media (max-width: 520px)",
    "@media (prefers-reduced-motion: reduce)",
  );

  assert.match(styles, /\.program-catalog-card:hover/);
  assert.match(mobile, /\.coach-assigned-program\s*\{[^}]*min-height:\s*0/);
});
