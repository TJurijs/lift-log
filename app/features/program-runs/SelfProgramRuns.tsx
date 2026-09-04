import {
  Check,
  ChevronDown,
  Dumbbell,
  RefreshCw,
  Users,
} from "lucide-react";
import type { ProgramRunSummary } from "../../../lib/domain";
import { programRunLifecycleLabel } from "../../../lib/program-progress";
import { AsyncButton } from "../../ui-primitives";
import { ProgramRunCompactCard } from "./ProgramRunCompactCard";

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
  return (
    <ProgramRunCompactCard
      run={run}
      sourceLabel={sourceLabel}
      onOpen={onOpen}
      onSchedule={onSchedule}
      onEnd={onEnd}
    />
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
  const hasPendingResults = hasMore || loadingMore || Boolean(loadError);
  if (!runs.length && !showEmpty && !hasPendingResults) return null;

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
            <ChevronDown className="self-finished-chevron" size={16} aria-hidden="true" />
          </summary>
          <div>
            {finished.map((run) => (
              <article key={run.id}>
                <span><Dumbbell size={15} /></span>
                <div>
                  <strong>{run.title}</strong>
                  <small>{programRunLifecycleLabel(run)} · {createdLabel(run.finishedAt ?? run.endedAt ?? run.createdAt)}</small>
                </div>
                <button type="button" className="button secondary small" aria-label={`View ${run.title}`} onClick={() => onOpen(run)}>
                  View
                </button>
                <button type="button" className="button secondary small" aria-label={`Repeat ${run.title}`} onClick={() => onRepeat(run)}>
                  <RefreshCw size={13} />Repeat
                </button>
              </article>
            ))}
          </div>
        </details>
      )}
      {!runs.length && showEmpty && !hasPendingResults && (
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
            <button type="button" className="text-button" disabled={loadingMore} onClick={onLoadMore}>
              Try again
            </button>
          )}
        </div>
      )}
      {!loadError && (hasMore || loadingMore) && (
        <AsyncButton
          className="button secondary self-runs-load-more"
          disabled={!onLoadMore}
          loading={loadingMore}
          loadingLabel="Loading training…"
          onClick={onLoadMore}
        >
          Load more training
        </AsyncButton>
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
  const coachRuns = [
    ...new Map(
      runs
        .filter(
          (run) => run.athleteId === viewerId && run.createdById !== viewerId,
        )
        .map((run) => [run.id, run]),
    ).values(),
  ];
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
