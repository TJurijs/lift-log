import {
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Dumbbell,
  History,
  LoaderCircle,
  RefreshCw,
  Search,
  UserRound,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  AthleteSummary,
  CoachAgendaEntry,
  CoachAssignedProgramSummary,
  PendingCoachInvite,
  ProgramRunStatus,
  ProgramRunSummary,
} from "../../../lib/domain";
import { formatDateOnly } from "../../../lib/date-only";
import {
  appDetailDataFromHistory,
  appDetailFromHistory,
  leaveAppDetailHistory,
  pushAppDetailHistory,
} from "../../../lib/app-route";
import {
  InlineError,
  PersonAvatar,
  SegmentedTabs,
} from "../../ui-primitives";
import { ProgramRunCompactCard } from "../program-runs/ProgramRunCompactCard";

export type CoachAthleteWorkspaceTab = "plan" | "history";

export type CoachWorkspaceRun = ProgramRunSummary & {
  assignmentId?: string;
  legacy?: boolean;
};
export type CoachWorkspaceProgram =
  | CoachWorkspaceRun
  | CoachAssignedProgramSummary;

export interface CoachWorkspaceProps {
  athletes: AthleteSummary[];
  pendingInvites: PendingCoachInvite[];
  selectedAthlete: AthleteSummary | null;
  loadingAthleteId: string | null;
  loadingHistoryAthleteId?: string | null;
  loadingProgramRunsAthleteId?: string | null;
  openingProgramId: string | null;
  refreshing: boolean;
  hasMoreAthletes: boolean;
  loadingMoreAthletes: boolean;
  athletesLoadError: string;
  respondingInvite: {
    id: string;
    response: "accepted" | "declined";
  } | null;
  onRefresh: () => void;
  onRespondInvite: (
    invitation: PendingCoachInvite,
    response: "accepted" | "declined",
  ) => void;
  onSelectAthlete: (athlete: AthleteSummary) => void;
  onLoadMoreAthletes: () => void;
  onLoadMoreHistory?: (athlete: AthleteSummary) => void;
  onLoadMoreProgramRuns?: (athlete: AthleteSummary) => void;
  onOpenAssignedProgram: (
    athlete: AthleteSummary,
    program: CoachWorkspaceProgram,
    workoutId?: string,
  ) => void;
  onOpenAgendaEntry?: (
    athlete: AthleteSummary,
    entry: CoachAgendaEntry,
  ) => void;
  onAssignAthlete: (athlete: AthleteSummary) => void;
  onScheduleAthlete: (
    athlete: AthleteSummary,
    program?: CoachWorkspaceProgram,
  ) => void;
  onUnassignAthlete: (
    athlete: AthleteSummary,
    program: CoachWorkspaceProgram,
  ) => void;
  onRepeatAthlete?: (
    athlete: AthleteSummary,
    program: CoachWorkspaceProgram,
  ) => void;
}

type ProgramStatusPresentation = {
  badge: "planned" | "in_progress" | "completed";
};

const programStatusPresentation: Record<
  ProgramRunStatus,
  ProgramStatusPresentation
> = {
  not_started: { badge: "planned" },
  in_progress: { badge: "in_progress" },
  completed: { badge: "completed" },
  ended: { badge: "planned" },
};

function normalizeLegacyRun(
  athlete: AthleteSummary,
  program: CoachAssignedProgramSummary,
): CoachWorkspaceRun {
  return {
    id: program.id,
    athleteId: athlete.id,
    createdById: "legacy",
    programId: program.programId,
    programVersionId: program.versionId,
    title: program.title,
    status:
      program.status === "completed"
        ? "completed"
        : program.status === "in_progress"
          ? "in_progress"
          : "not_started",
    totalWorkouts: program.totalWorkouts,
    scheduledWorkouts: program.scheduledWorkouts,
    completedWorkouts: program.completedWorkouts,
    completionPercent: program.completionPercent,
    nextWorkout: program.nextWorkout
      ? {
          id: program.nextWorkout.id,
          title: program.nextWorkout.title,
          plannedDate: program.nextWorkout.date,
          status: "scheduled",
        }
      : undefined,
    createdAt: program.assignedAt,
    assignmentId: program.assignmentId,
    legacy: true,
  };
}

function runsForAthlete(athlete: AthleteSummary) {
  if (athlete.programRuns?.length) return athlete.programRuns as CoachWorkspaceRun[];
  return athlete.assignedPrograms.map((program) =>
    normalizeLegacyRun(athlete, program),
  );
}

function dateLabel(value: string, includeYear = false) {
  const options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    ...(includeYear ? { year: "numeric" } : {}),
  };
  if (!value.includes("T")) {
    try { return formatDateOnly(value, options, "en-GB"); }
    catch { return value; }
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-GB", options);
}

function agendaForProgram(
  athlete: AthleteSummary,
  value: CoachWorkspaceProgram,
) {
  const program =
    "programVersionId" in value ? value : normalizeLegacyRun(athlete, value);
  return athlete.agenda.filter((entry) => {
    if (entry.programRunId || !program.legacy) {
      return entry.programRunId === program.id;
    }
    if (program.assignmentId && entry.assignmentId) {
      return entry.assignmentId === program.assignmentId;
    }
    return (
      entry.programId === program.programId &&
      entry.programVersionId === program.programVersionId
    );
  });
}

function completedHistory(athlete: AthleteSummary) {
  return athlete.agenda
    .filter((entry) => entry.kind === "completed")
    .sort((first, second) => second.date.localeCompare(first.date));
}

export function CoachWorkspace({
  athletes,
  pendingInvites,
  selectedAthlete,
  loadingAthleteId,
  loadingHistoryAthleteId,
  loadingProgramRunsAthleteId,
  openingProgramId,
  refreshing,
  hasMoreAthletes,
  loadingMoreAthletes,
  athletesLoadError,
  respondingInvite,
  onRefresh,
  onRespondInvite,
  onSelectAthlete,
  onLoadMoreAthletes,
  onLoadMoreHistory,
  onLoadMoreProgramRuns,
  onOpenAssignedProgram,
  onOpenAgendaEntry,
  onAssignAthlete,
  onScheduleAthlete,
  onUnassignAthlete,
  onRepeatAthlete,
}: CoachWorkspaceProps) {
  const [mobileAthleteId, setMobileAthleteId] = useState<string | null>(null);
  const [athleteTab, setAthleteTab] =
    useState<CoachAthleteWorkspaceTab>("plan");

  const mobileAthlete =
    athletes.find((athlete) => athlete.id === mobileAthleteId) ?? null;
  const detailAthlete = mobileAthlete ?? selectedAthlete;

  useEffect(() => {
    const restoreMobileAthlete = () => {
      const historyDetail = appDetailFromHistory();
      const historyData = appDetailDataFromHistory();
      if (
        historyDetail !== "coach-athlete" ||
        historyData?.kind !== "coach-athlete"
      ) {
        setMobileAthleteId(null);
        setAthleteTab("plan");
        return;
      }
      const athlete = athletes.find(
        (candidate) => candidate.id === historyData.athleteId,
      );
      if (!athlete) {
        setMobileAthleteId(null);
        return;
      }
      setMobileAthleteId(athlete.id);
      setAthleteTab(historyData.tab);
      if (selectedAthlete?.id !== athlete.id) onSelectAthlete(athlete);
    };
    restoreMobileAthlete();
    window.addEventListener("popstate", restoreMobileAthlete);
    window.addEventListener("hashchange", restoreMobileAthlete);
    return () => {
      window.removeEventListener("popstate", restoreMobileAthlete);
      window.removeEventListener("hashchange", restoreMobileAthlete);
    };
  }, [athletes, onSelectAthlete, selectedAthlete?.id]);

  function openAthlete(athlete: AthleteSummary) {
    setAthleteTab("plan");
    setMobileAthleteId(athlete.id);
    onSelectAthlete(athlete);
    if (window.matchMedia?.("(max-width: 700px)").matches) {
      pushAppDetailHistory("coach-athlete", "coaching", {
        data: { kind: "coach-athlete", athleteId: athlete.id, tab: "plan" },
      });
    }
  }

  function selectAthleteTab(tab: CoachAthleteWorkspaceTab) {
    setAthleteTab(tab);
    if (!detailAthlete) return;
    pushAppDetailHistory("coach-athlete", "coaching", {
      data: { kind: "coach-athlete", athleteId: detailAthlete.id, tab },
    });
  }

  function closeMobileAthlete() {
    if (
      appDetailFromHistory() === "coach-athlete" &&
      leaveAppDetailHistory()
    ) {
      return;
    }
    setMobileAthleteId(null);
  }

  return (
    <section
      className={`coach-workspace${mobileAthlete ? " mobile-detail-open" : ""}`}
      aria-label="Coach workspace"
    >
      <AthleteDirectory
        athletes={athletes}
        pendingInvites={pendingInvites}
        selectedAthleteId={selectedAthlete?.id ?? null}
        refreshing={refreshing}
        hasMoreAthletes={hasMoreAthletes}
        loadingMoreAthletes={loadingMoreAthletes}
        athletesLoadError={athletesLoadError}
        respondingInvite={respondingInvite}
        onRefresh={onRefresh}
        onRespondInvite={onRespondInvite}
        onSelectAthlete={openAthlete}
        onLoadMoreAthletes={onLoadMoreAthletes}
      />

      <div className="coach-athlete-detail">
        {detailAthlete ? (
          <AthleteWorkspace
            athlete={detailAthlete}
            tab={athleteTab}
            loading={
              detailAthlete.detailsLoaded === false &&
              loadingAthleteId === detailAthlete.id
            }
            openingProgramId={openingProgramId}
            loadingHistory={loadingHistoryAthleteId === detailAthlete.id}
            loadingProgramRuns={
              loadingProgramRunsAthleteId === detailAthlete.id
            }
            onBack={closeMobileAthlete}
            onTab={selectAthleteTab}
            onRetry={() => onSelectAthlete(detailAthlete)}
            onAssign={() => onAssignAthlete(detailAthlete)}
            onSchedule={(program) =>
              onScheduleAthlete(detailAthlete, program)
            }
            onUnassign={(program) =>
              onUnassignAthlete(detailAthlete, program)
            }
            onRepeat={(program) =>
              onRepeatAthlete?.(detailAthlete, program)
            }
            onLoadMoreHistory={() => onLoadMoreHistory?.(detailAthlete)}
            onLoadMoreProgramRuns={() =>
              onLoadMoreProgramRuns?.(detailAthlete)
            }
            onOpenProgram={(program, workoutId) =>
              onOpenAssignedProgram(detailAthlete, program, workoutId)
            }
            onOpenAgendaEntry={
              onOpenAgendaEntry
                ? (entry) => onOpenAgendaEntry(detailAthlete, entry)
                : undefined
            }
          />
        ) : (
          <section className="panel coach-workspace-empty">
            <Users size={28} />
            <h2>Select an athlete</h2>
            <p>Choose an athlete to review their plan and workout history.</p>
          </section>
        )}
      </div>
    </section>
  );
}

function AthleteDirectory({
  athletes,
  pendingInvites,
  selectedAthleteId,
  refreshing,
  hasMoreAthletes,
  loadingMoreAthletes,
  athletesLoadError,
  respondingInvite,
  onRefresh,
  onRespondInvite,
  onSelectAthlete,
  onLoadMoreAthletes,
}: Pick<
  CoachWorkspaceProps,
  | "athletes"
  | "pendingInvites"
  | "refreshing"
  | "hasMoreAthletes"
  | "loadingMoreAthletes"
  | "athletesLoadError"
  | "respondingInvite"
  | "onRefresh"
  | "onRespondInvite"
  | "onLoadMoreAthletes"
> & {
  selectedAthleteId: string | null;
  onSelectAthlete: (athlete: AthleteSummary) => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleAthletes = athletes.filter((athlete) =>
    !normalizedQuery || athlete.name.toLocaleLowerCase().includes(normalizedQuery),
  );
  return (
    <aside className="panel coach-athlete-directory" aria-label="Your athletes">
      <div className="coach-directory-heading">
        <div>
          <p className="eyebrow">Your athletes</p>
          <h2>
            {athletes.length} active {athletes.length === 1 ? "athlete" : "athletes"}
          </h2>
        </div>
        <button
          type="button"
          className="icon-button"
          disabled={refreshing}
          onClick={onRefresh}
          aria-label={refreshing ? "Refreshing athletes" : "Refresh athletes"}
        >
          <RefreshCw
            className={refreshing ? "button-spinner" : undefined}
            size={17}
          />
        </button>
      </div>

      {athletes.length > 4 && (
        <label className="search-field coach-athlete-search">
          <Search size={16} />
          <input
            aria-label="Search athletes"
            placeholder="Search athletes"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      )}

      {pendingInvites.length > 0 && (
        <div className="coach-invite-list">
          <p className="eyebrow">Requests</p>
          {pendingInvites.map((invitation) => {
            const currentResponse =
              respondingInvite?.id === invitation.id
                ? respondingInvite.response
                : null;
            return (
              <article key={invitation.id}>
                <PersonAvatar
                  initials={invitation.athleteInitials}
                  name={invitation.athleteName}
                />
                <div>
                  <strong>{invitation.athleteName}</strong>
                  <small>Wants you as their coach</small>
                </div>
                <div className="coach-invite-actions">
                  <button
                    type="button"
                    className="button secondary small"
                    disabled={Boolean(respondingInvite)}
                    onClick={() => onRespondInvite(invitation, "declined")}
                  >
                    {currentResponse === "declined" ? "Declining…" : "Decline"}
                  </button>
                  <button
                    type="button"
                    className="button primary small"
                    disabled={Boolean(respondingInvite)}
                    onClick={() => onRespondInvite(invitation, "accepted")}
                  >
                    {currentResponse === "accepted" ? (
                      <>
                        <LoaderCircle className="button-spinner" size={14} />
                        Accepting…
                      </>
                    ) : (
                      <>
                        <Check size={14} />
                        Accept
                      </>
                    )}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="coach-athlete-list">
        {visibleAthletes.map((athlete) => {
          const loadedProgramCount = runsForAthlete(athlete).filter(
            (run) => run.status === "not_started" || run.status === "in_progress",
          ).length;
          const programCount =
            athlete.detailsLoaded === false
              ? (athlete.assignedProgramCount ?? loadedProgramCount)
              : loadedProgramCount;
          return (
            <button
              type="button"
              key={athlete.id}
              className={selectedAthleteId === athlete.id ? "active" : undefined}
              onClick={() => onSelectAthlete(athlete)}
              aria-current={selectedAthleteId === athlete.id ? "page" : undefined}
              aria-label={`Open ${athlete.name}, ${programCount} active training ${programCount === 1 ? "plan" : "plans"}`}
            >
              <PersonAvatar initials={athlete.initials} name={athlete.name} />
              <span>
                <strong>{athlete.name}</strong>
                <small>
                  {programCount
                    ? `${programCount} active ${programCount === 1 ? "plan" : "plans"}`
                    : "No active training"}
                </small>
              </span>
              <ChevronRight size={18} />
            </button>
          );
        })}
      </div>

      {normalizedQuery && !visibleAthletes.length && (
        <div className="coach-directory-no-match">
          <strong>No matching athletes</strong>
          <small>Try another name.</small>
        </div>
      )}

      {!athletes.length && !pendingInvites.length && (
        <div className="coach-directory-empty">
          <UserRound size={25} />
          <strong>No athletes yet</strong>
          <p>Athletes appear here after you accept their coaching request.</p>
        </div>
      )}

      {athletesLoadError && <InlineError>{athletesLoadError}</InlineError>}
      {hasMoreAthletes && (
        <button
          type="button"
          className="button secondary coach-load-more"
          disabled={loadingMoreAthletes}
          onClick={onLoadMoreAthletes}
        >
          {loadingMoreAthletes && (
            <LoaderCircle className="button-spinner" size={15} />
          )}
          {loadingMoreAthletes ? "Loading…" : "Load more athletes"}
        </button>
      )}
    </aside>
  );
}

function AthleteWorkspace({
  athlete,
  tab,
  loading,
  openingProgramId,
  loadingHistory,
  loadingProgramRuns,
  onBack,
  onTab,
  onRetry,
  onAssign,
  onSchedule,
  onUnassign,
  onRepeat,
  onLoadMoreHistory,
  onLoadMoreProgramRuns,
  onOpenProgram,
  onOpenAgendaEntry,
}: {
  athlete: AthleteSummary;
  tab: CoachAthleteWorkspaceTab;
  loading: boolean;
  openingProgramId: string | null;
  loadingHistory: boolean;
  loadingProgramRuns: boolean;
  onBack: () => void;
  onTab: (tab: CoachAthleteWorkspaceTab) => void;
  onRetry: () => void;
  onAssign: () => void;
  onSchedule: (program?: CoachWorkspaceRun) => void;
  onUnassign: (program: CoachWorkspaceRun) => void;
  onRepeat: (program: CoachWorkspaceRun) => void;
  onLoadMoreHistory: () => void;
  onLoadMoreProgramRuns: () => void;
  onOpenProgram: (
    program: CoachWorkspaceRun,
    workoutId?: string,
  ) => void;
  onOpenAgendaEntry?: (entry: CoachAgendaEntry) => void;
}) {
  const historyEntries = useMemo(() => completedHistory(athlete), [athlete]);

  if (athlete.detailsLoaded === false) {
    return (
      <section className="coach-athlete-workspace" aria-label={`${athlete.name} workspace`}>
        <button
          type="button"
          className="coach-mobile-back"
          onClick={onBack}
          aria-label="Back to athletes"
        >
          <ChevronLeft size={22} />
          Athletes
        </button>
        <div className="panel coach-workspace-empty" aria-live="polite">
          {loading ? (
            <>
              <LoaderCircle className="button-spinner" size={28} />
              <h2>Loading {athlete.name}…</h2>
            <p>Fetching active training and recent workout results.</p>
            </>
          ) : (
            <>
              <Users size={28} />
              <h2>Athlete details unavailable</h2>
              <p>Try loading this athlete again.</p>
              <button type="button" className="button secondary" onClick={onRetry}>
                Try again
              </button>
            </>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="coach-athlete-workspace" aria-label={`${athlete.name} workspace`}>
      <button
        type="button"
        className="coach-mobile-back"
        onClick={onBack}
        aria-label="Back to athletes"
      >
        <ChevronLeft size={22} />
        Athletes
      </button>

      <header className="panel coach-athlete-header">
        <div className="coach-athlete-identity">
          <PersonAvatar initials={athlete.initials} name={athlete.name} size="large" />
          <div>
            <p className="eyebrow">Athlete</p>
            <h2>{athlete.name}</h2>
            <p>Assigned training and workout results</p>
          </div>
        </div>
        <button type="button" className="button primary" onClick={onAssign}>
          <Dumbbell size={16} />
          Assign training
        </button>
      </header>

      <SegmentedTabs
        tabs={[
          { value: "plan", label: "Plan", icon: CalendarPlus },
          { value: "history", label: "History", icon: History },
        ]}
        value={tab}
        onChange={onTab}
        label={`${athlete.name} workspace sections`}
        panelId="coach-athlete-workspace-panel"
        className="coach-athlete-tabs"
      />

      <div
        id="coach-athlete-workspace-panel"
        role="tabpanel"
        aria-label={tab === "plan" ? "Athlete plan" : "Workout history"}
      >
        {tab === "plan" ? (
          <AthletePlan
            athlete={athlete}
            openingProgramId={openingProgramId}
            onAssign={onAssign}
            onSchedule={onSchedule}
            onUnassign={onUnassign}
            onOpenProgram={onOpenProgram}
          />
        ) : (
          <AthleteHistory
            athlete={athlete}
            entries={historyEntries}
            openingProgramId={openingProgramId}
            onOpenProgram={onOpenProgram}
            onRepeat={onRepeat}
            loadingMore={loadingHistory}
            hasMore={Boolean(athlete.hasMoreHistory)}
            onLoadMore={onLoadMoreHistory}
            onOpenAgendaEntry={onOpenAgendaEntry}
          />
        )}
      </div>
      {athlete.hasMoreProgramRuns && (
        <button
          type="button"
          className="button secondary coach-history-load-more"
          disabled={loadingProgramRuns}
          onClick={onLoadMoreProgramRuns}
        >
          {loadingProgramRuns && (
            <LoaderCircle className="button-spinner" size={15} />
          )}
          {loadingProgramRuns ? "Loading training…" : "Load more training"}
        </button>
      )}
    </section>
  );
}

function AthletePlan({
  athlete,
  openingProgramId,
  onAssign,
  onSchedule,
  onUnassign,
  onOpenProgram,
}: {
  athlete: AthleteSummary;
  openingProgramId: string | null;
  onAssign: () => void;
  onSchedule: (program?: CoachWorkspaceRun) => void;
  onUnassign: (program: CoachWorkspaceRun) => void;
  onOpenProgram: (
    program: CoachWorkspaceRun,
    workoutId?: string,
  ) => void;
}) {
  const runs = runsForAthlete(athlete).filter(
    (run) => run.status === "not_started" || run.status === "in_progress",
  );
  return (
    <section className="panel coach-plan-panel">
      <div className="coach-section-heading">
        <div>
          <p className="eyebrow">Plan</p>
          <h2>
            {runs.length} active {runs.length === 1 ? "plan" : "plans"}
          </h2>
        </div>
      </div>

      {runs.length > 0 ? (
        <div className="coach-run-list">
          {runs.map((program) => (
            <ProgramRunCard
              key={program.id}
              program={program}
              opening={openingProgramId === program.id}
              openingDisabled={Boolean(openingProgramId)}
              onSchedule={() => onSchedule(program)}
              onUnassign={() => onUnassign(program)}
              onOpen={() => onOpenProgram(program)}
            />
          ))}
        </div>
      ) : (
        <div className="coach-plan-empty">
          <span><Dumbbell size={24} /></span>
          <h3>No training assigned</h3>
          <p>Assign a program or workout to give {athlete.name} a clear plan.</p>
          <button type="button" className="button primary" onClick={onAssign}>
            <Dumbbell size={15} />
            Assign training
          </button>
        </div>
      )}
    </section>
  );
}

function ProgramRunCard({
  program,
  opening,
  openingDisabled,
  onSchedule,
  onUnassign,
  onOpen,
}: {
  program: CoachWorkspaceRun;
  opening: boolean;
  openingDisabled: boolean;
  onSchedule: () => void;
  onUnassign: () => void;
  onOpen: () => void;
}) {
  return (
    <ProgramRunCompactCard
      run={program}
      sourceLabel="Assigned by you"
      opening={opening}
      openingDisabled={openingDisabled}
      onOpen={onOpen}
      onSchedule={onSchedule}
      onEnd={onUnassign}
    />
  );
}

function AthleteHistory({
  athlete,
  entries,
  openingProgramId,
  onOpenProgram,
  onRepeat,
  loadingMore,
  hasMore,
  onLoadMore,
  onOpenAgendaEntry,
}: {
  athlete: AthleteSummary;
  entries: CoachAgendaEntry[];
  openingProgramId: string | null;
  onOpenProgram: (
    program: CoachWorkspaceRun,
    workoutId?: string,
  ) => void;
  onRepeat: (program: CoachWorkspaceRun) => void;
  loadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onOpenAgendaEntry?: (entry: CoachAgendaEntry) => void;
}) {
  const finishedRuns = runsForAthlete(athlete).filter(
    (run) => run.status === "completed" || run.status === "ended",
  );
  return (
    <section className="panel coach-history-panel">
      <div className="coach-section-heading">
        <div>
          <p className="eyebrow">Workout history</p>
          <h2>Workout results</h2>
        </div>
        <span className="coach-history-count">{entries.length}{hasMore ? "+" : ""}</span>
      </div>

      {finishedRuns.length > 0 && (
        <div className="coach-finished-runs" aria-label="Finished program runs">
          {finishedRuns.map((run) => (
            <article key={run.id}>
              <span><Dumbbell size={16} /></span>
              <div>
                <strong>{run.title}</strong>
                <small>
                  {run.completedWorkouts} of {run.totalWorkouts} finished · {run.status === "ended" ? "Ended" : "Finished"}
                </small>
              </div>
              <div className="coach-finished-run-actions">
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => onOpenProgram(run)}
                >
                  View
                </button>
                {!run.legacy && (
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() => onRepeat(run)}
                  >
                    <RefreshCw size={14} />
                    Repeat
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {entries.length > 0 ? (
        <div className="coach-history-list">
          {entries.map((entry) => {
            const program = runsForAthlete(athlete).find((candidate) =>
              entry.programRunId
                ? candidate.id === entry.programRunId
                : (entry.assignmentId && candidate.assignmentId === entry.assignmentId) ||
                  (candidate.programId === entry.programId &&
                    candidate.programVersionId === entry.programVersionId),
            );
            return (
              <button
                type="button"
                key={entry.id}
                disabled={Boolean(openingProgramId)}
                onClick={() => {
                  if (onOpenAgendaEntry) onOpenAgendaEntry(entry);
                  else if (program) onOpenProgram(program, entry.workoutId);
                }}
              >
                <span className="coach-history-icon"><Check size={16} /></span>
                <span>
                  <strong>{entry.workoutTitle}</strong>
                  <small>{entry.programTitle}</small>
                </span>
                <span className="coach-history-result">
                  <strong>{dateLabel(entry.date, true)}</strong>
                  {entry.rpe !== undefined && (
                    <i className={`rpe-${entry.rpe >= 9 ? "high" : entry.rpe >= 5 ? "balanced" : "low"}`}>
                      RPE {entry.rpe}
                    </i>
                  )}
                </span>
                <ChevronRight size={17} />
              </button>
            );
          })}
        </div>
      ) : (
        <div className="coach-history-empty">
          <Clock3 size={25} />
          <h3>No completed workouts yet</h3>
          <p>{athlete.name}’s results will appear here after training.</p>
        </div>
      )}
      {hasMore && (
        <button
          type="button"
          className="button secondary coach-history-load-more"
          disabled={loadingMore}
          onClick={onLoadMore}
        >
          {loadingMore && <LoaderCircle className="button-spinner" size={15} />}
          {loadingMore ? "Loading results…" : "Load more results"}
        </button>
      )}
    </section>
  );
}

export const coachWorkspaceViewModel = {
  agendaForProgram,
  completedHistory,
  programStatusPresentation,
};
