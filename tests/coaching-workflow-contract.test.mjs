import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("../app/LiftLogApp.tsx", import.meta.url);
const stylesUrl = new URL("../app/globals.css", import.meta.url);
const primitivesUrl = new URL("../app/ui-primitives.tsx", import.meta.url);
const repositoryUrl = new URL("../lib/repository.ts", import.meta.url);
const coachWorkspaceUrl = new URL(
  "../app/features/coaching/CoachWorkspace.tsx",
  import.meta.url,
);
const wizardUrl = new URL(
  "../app/features/program-runs/ProgramRunWizard.tsx",
  import.meta.url,
);
const runMigrationUrl = new URL(
  "../supabase/migrations/202609020003_program_runs.sql",
  import.meta.url,
);

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);

  assert.notEqual(startIndex, -1, `expected source marker: ${start}`);
  assert.notEqual(endIndex, -1, `expected source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("coach requests are confirmed in-app without invitation links", async () => {
  const [app, coachWorkspace, primitives] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(coachWorkspaceUrl, "utf8"),
    readFile(primitivesUrl, "utf8"),
  ]);
  const inviteModal = sourceBetween(app, "function InviteModal", "function ProgramModal");

  assert.match(inviteModal, /Promise<CoachInviteReceipt>/);
  assert.match(inviteModal, /Request sent to \{receipt\.targetName\}/);
  assert.match(inviteModal, /Coach[\s\S]*workspace/);
  assert.doesNotMatch(
    inviteModal,
    /Invitation link|Copy link|copyText\s*\(|setLink\s*\(/i,
    "new coach requests must not expose or copy invitation URLs",
  );
  assert.match(
    inviteModal,
    /className="button secondary"[\s\S]*disabled=\{sending\}[\s\S]*Back[\s\S]*className="button secondary"[\s\S]*disabled=\{sending\}[\s\S]*Cancel/,
    "invite navigation must remain locked while a lookup or request is in flight",
  );

  assert.match(coachWorkspace, /pendingInvites\.map\(\(invitation\)/);
  assert.match(coachWorkspace, /onRespondInvite\(invitation, "declined"\)/);
  assert.match(coachWorkspace, /onRespondInvite\(invitation, "accepted"\)/);
  assert.match(coachWorkspace, /aria-label=\{refreshing \? "Refreshing athletes" : "Refresh athletes"\}/);
  assert.match(
    app,
    /coachingRequestCount=\{workspace\.pendingCoachInvites\.length\}[\s\S]*coachingRequestCount > 0/,
    "the Coaching navigation badge must count only incoming requests",
  );
  assert.doesNotMatch(
    app,
    /coachingRequestCount=\{[^}]*outgoingCoachInvites/,
    "sent requests must not create navigation badges",
  );
  assert.match(
    primitives,
    /tab\.badge !== undefined && tab\.badge > 0[\s\S]*request-count-badge/,
    "the shared tab primitive must render a pending-request badge",
  );
  assert.match(
    app,
    /await repository\.respondToCoachInvite[\s\S]*setWorkspace[\s\S]*refreshFailed = !\(await refreshCoachWorkspace\(\)\)/,
    "an accepted database mutation must remain successful when the follow-up refresh fails",
  );
});

test("coach-only workspaces stay hidden until relevant coaching data exists", async () => {
  const app = await readFile(appUrl, "utf8");
  const programsHome = sourceBetween(
    app,
    "function ProgramsHome",
    "function CoachProgramEmpty",
  );
  const coachingView = sourceBetween(
    app,
    "function CoachingView",
    "function ExerciseModal",
  );

  assert.match(
    coachingView,
    /const hasAthleteWorkspace\s*=\s*athletes\.length > 0 \|\| pendingInvites\.length > 0/,
  );
  assert.match(coachingView, /hasAthleteWorkspace[\s\S]*"My athletes"/);
  assert.match(coachingView, /<CoachWorkspace/);
  assert.match(
    app,
    /\{ id: "coaching", label: "Coaching", shortLabel: "Coaching", icon: Users \}/,
  );
  assert.match(app, /\{navItems\.map\(\(item\) => \{/);
  assert.match(
    programsHome,
    /\.\.\.\(hasCoach \? \[\{ value: "coach" as const, label: "From coach", icon: Users \}\] : \[\]\)/,
    "the coach-training source must be hidden when there is neither an active coach nor retained coach training",
  );
  assert.doesNotMatch(app, /Open any workout/);
});

test("self and coach entry points use the same program-run wizard", async () => {
  const [app, wizard] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(wizardUrl, "utf8"),
  ]);
  const appShell = sourceBetween(app, "export default function LiftLogApp", "function Sidebar");

  assert.match(appShell, /<ProgramRunWizard/);
  assert.match(appShell, /mode=\{(?:assignment|runWizard)Seed\.mode\}/);
  assert.match(appShell, /repository\.createProgramRuns\(/);
  assert.match(wizard, /mode: "self" \| "coach"/);
  assert.match(
    wizard,
    /visibleAthletes\.map\(\(athlete\)[\s\S]*toggleAthlete\(athlete\.id\)/,
    "program-first coaching must support assigning one run to multiple athletes",
  );
  assert.match(wizard, /Assign and schedule/);
  assert.match(wizard, /Set full schedule later/);
  assert.match(wizard, /dismissible=\{!saving\}/);
  assert.doesNotMatch(
    appShell,
    /<AssignProgramModal\b/,
    "self and coach entry points must not render the legacy assignment flow",
  );
  assert.match(
    appShell,
    /modal === "run-schedule"[\s\S]*scheduleProgramRunWorkouts/,
    "flexible run dates must be schedulable through the run gateway",
  );
  assert.doesNotMatch(wizard, /Scheduling is a separate step\./);
});

test("coach master/detail navigation does not stack on mobile", async () => {
  const [styles, coachWorkspace] = await Promise.all([
    readFile(stylesUrl, "utf8"),
    readFile(coachWorkspaceUrl, "utf8"),
  ]);

  assert.match(coachWorkspace, /className="coach-mobile-back"/);
  assert.match(coachWorkspace, /value: "plan"[\s\S]*label: "Plan"/);
  assert.match(coachWorkspace, /value: "history"[\s\S]*label: "History"/);
  assert.match(
    styles,
    /@media \(max-width: 700px\)[\s\S]*\.coach-athlete-detail\s*\{[^}]*display:\s*none[\s\S]*\.coach-workspace\.mobile-detail-open \.coach-athlete-directory\s*\{[^}]*display:\s*none[\s\S]*\.coach-workspace\.mobile-detail-open \.coach-athlete-detail\s*\{[^}]*display:\s*block/,
  );
});

test("ending a run preserves history and both participant roles can do it", async () => {
  const [app, coachWorkspace, repository, migration] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(coachWorkspaceUrl, "utf8"),
    readFile(repositoryUrl, "utf8"),
    readFile(runMigrationUrl, "utf8"),
  ]);
  const endRun = migration.match(
    /create or replace function public\.end_program_run[\s\S]*?\n\$\$;/i,
  )?.[0] ?? "";

  assert.match(coachWorkspace, /End \{isQuickWorkout \? "workout" : "program"\}/);
  assert.match(coachWorkspace, /if \(onOpenAgendaEntry\) onOpenAgendaEntry\(entry\)/);
  assert.doesNotMatch(coachWorkspace, /disabled=\{!program/);
  assert.match(app, /repository\.endProgramRun\(/);
  assert.match(repository, /async endProgramRun[\s\S]*rpc\("end_program_run"/);
  assert.match(
    endRun,
    /run\.athlete_id = current_user_id[\s\S]*run\.created_by_id = current_user_id/,
  );
  assert.match(endRun, /status in \('unscheduled', 'scheduled'\)/);
  assert.doesNotMatch(endRun, /delete from public\.(workout_sessions|session_item_logs)/);
});
