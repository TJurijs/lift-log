import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const migrationsUrl = new URL("../supabase/migrations/", import.meta.url);
const appUrl = new URL("../app/LiftLogApp.tsx", import.meta.url);
const stylesUrl = new URL("../app/globals.css", import.meta.url);
const domainUrl = new URL("../lib/domain.ts", import.meta.url);
const repositoryUrl = new URL("../lib/repository.ts", import.meta.url);
const coachWorkspaceUrl = new URL(
  "../app/features/coaching/CoachWorkspace.tsx",
  import.meta.url,
);
const programViewUrl = new URL(
  "../app/features/programs/ProgramView.tsx",
  import.meta.url,
);
const runWizardUrl = new URL(
  "../app/features/program-runs/ProgramRunWizard.tsx",
  import.meta.url,
);
const runWizardStylesUrl = new URL(
  "../app/features/program-runs/program-run-wizard.css",
  import.meta.url,
);
const runScheduleStylesUrl = new URL(
  "../app/features/program-runs/program-run-schedule-wizard.css",
  import.meta.url,
);

async function readMigrationHistory() {
  const names = (await readdir(migrationsUrl))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const migrations = await Promise.all(
    names.map(async (name) =>
      `\n-- migration: ${name}\n${await readFile(new URL(name, migrationsUrl), "utf8")}`,
    ),
  );
  return migrations.join("\n");
}

function sqlFunction(source, name, schema = "public") {
  const matches = [
    ...source.matchAll(
      new RegExp(
        `create(?: or replace)? function ${schema}\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
        "gi",
      ),
    ),
  ];
  assert.ok(matches.length, `expected SQL function: ${schema}.${name}`);
  return matches.at(-1)[0];
}

function sqlTable(source, name) {
  const match = source.match(
    new RegExp(`create table public\\.${name} \\([\\s\\S]*?\\n\\);`, "i"),
  );
  assert.ok(match, `expected SQL table: ${name}`);
  return match[0];
}

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `expected source marker: ${start}`);
  assert.notEqual(endIndex, -1, `expected source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("self-use and coach assignment share one immutable program-run model", async () => {
  const [sql, domain] = await Promise.all([
    readMigrationHistory(),
    readFile(domainUrl, "utf8"),
  ]);
  const runs = sqlTable(sql, "program_runs");
  const slots = sqlTable(sql, "program_run_workouts");

  assert.match(runs, /athlete_id uuid not null references public\.profiles\(id\)/i);
  assert.match(runs, /created_by_id uuid not null references public\.profiles\(id\)/i);
  assert.match(runs, /source_program_id uuid not null references public\.programs\(id\)/i);
  assert.match(
    runs,
    /program_version_id uuid not null references public\.program_versions\(id\)/i,
    "a run must retain the exact immutable revision that was assigned",
  );
  assert.match(runs, /repeated_from_run_id uuid references public\.program_runs\(id\)/i);
  assert.match(runs, /status text not null[^,]*'not_started'/i);
  assert.match(runs, /ended_at timestamptz/i);
  assert.doesNotMatch(
    runs,
    /athlete_id\s*<>\s*created_by_id/i,
    "self-started and coach-assigned plans must use the same table",
  );

  assert.match(
    slots,
    /program_run_id uuid not null references public\.program_runs\(id\)/i,
  );
  assert.match(slots, /workout_id uuid not null references public\.workouts\(id\)/i);
  assert.match(slots, /position integer not null/i);
  assert.match(
    slots,
    /planned_date date(?!\s+not null)/i,
    "every workout exists in a run even when it has no date",
  );
  assert.match(slots, /unique\s*\(program_run_id,\s*position\)/i);

  assert.match(
    domain,
    /export type ProgramRunStatus\s*=\s*[\s\S]*"not_started"[\s\S]*"in_progress"[\s\S]*"completed"[\s\S]*"ended"/,
  );
  assert.match(
    domain,
    /export interface ProgramRunWorkout[\s\S]*runId: string;[\s\S]*workoutId: string;[\s\S]*position: number;[\s\S]*plannedDate\?: string;/,
  );
  assert.match(
    domain,
    /export interface ProgramRunSummary[\s\S]*id: string;[\s\S]*athleteId: string;[\s\S]*programVersionId: string;[\s\S]*status: ProgramRunStatus;/,
  );
});

test("creating a run atomically materializes every workout and optionally schedules any subset", async () => {
  const [sql, repository] = await Promise.all([
    readMigrationHistory(),
    readFile(repositoryUrl, "utf8"),
  ]);
  const create = sqlFunction(sql, "create_program_runs");
  const materialize = sqlFunction(sql, "materialize_program_run", "private");
  const normalizeDates = sqlFunction(
    sql,
    "canonical_program_run_dates",
    "private",
  );

  assert.match(create, /target_program_id uuid/i);
  assert.match(create, /target_athlete_ids uuid\[\]/i);
  assert.match(create, /target_workout_dates jsonb/i);
  assert.match(create, /target_idempotency_key uuid/i);
  assert.match(create, /target_repeated_from_run_id uuid default null/i);
  assert.match(create, /cardinality\(target_athlete_ids\) > 50/i);
  assert.match(
    create,
    /athlete\s*<>\s*current_user_id[\s\S]*coach_relationships/i,
    "one RPC must authorize both starting for yourself and assigning as a coach",
  );
  assert.match(create, /private\.materialize_program_run/i);
  assert.match(materialize, /insert into public\.program_runs/i);
  assert.match(
    materialize,
    /insert into public\.program_run_workouts[\s\S]*select[\s\S]*(?:from|join) public\.workouts/i,
    "all workouts must become durable run slots in one transaction",
  );
  assert.match(
    normalizeDates,
    /target_workout_dates[\s\S]*(workoutId|workout_id)[\s\S]*(plannedDate|planned_date)/i,
    "the optional schedule maps workout identities to dates instead of relying on array order",
  );
  assert.match(
    materialize,
    /request_key[\s\S]*target_idempotency_key/i,
    "retrying a slow assignment must return the same run rather than duplicate it",
  );

  assert.match(
    repository,
    /async createProgramRuns\([\s\S]*programId: string,[\s\S]*athleteIds: string\[][\s\S]*workoutDates: ProgramRunWorkoutDate\[][\s\S]*idempotencyKey(?:: string)? = crypto\.randomUUID\(\)/,
  );
  assert.match(
    repository,
    /rpc\("create_program_runs"[\s\S]*target_program_id: programId,[\s\S]*target_athlete_ids: uniqueAthleteIds,[\s\S]*target_workout_dates:[\s\S]*target_idempotency_key: idempotencyKey/,
  );
});

test("first use snapshots a revision without permanently locking the reusable program", async () => {
  const [sql, app] = await Promise.all([
    readMigrationHistory(),
    readFile(appUrl, "utf8"),
  ]);
  const snapshot = sqlFunction(sql, "snapshot_program_for_run", "private");
  const canEdit = sqlFunction(sql, "can_edit_program");
  const summaries = sqlFunction(sql, "list_program_summaries");

  assert.match(snapshot, /publish_program_version\(draft_version_id/);
  assert.doesNotMatch(
    snapshot,
    /program_version_semantic_payload/,
    "a run must freeze the working revision whose workout IDs were submitted",
  );
  assert.match(
    snapshot,
    /insert into public\.program_versions[\s\S]*based_on_version_id[\s\S]*'draft'/,
    "after freezing the assigned revision, a working revision must remain available",
  );
  assert.match(snapshot, /private\.clone_program_version_tree\(snapshot_version_id, next_version_id\)/);
  assert.doesNotMatch(
    canEdit,
    /locked_at/,
    "first-use telemetry must not determine whether the owner's working revision is editable",
  );
  assert.match(
    summaries,
    /case[\s\S]*when candidate\.status = 'draft' then 0[\s\S]*end/,
    "the Programs library must continue to open the owner's working revision",
  );
  assert.match(app, /saved for future (?:runs|uses)/i);
});

test("repeating creates an isolated run while ending retains completed results", async () => {
  const [sql, repository] = await Promise.all([
    readMigrationHistory(),
    readFile(repositoryUrl, "utf8"),
  ]);
  const repeat = sqlFunction(sql, "repeat_program_run");
  const end = sqlFunction(sql, "end_program_run");

  assert.match(repeat, /target_run_id uuid/i);
  assert.match(repeat, /target_workout_dates jsonb/i);
  assert.match(repeat, /target_idempotency_key uuid/i);
  assert.match(repeat, /program_version_id/i);
  assert.match(repeat, /private\.materialize_program_run[\s\S]*previous\.id/i);
  assert.doesNotMatch(repeat, /insert into public\.(workout_sessions|session_item_logs)/i);
  assert.doesNotMatch(
    repeat,
    /update public\.program_runs[\s\S]*where id = target_run_id/i,
    "repeating must never reset or mutate the source run",
  );

  assert.match(end, /target_run_id uuid/i);
  assert.match(end, /update public\.program_runs[\s\S]*status\s*=\s*'ended'/i);
  assert.match(
    end,
    /update public\.program_run_workouts[\s\S]*status\s*=\s*'cancelled'/i,
    "ending a run cancels unfinished future slots",
  );
  assert.match(
    end,
    /status in \('unscheduled', 'scheduled'\)/i,
    "ending cancels future slots while retaining completed and skipped history",
  );
  assert.doesNotMatch(end, /delete from public\.(workout_sessions|session_item_logs)/i);
  assert.doesNotMatch(end, /delete from public\.program_run_workouts/i);

  assert.match(repository, /async repeatProgramRun\([\s\S]*rpc\("repeat_program_run"/);
  assert.match(repository, /async endProgramRun\([\s\S]*rpc\("end_program_run"/);
});

test("run progress comes from the complete materialized run, never the bounded Next list", async () => {
  const [sql, domain, repository, app] = await Promise.all([
    readMigrationHistory(),
    readFile(domainUrl, "utf8"),
    readFile(repositoryUrl, "utf8"),
    readFile(appUrl, "utf8"),
  ]);
  const summaries = sqlFunction(sql, "list_program_run_summaries");
  const programRow = sourceBetween(app, "function ProgramRow", "function ProgramsHome");

  assert.match(summaries, /from public\.program_run_workouts/i);
  assert.match(summaries, /total_workouts bigint[\s\S]*count\(slot\.id\)/i);
  assert.match(summaries, /completed_workouts bigint/i);
  assert.match(
    summaries,
    /count\(slot\.id\) filter\s*\(where slot\.status\s*=\s*'completed'\)/i,
  );
  assert.doesNotMatch(
    summaries,
    /limit\s+6[\s\S]*count\(/i,
    "bounded upcoming rows must not be counted as if they were the entire run",
  );
  assert.match(
    domain,
    /ProgramRunSummary[\s\S]*totalWorkouts: number;[\s\S]*completedWorkouts: number;[\s\S]*completionPercent: number;/,
  );
  assert.match(repository, /async listProgramRuns\([\s\S]*rpc\("list_program_run_summaries"/);
  assert.doesNotMatch(programRow, /deriveProgramRunStatus|program-card-workout-progress/);
});

test("self run progress is attached to its template while Next stays schedule-focused", async () => {
  const app = await readFile(appUrl, "utf8");
  const nextWorkouts = sourceBetween(app, "function NextWorkoutsView", "function TodayView");
  const programRow = sourceBetween(app, "function ProgramRow", "function ProgramsHome");

  assert.doesNotMatch(nextWorkouts, /SelfProgramRuns|Active training|Your training plans/);
  assert.match(programRow, /isQuickWorkout[\s\S]*\? "In use"[\s\S]*In use · \$\{activeRun\.completedWorkouts\}\/\$\{activeRun\.totalWorkouts\} completed/);
  assert.match(programRow, /onOpenActiveRun/);
  assert.match(app, /function openOwnProgramRun[\s\S]*repository\.loadProgramForRun\(run\.id\)/);
  assert.match(
    app,
    /onEndRun=\{\(run\)[\s\S]*kind: "program-run"[\s\S]*id: run\.id[\s\S]*setModal\("delete-content"\)/,
  );
  assert.match(
    app,
    /onRepeatRun=\{\(run\)[\s\S]*openProgramRunWizard\([\s\S]*mode: "self"[\s\S]*repeatRun: run/,
  );
  assert.doesNotMatch(programRow, /completionPercent|nextWorkout/);
});

test("coach-assigned history pages independently from self-created runs", async () => {
  const [domain, repository, app] = await Promise.all([
    readFile(domainUrl, "utf8"),
    readFile(repositoryUrl, "utf8"),
    readFile(appUrl, "utf8"),
  ]);

  assert.match(domain, /coachProgramRunCursor\?: ProgramRunCursor/);
  assert.match(
    repository,
    /creatorScope\?: "all" \| "self" \| "coach"[\s\S]*creator_scope: creatorScope/,
  );
  assert.match(
    app,
    /listProgramRuns\(undefined, \{ creatorScope: "coach" \}\)[\s\S]*coachProgramRunCursor/,
  );
  assert.match(app, /Search older training/);
});

test("opening either self or coach run targets the next incomplete run workout", async () => {
  const app = await readFile(appUrl, "utf8");
  const selfOpen = sourceBetween(
    app,
    "async function openOwnProgramRun",
    "function openCoachAgendaEntry",
  );
  const coachOpen = sourceBetween(
    app,
    "async function openAthleteProgram",
    "async function openOwnProgramRun",
  );

  assert.match(selfOpen, /loadProgramRunDetail\(run\.id\)/);
  assert.match(selfOpen, /nextIncompleteRunWorkoutId\(runDetail\.workouts\)/);
  assert.match(
    selfOpen,
    /selectProgram\(nextProgram, \{[\s\S]*programRunId: run\.id,[\s\S]*programRunDetail: runDetail,[\s\S]*workoutId,[\s\S]*\}\)/,
  );
  assert.match(coachOpen, /repository\.loadProgramRunDetail\(programRunId\)/);
  assert.match(coachOpen, /nextIncompleteRunWorkoutId\(runDetail\.workouts\)/);
  assert.match(coachOpen, /workoutId: targetWorkoutId/);
});

test("run detail keeps its launch surface and opens completed results", async () => {
  const [app, programView] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(programViewUrl, "utf8"),
  ]);

  assert.match(app, /openOwnProgramRun\(run, "program"\)/);
  assert.match(app, /const returnView = programReturnView/);
  assert.match(app, /backLabel=\{[\s\S]*programReturnView === "coaching"[\s\S]*programReturnView === "today"/);
  assert.match(
    app,
    /function openProgramRunActivity[\s\S]*entry\.kind !== "completed"[\s\S]*openCalendarResults\([\s\S]*"program"/,
  );
  assert.match(
    programView,
    /selectedRunActivity\.kind === "completed"[\s\S]*selectedRunActivity\.sessionId/,
  );
});

test("athletes and assigning coaches can copy an exact superseded run revision", async () => {
  const app = await readFile(appUrl, "utf8");

  assert.match(
    app,
    /function capabilitiesForViewedProgram[\s\S]*canCopyExactRun[\s\S]*viewingProgramRun\.athleteId === viewer\.id[\s\S]*viewingProgramRun\.createdById === viewer\.id[\s\S]*copyToOwn: true/,
  );
  assert.match(
    app,
    /sourceRunId[\s\S]*capabilitiesForViewedProgram\(targetProgram\)[\s\S]*copyProgramRunToOwn\(sourceRunId\)/,
  );
});

test("run progress is invalidated and refreshed after every occurrence transition", async () => {
  const [app, repository] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(repositoryUrl, "utf8"),
  ]);

  assert.match(
    repository,
    /private invalidateProgramRunProgress[\s\S]*invalidate\("program-runs:"\)[\s\S]*invalidateCalendarMutation/,
  );
  for (const method of [
    "scheduleWorkout",
    "setScheduledWorkoutStatus",
    "startOrResumeSession",
    "completeSession",
  ]) {
    const start = repository.indexOf(`async ${method}`);
    assert.notEqual(start, -1, `expected repository method ${method}`);
    const body = repository.slice(start, repository.indexOf("\n  async ", start + 8));
    assert.match(body, /invalidateProgramRunProgress\(\)/, `${method} must invalidate run progress`);
  }
  assert.match(app, /const refreshProgramRunSummaries = useCallback/);
  assert.match(app, /startWorkout[\s\S]*refreshProgramRunSummaries\(\)/);
  assert.match(app, /finishWorkout[\s\S]*refreshProgramRunSummaries\(\)/);
  assert.match(app, /setScheduledWorkoutStatus[\s\S]*refreshProgramRunSummaries\(\)/);
});

test("self and coach entry points use one assignment-and-scheduling flow", async () => {
  const [app, wizard] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(runWizardUrl, "utf8"),
  ]);

  assert.match(wizard, /mode: "self" \| "coach"/);
  assert.match(wizard, /mode === "self"\s*\? \[viewerId\]/);
  assert.match(wizard, /Assign and schedule/);
  assert.match(wizard, /Set full schedule later/);
  assert.match(wizard, /`Start a \$\{selectedObjectLabel\}`/);
  assert.match(wizard, /Training days/);
  assert.match(wizard, /step === "review"/);
  assert.match(
    wizard,
    /Choose training[\s\S]*program or a standalone workout/,
    "programs and standalone workouts must enter the same workflow",
  );
  assert.match(app, /<ProgramRunWizard/);
  assert.match(app, /repository\.createProgramRuns\(/);
  assert.doesNotMatch(wizard, /Scheduling is a separate step\./);
  const appShell = sourceBetween(
    app,
    "export default function LiftLogApp",
    "function Sidebar",
  );
  assert.doesNotMatch(
    appShell,
    /<AssignProgramModal\b/,
    "self and coach actions must not render a separate legacy assignment flow",
  );
  assert.match(
    appShell,
    /modal === "run-schedule"[\s\S]*repository\.scheduleProgramRunWorkouts\(/,
    "an existing run's flexible dates must use the run scheduling command",
  );
  assert.doesNotMatch(
    appShell,
    /repository\.assignQuickWorkoutToAthletes\(/,
    "legacy compatibility may remain in the repository, but the UI must use the universal run command",
  );
});

test("mobile coaching drills into one athlete and uses full-screen run workflows", async () => {
  const [app, coachWorkspace, styles, wizardStyles, scheduleStyles] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(coachWorkspaceUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
    readFile(runWizardStylesUrl, "utf8"),
    readFile(runScheduleStylesUrl, "utf8"),
  ]);

  assert.match(
    coachWorkspace,
    /className="coach-mobile-back"[\s\S]*aria-label="Back to athletes"/,
    "the selected athlete must be a navigable detail screen, not a second stacked panel",
  );
  assert.match(coachWorkspace, /value: "plan"[\s\S]*label: "Plan"/);
  assert.match(coachWorkspace, /value: "history"[\s\S]*label: "History"/);
  assert.match(coachWorkspace, /onOpenAgendaEntry\?:[\s\S]*CoachAgendaEntry/);
  assert.match(
    coachWorkspace,
    /if \(onOpenAgendaEntry\) onOpenAgendaEntry\(entry\)/,
    "completed results must remain directly openable after their program run is ended",
  );
  assert.doesNotMatch(
    coachWorkspace,
    /disabled=\{!program/,
    "history access must not depend on a currently active assignment",
  );
  assert.match(
    coachWorkspace,
    /className=\{`coach-workspace\$\{mobileAthlete(?:Id)?[^}]*mobile-detail-open[^}]*\}`\}/,
  );
  assert.match(coachWorkspace, /className="[^"]*coach-athlete-directory[^"]*"/);
  assert.match(coachWorkspace, /className="coach-athlete-detail"/);
  assert.match(app, /<CoachWorkspace/);
  assert.match(app, /<ProgramRunWizard/);
  assert.match(
    wizardStyles,
    /@media \(max-width: 700px\)[\s\S]*\.modal-backdrop:has\(\.program-run-wizard\)[\s\S]*place-items:\s*stretch[\s\S]*\.program-run-wizard[\s\S]*height:\s*100dvh[\s\S]*max-height:\s*none/,
    "the multi-step workflow must use the mobile viewport rather than a scrolling nested modal",
  );
  assert.match(
    styles,
    /@media \(max-width: 700px\)[\s\S]*\.coach-workspace\.mobile-detail-open[\s\S]*\.coach-athlete-directory[\s\S]*display:\s*none/,
  );
  assert.match(
    styles,
    /@media \(max-width: 700px\)[\s\S]*\.coach-athlete-detail\s*\{[^}]*display:\s*none[\s\S]*\.coach-workspace\.mobile-detail-open \.coach-athlete-detail\s*\{[^}]*display:\s*block/,
  );
  assert.match(
    wizardStyles,
    /@media \(max-width: 700px\)[\s\S]*\.program-run-wizard-actions[\s\S]*position:\s*sticky[\s\S]*bottom:/,
    "the primary action must remain reachable above the mobile safe area",
  );
  assert.match(
    scheduleStyles,
    /@media \(max-width: 700px\)[\s\S]*\.modal-backdrop:has\(\.program-run-schedule-wizard\)[\s\S]*place-items:\s*stretch[\s\S]*\.program-run-schedule-wizard[\s\S]*height:\s*100dvh[\s\S]*max-height:\s*none/,
    "bulk rescheduling must also use the full mobile viewport",
  );
  assert.match(
    scheduleStyles,
    /@media \(max-width: 700px\)[\s\S]*\.program-run-schedule-actions[\s\S]*position:\s*sticky[\s\S]*bottom:/,
  );
});
