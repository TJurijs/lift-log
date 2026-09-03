import {
  BookOpen,
  CalendarPlus,
  Check,
  Dumbbell,
  LoaderCircle,
  RefreshCw,
  Square,
  Users,
} from "lucide-react";
import type { ProgramRunSummary } from "../../../lib/domain";
import { programRunLifecycleLabel } from "../../../lib/program-progress";
import { StatusBadge } from "../../ui-primitives";

export interface SelfProgramRunsProps {
  runs: ProgramRunSummary[];
  onOpen: (run: ProgramRunSummary) => void;
  onSchedule: (run: ProgramRunSummary) => void;
  onEnd: (run: ProgramRunSummary) => void;
  onRepeat: (run: ProgramRunSummary) => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  loadError?: string;
  onLoadMore?: () => void;
}

export interface CoachProgramRunsProps extends SelfProgramRunsProps {
  viewerId: string;
}

function createdLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function plannedDateLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function RunCard({
  run,
  sourceLabel,
  onOpen,
  onSchedule,
  onEnd,
}: {
  run: ProgramRunSummary;
  sourceLabel?: string;
  onOpen: () => void;
  onSchedule: () => void;
  onEnd: () => void;
}) {
  const unscheduled = Math.max(0, run.totalWorkouts - run.scheduledWorkouts);
  const isQuickWorkout = run.contentType === "quick_workout";
  return (
    <article className="self-run-card">
      <div className="self-run-title">
        <span><Dumbbell size={17} /></span>
        <div>
          <h3>{run.title}</h3>
          <p>
            {sourceLabel ? `${sourceLabel} · ` : ""}
            {run.completedWorkouts} of {run.totalWorkouts} workouts completed
          </p>
        </div>
        <StatusBadge
          status={run.status === "in_progress" ? "in_progress" : "planned"}
          label={programRunLifecycleLabel(run)}
          compact
        />
      </div>
      <div className="self-run-progress" aria-label={`${run.completionPercent}% complete`}>
        <i style={{ width: `${Math.min(100, Math.max(0, run.completionPercent))}%` }} />
      </div>
      {run.nextWorkout && (
        <p className="self-run-next">
          <strong>Next:</strong> {run.nextWorkout.title}
          {run.nextWorkout.plannedDate
            ? ` · ${plannedDateLabel(run.nextWorkout.plannedDate)}`
            : " · no date"}
        </p>
      )}
      <div className="self-run-actions">
        <button type="button" className="button secondary small" onClick={onOpen}>
          <BookOpen size={14} />{isQuickWorkout ? "View workout" : "View plan"}
        </button>
        {unscheduled > 0 && (
          <button type="button" className="button secondary small" onClick={onSchedule}>
            <CalendarPlus size={14} />
            {isQuickWorkout
              ? "Schedule workout"
              : `Schedule ${unscheduled === run.totalWorkouts ? "program" : "remaining"}`}
          </button>
        )}
        <button type="button" className="button danger small" onClick={onEnd}>
          <Square size={13} />End {isQuickWorkout ? "workout" : "program"}
        </button>
      </div>
    </article>
  );
}

function ProgramRunSections({
  runs,
  activeEyebrow,
  activeTitle,
  ariaLabel,
  sourceLabel,
  showEmpty = false,
  onOpen,
  onSchedule,
  onEnd,
  onRepeat,
  hasMore = false,
  loadingMore = false,
  loadError = "",
  onLoadMore,
}: SelfProgramRunsProps & {
  activeEyebrow: string;
  activeTitle: string;
  ariaLabel: string;
  sourceLabel?: string;
  showEmpty?: boolean;
}) {
  const active = runs.filter(
    (run) => run.status === "not_started" || run.status === "in_progress",
  );
  const finished = runs.filter(
    (run) => run.status === "completed" || run.status === "ended",
  );
  if (!runs.length && !showEmpty) return null;

  return (
    <section className="self-runs" aria-label={ariaLabel}>
      {active.length > 0 && (
        <>
          <div className="self-runs-heading">
            <div>
              <p className="eyebrow">{activeEyebrow}</p>
              <h2>{activeTitle}</h2>
            </div>
            <span>{active.length}</span>
          </div>
          <div className="self-run-list">
            {active.map((run) => (
              <RunCard
                key={run.id}
                run={run}
                sourceLabel={sourceLabel}
                onOpen={() => onOpen(run)}
                onSchedule={() => onSchedule(run)}
                onEnd={() => onEnd(run)}
              />
            ))}
          </div>
        </>
      )}
      {finished.length > 0 && (
        <details className="self-finished-runs">
          <summary>
            <span><Check size={15} />Recent training</span>
            <small>{finished.length}</small>
          </summary>
          <div>
            {finished.map((run) => (
              <article key={run.id}>
                <span><Dumbbell size={15} /></span>
                <div>
                  <strong>{run.title}</strong>
                  <small>{programRunLifecycleLabel(run)} · {createdLabel(run.finishedAt ?? run.endedAt ?? run.createdAt)}</small>
                </div>
                <button type="button" className="button secondary small" onClick={() => onOpen(run)}>
                  View
                </button>
                <button type="button" className="button secondary small" onClick={() => onRepeat(run)}>
                  <RefreshCw size={13} />Repeat
                </button>
              </article>
            ))}
          </div>
        </details>
      )}
      {!runs.length && (
        <div className="self-runs-empty">
          <Users size={24} />
          <h3>No coach training</h3>
          <p>Programs and workouts assigned by your coach will appear here.</p>
        </div>
      )}
      {loadError && (
        <div className="self-runs-load-error" role="alert">
          <span>{loadError}</span>
          {onLoadMore && (
            <button type="button" className="text-button" onClick={onLoadMore}>
              Try again
            </button>
          )}
        </div>
      )}
      {!loadError && (hasMore || loadingMore) && (
        <button
          type="button"
          className="button secondary self-runs-load-more"
          disabled={loadingMore || !onLoadMore}
          onClick={onLoadMore}
        >
          {loadingMore && <LoaderCircle className="button-spinner" size={15} />}
          {loadingMore ? "Loading training…" : "Load more training"}
        </button>
      )}
    </section>
  );
}

export default function SelfProgramRuns({
  runs,
  onOpen,
  onSchedule,
  onEnd,
  onRepeat,
  hasMore,
  loadingMore,
  loadError,
  onLoadMore,
}: SelfProgramRunsProps) {
  return (
    <ProgramRunSections
      runs={runs}
      activeEyebrow="Active training"
      activeTitle="Your training plans"
      ariaLabel="Your program runs"
      onOpen={onOpen}
      onSchedule={onSchedule}
      onEnd={onEnd}
      onRepeat={onRepeat}
      hasMore={hasMore}
      loadingMore={loadingMore}
      loadError={loadError}
      onLoadMore={onLoadMore}
    />
  );
}

export function CoachProgramRuns({
  viewerId,
  runs,
  onOpen,
  onSchedule,
  onEnd,
  onRepeat,
  hasMore,
  loadingMore,
  loadError,
  onLoadMore,
}: CoachProgramRunsProps) {
  const coachRuns = runs.filter(
    (run) => run.athleteId === viewerId && run.createdById !== viewerId,
  );
  return (
    <ProgramRunSections
      runs={coachRuns}
      activeEyebrow="From your coach"
      activeTitle="Assigned training"
      ariaLabel="Training from your coach"
      sourceLabel="Coach assigned"
      showEmpty
      onOpen={onOpen}
      onSchedule={onSchedule}
      onEnd={onEnd}
      onRepeat={onRepeat}
      hasMore={hasMore}
      loadingMore={loadingMore}
      loadError={loadError}
      onLoadMore={onLoadMore}
    />
  );
}
