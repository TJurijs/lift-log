import { readAppSource as readAuthoringSource } from "./helpers/app-source.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const stylesUrl = new URL("../app/globals.css", import.meta.url);
const primitivesUrl = new URL("../app/ui-primitives.tsx", import.meta.url);
const repositoryUrl = new URL("../lib/repository.ts", import.meta.url);
const coachWorkspaceUrl = new URL(
  "../app/features/coaching/CoachWorkspace.tsx",
  import.meta.url,
);
const compactRunCardUrl = new URL(
  "../app/features/program-runs/ProgramRunCompactCard.tsx",
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
    readAuthoringSource(),
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

test("coach master/detail navigation does not stack on mobile", async () => {
  const [styles, coachWorkspace] = await Promise.all([
    readFile(stylesUrl, "utf8"),
    readFile(coachWorkspaceUrl, "utf8"),
  ]);

  assert.match(coachWorkspace, /<DetailNavigation[\s\S]*className="coach-athlete-navigation"[\s\S]*backLabel="My athletes"/);
  assert.match(coachWorkspace, /value: "plan"[\s\S]*label: "Training"/);
  assert.match(coachWorkspace, /value: "history"[\s\S]*label: "History"/);
  assert.match(
    styles,
    /@media \(max-width: 700px\)[\s\S]*\.coach-athlete-detail(?:\s*,[^{}]*)?\s*\{[^}]*display:\s*none/,
  );
  assert.match(styles, /@media \(max-width: 700px\)[\s\S]*\.coach-workspace\.mobile-detail-open \.coach-athlete-directory\s*\{[^}]*display:\s*none/);
  assert.match(styles, /@media \(max-width: 700px\)[\s\S]*\.coach-workspace\.mobile-detail-open \.coach-athlete-detail\s*\{[^}]*display:\s*block/);
});

test("ending a run preserves history and both participant roles can do it", async () => {
  const [app, coachWorkspace, compactRunCard, repository, migration] = await Promise.all([
    readAuthoringSource(),
    readFile(coachWorkspaceUrl, "utf8"),
    readFile(compactRunCardUrl, "utf8"),
    readFile(repositoryUrl, "utf8"),
    readFile(runMigrationUrl, "utf8"),
  ]);
  const endRun = migration.match(
    /create or replace function public\.end_program_run[\s\S]*?\n\$\$;/i,
  )?.[0] ?? "";

  assert.match(coachWorkspace, /ProgramRunCompactCard/);
  assert.match(compactRunCard, /actionUi\.end, label: `End \$\{objectLabel\.toLowerCase\(\)\}`/);
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
