import {
  Activity,
  CalendarPlus,
  ChevronRight,
  Layers3,
  LoaderCircle,
  Trash2,
} from "lucide-react";
import type { ProgramRunSummary } from "../../../lib/domain";
import { formatDateOnly } from "../../../lib/date-only";

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
        disabled={openingDisabled}
        onClick={onOpen}
      >
        <span className="program-card-heading">
          <span className="program-icon">
            {quickWorkout ? <Activity size={18} /> : <Layers3 size={18} />}
          </span>
          <span>
            <strong>{run.title}</strong>
            <small>{sourceLabel ? `${sourceLabel} · ` : ""}{run.createdById === run.athleteId ? "Started" : "Assigned"} {assignmentDate(run.createdAt)}</small>
          </span>
          {opening && (
            <span className="program-card-loading" aria-label="Opening training">
              <LoaderCircle className="button-spinner" size={16} />
            </span>
          )}
        </span>
      </button>
      <div className="program-card-footer">
        <div className="program-card-status-row">
          <span className="program-card-meta">
            <span>{quickWorkout ? "1 workout" : `${run.totalWorkouts} workouts`}</span>
          </span>
          <button
            type="button"
            className="program-card-active-run"
            disabled={openingDisabled}
            onClick={onOpen}
            aria-label={`Open active ${run.title} training`}
          >
            {quickWorkout ? <Activity size={13} /> : <CalendarPlus size={13} />}
            {progress}
            <ChevronRight size={13} />
          </button>
        </div>
        <div className="program-card-actions">
          {unscheduled > 0 && onSchedule && (
            <button
              type="button"
              className="icon-button program-card-action-schedule"
              onClick={onSchedule}
              aria-label={`Schedule ${run.title}`}
              title={quickWorkout ? "Schedule workout" : "Schedule program"}
            >
              <CalendarPlus size={15} />
            </button>
          )}
          <button
            type="button"
            className="icon-button danger program-card-action-delete"
            onClick={onEnd}
            aria-label={`End ${run.title}`}
            title={quickWorkout ? "End workout" : "End program"}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    </article>
  );
}
