import { ObjectActionMenu } from "../../object-action-menu";
import { ChevronRight, LoaderCircle } from "lucide-react";
import type { ProgramRunSummary } from "../../../lib/domain";
import { formatDateOnly } from "../../../lib/date-only";
import { actionUi, trainingContentUi } from "../../ui-semantics";

function assignmentDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function shortDate(value: string) {
  return formatDateOnly(value, {
    month: "short",
    day: "numeric",
  });
}

export function ProgramRunCompactCard({
  run,
  sourceLabel,
  opening = false,
  openingDisabled = false,
  onOpen,
  onSchedule,
  onEnd,
}: {
  run: ProgramRunSummary;
  sourceLabel?: string;
  opening?: boolean;
  openingDisabled?: boolean;
  onOpen: () => void;
  onSchedule?: () => void;
  onEnd: () => void;
}) {
  const quickWorkout = run.contentType === "quick_workout";
  const { label: objectLabel, icon: ObjectIcon } = trainingContentUi(run.contentType);
  const unscheduled = Math.max(0, run.totalWorkouts - run.scheduledWorkouts);
  const progress = run.status === "in_progress"
    ? quickWorkout
      ? "In progress"
      : `In progress · ${run.completedWorkouts}/${run.totalWorkouts} completed`
    : run.scheduledWorkouts > 0
      ? `Scheduled${run.nextWorkout?.plannedDate ? ` · ${shortDate(run.nextWorkout.plannedDate)}` : ""}`
      : sourceLabel
        ? "Assigned"
        : "Ready to schedule";

  return (
    <article className="program-catalog-card panel program-run-compact-card">
      <button
        type="button"
        className="program-card-main"
        aria-label={`Open ${run.title}`}
        disabled={openingDisabled}
        onClick={onOpen}
      >
        <span className="program-card-heading">
          <span className="program-icon">
            <ObjectIcon size={18} />
          </span>
          <span>
            <strong>{run.title}</strong>
            <small>{sourceLabel ? `${sourceLabel} · ` : ""}{run.createdById === run.athleteId ? "Created" : "Assigned"} {assignmentDate(run.createdAt)}</small>
          </span>
          {opening ? (
            <span className="program-card-loading" aria-label="Opening training">
              <LoaderCircle className="button-spinner" size={16} />
            </span>
          ) : <ChevronRight size={16} aria-hidden="true" />}
        </span>
      </button>
      <div className="program-card-footer">
        <div className="program-card-status-row">
          <span className="program-card-meta">
            <span>{quickWorkout ? "1 workout" : `${run.totalWorkouts} workouts`}</span>
          </span>
          <span className="program-card-ready">{progress}</span>
        </div>
        <ObjectActionMenu title={run.title}
          primary={unscheduled > 0 && onSchedule ? { ...actionUi.schedule, accessibleLabel: `Schedule ${run.title}`, onClick: onSchedule, disabled: openingDisabled } : undefined}
          actions={[{ ...actionUi.end, label: `End ${objectLabel.toLowerCase()}`, accessibleLabel: `End ${run.title}`, onClick: onEnd, destructive: true, disabled: openingDisabled }]}
        />
      </div>
    </article>
  );
}
