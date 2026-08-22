import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("../app/LiftLogApp.tsx", import.meta.url);
const stylesUrl = new URL("../app/globals.css", import.meta.url);

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);

  assert.notEqual(startIndex, -1, `expected source marker: ${start}`);
  assert.notEqual(endIndex, -1, `expected source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("coach requests are confirmed in-app without invitation links", async () => {
  const app = await readFile(appUrl, "utf8");
  const inviteModal = sourceBetween(
    app,
    "function InviteModal",
    "function AssignProgramModal",
  );
  const coachingView = sourceBetween(
    app,
    "function CoachingView",
    "function ModalShell",
  );

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

  assert.match(coachingView, /pendingInvites\.map\(\(invitation\)/);
  assert.match(coachingView, /Coaching requests/);
  assert.match(
    coachingView,
    /onClick=\{onRefresh\}[\s\S]*Refresh coaching requests[\s\S]*Refreshing…/,
    "a coach already on the workspace must be able to refresh incoming requests",
  );
  assert.equal(
    coachingView.match(/onClick=\{onInvite\}/g)?.length,
    1,
    "My coaches must expose exactly one invite entry point",
  );
  assert.doesNotMatch(coachingView, /invite-card|In-app request/);
  assert.match(
    coachingView,
    /Pending requests[\s\S]*outgoingInvites\.map\(\(invitation\)[\s\S]*onCancelInvite\(invitation\)[\s\S]*Cancelling…/,
    "outgoing pending requests must be visible and cancellable with progress",
  );
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
    coachingView,
    /"My athletes"[\s\S]*pendingInvites\.length > 0[\s\S]*request-count-badge[\s\S]*pendingInvites\.length/,
    "incoming requests should also badge My athletes",
  );
  assert.match(
    app,
    /await repository\.respondToCoachInvite[\s\S]*setWorkspace[\s\S]*try \{[\s\S]*repository\.loadWorkspace\(\)[\s\S]*catch \{[\s\S]*refreshFailed = true/,
    "an accepted database mutation must remain successful when the follow-up refresh fails",
  );
  assert.match(
    coachingView,
    /respondingInvite\.response === "declined"[\s\S]*Declining…/,
    "declining a request must show action-specific progress",
  );
  assert.match(
    coachingView,
    /respondingInvite\.response === "accepted"[\s\S]*Accepting…/,
    "accepting a request must show action-specific progress",
  );
});

test("coach-only workspace tabs stay hidden until they have relevant coaching data", async () => {
  const app = await readFile(appUrl, "utf8");
  const programsHome = sourceBetween(
    app,
    "function ProgramsHome",
    "function CoachProgramEmpty",
  );
  const coachingView = sourceBetween(app, "function CoachingView", "function ModalShell");

  assert.match(
    coachingView,
    /const hasAthleteWorkspace\s*=\s*athletes\.length > 0 \|\| pendingInvites\.length > 0/,
    "My athletes must require an active athlete or a pending coaching request",
  );
  assert.match(
    coachingView,
    /\{hasAthleteWorkspace && \([\s\S]*"My athletes"/,
    "the My athletes workspace tab must be hidden otherwise",
  );
  assert.match(app, /\{ id: "coaching", label: "Coaching", icon: Users \}/);
  assert.match(
    app,
    /\{navItems\.map\(\(item\) => \{/,
    "the Coaching navigation destination must remain visible to everyone",
  );
  assert.match(
    programsHome,
    /\{hasCoach && \([\s\S]*aria-selected=\{source === "coach"\}/,
    "the Coach program source must be hidden without an active coach",
  );
  assert.match(
    programsHome,
    /\{hasCoach && source === "coach" && \(/,
    "a stale Coach source cannot leave an empty source panel behind",
  );
  assert.doesNotMatch(app, /Open any workout/);
});

test("published Own programs can be assigned from either coaching entry point", async () => {
  const app = await readFile(appUrl, "utf8");
  const appShell = sourceBetween(
    app,
    "export default function LiftLogApp",
    "function Sidebar",
  );
  const assignmentModal = sourceBetween(
    app,
    "function AssignProgramModal",
    "function ProgramModal",
  );

  assert.match(
    appShell,
    /onAssignAthlete=\{\(athlete\) => \{[\s\S]*setAssignmentSeed\(\{ athleteIds: \[athlete\.id\] \}\)[\s\S]*setModal\("assign-program"\)/,
    "the selected athlete must open assignment with that athlete preselected",
  );
  assert.match(
    appShell,
    /program\.athleteId === viewer\.id[\s\S]*program\.createdById === viewer\.id[\s\S]*program\.sourceType === "self"[\s\S]*program\.versionStatus === "published"[\s\S]*setAssignmentSeed\(\{ programId: program\.id \}\)[\s\S]*setModal\("assign-program"\)/,
    "an opened program must expose assignment only for the viewer's published Own program",
  );
  assert.match(
    appShell,
    /<AssignProgramModal[\s\S]*onAssign=\{assignProgramToAthletes\}/,
  );

  assert.match(
    assignmentModal,
    /athletes\.map\(\(athlete\)[\s\S]*type="checkbox"[\s\S]*toggleAthlete\(athlete\.id\)/,
    "program-first assignment must support selecting multiple coached athletes",
  );
  assert.match(assignmentModal, /dismissible=\{!saving\}/);
  assert.match(
    assignmentModal,
    /className="assignment-progress"[\s\S]*Creating independent program/,
  );
  assert.match(
    assignmentModal,
    /LoaderCircle[\s\S]*Assigning…/,
    "the assignment action must visibly show that work is in progress",
  );
});

test("coaching requests and assignment controls collapse for mobile", async () => {
  const styles = await readFile(stylesUrl, "utf8");
  const mobile = sourceBetween(
    styles,
    "@media (max-width: 520px)",
    "@media (prefers-reduced-motion: reduce)",
  );

  assert.match(
    mobile,
    /\.pending-coach-requests article\s*\{[^}]*grid-template-columns:\s*44px minmax\(0, 1fr\)/,
  );
  assert.match(
    mobile,
    /\.outgoing-coach-requests article\s*\{[^}]*grid-template-columns:\s*44px minmax\(0, 1fr\)/,
  );
  assert.match(
    styles,
    /@media \(max-width: 900px\)[\s\S]*\.nav-item em\s*\{[^}]*display:\s*grid/,
    "the coaching request badge must remain visible in mobile navigation",
  );
  assert.match(
    mobile,
    /\.pending-coach-requests strong,[\s\S]*\.assignment-step-heading strong\s*\{[^}]*font-size:\s*13px/,
  );
  assert.match(
    mobile,
    /\.pending-coach-requests small,[\s\S]*\.assignment-step-heading small\s*\{[^}]*font-size:\s*11px/,
  );
  assert.match(
    mobile,
    /\.pending-request-actions\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*1fr 1fr/,
  );
  assert.match(
    mobile,
    /\.athlete-hero-actions\s*\{[^}]*width:\s*100%[^}]*display:\s*grid/,
  );
  assert.match(
    mobile,
    /\.assignment-grid\s*\{[^}]*grid-template-columns:\s*1fr/,
  );
  assert.match(
    mobile,
    /\.assignment-actions \.button\.primary\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/,
  );
});
