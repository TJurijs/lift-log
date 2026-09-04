import { Activity, CalendarDays, Check, Dumbbell, LoaderCircle } from "lucide-react";
import { useState } from "react";
import type { CompletedSession, ScheduledWorkout, ViewName } from "../../../lib/domain";
import { formatDateOnly } from "../../../lib/date-only";
import { formatDuration, sourceFromScheduledWorkout } from "../../../lib/presentation";
import { AsyncButton, PageHeader, SourceTag, StatusBadge } from "../../ui-primitives";
export default function NextWorkoutsView({
  schedules,
  completedSessions,
  hasProgram,
  hasPublishedProgram,
  startingScheduleId,
  activeScheduleId,
  onNavigate,
  onSchedule,
  onStart,
  onOpen,
  onSetStatus,
  statusAction,
  hasMore = false,
  loading = false,
  error = null,
  onLoadMore,
  completedLoading = false,
  completedError = null,
  completedHasMore = false,
  onLoadMoreCompleted,
  onLoadCompleted,
  onOpenCompleted,
}: {
  schedules: ScheduledWorkout[];
  completedSessions: CompletedSession[];
  hasProgram: boolean;
  hasPublishedProgram: boolean;
  startingScheduleId: string | null;
  activeScheduleId: string | null;
  onNavigate: (view: ViewName) => void;
  onSchedule: () => void;
  onStart: (schedule: ScheduledWorkout) => void;
  onOpen: (schedule: ScheduledWorkout) => void;
  onSetStatus: (scheduleId: string, status: "planned" | "skipped") => void;
  statusAction: { id: string; status: "planned" | "skipped" } | null;
  hasMore?: boolean;
  loading?: boolean;
  error?: string | null;
  onLoadMore?: () => void;
  completedLoading?: boolean;
  completedError?: string | null;
  completedHasMore?: boolean;
  onLoadMoreCompleted?: () => void;
  onLoadCompleted?: () => void;
  onOpenCompleted: (session: CompletedSession) => void;
}) {
  const [showCompleted, setShowCompleted] = useState(false);
  const completedHistory = [...completedSessions].sort((left, right) =>
    right.date.localeCompare(left.date),
  );
  const toggleCompletedHistory = () => {
    const nextVisible = !showCompleted;
    setShowCompleted(nextVisible);
    if (nextVisible) onLoadCompleted?.();
  };
  const completedControl = (
    <button
      type="button"
      className="button secondary"
      aria-expanded={showCompleted}
      aria-controls="completed-workouts"
      onClick={toggleCompletedHistory}
    >
      <Check size={15} />
      {showCompleted ? "Hide completed" : "Show completed"}
    </button>
  );
  const completedSection = showCompleted ? (
    <section id="completed-workouts" className="next-workouts-list" aria-label="Completed workouts">
      <div className="section-heading">
        <span>Completed workouts</span>
        <small>{completedHistory.length}{completedHasMore ? "+" : ""} {completedHistory.length === 1 ? "workout" : "workouts"}</small>
      </div>
      {completedLoading && !completedHistory.length ? (
        <div className="feature-load-status" role="status">
          <LoaderCircle size={16} className="spin" />
          Loading completed workouts…
        </div>
      ) : completedHistory.length ? completedHistory.map((session) => {
        const dateLabel = formatDateOnly(session.date, {
          weekday: "long",
          day: "numeric",
          month: "long",
        }, "en");
        return (
          <article className="panel next-workout-card" key={session.id}>
            <div className="next-workout-date">
              <Check size={17} />
              <div>
                <small>Completed</small>
                <strong>{dateLabel}</strong>
              </div>
            </div>
            <button
              className="next-workout-summary"
              onClick={() => onOpenCompleted(session)}
            >
              <p>Workout results</p>
              <h2>{session.workoutTitle}</h2>
              <small>
                {session.durationMinutes ? formatDuration(session.durationMinutes) : "Completed"}
                {session.rpe ? ` · RPE ${session.rpe}` : ""}
              </small>
            </button>
            <StatusBadge status="completed" compact />
          </article>
        );
      }) : !completedError && (
        <p className="calendar-day-agenda-empty">No completed workouts yet.</p>
      )}
      {completedError ? (
        <div className="feature-load-status error" role="alert">
          <span>{completedError}</span>
          <button type="button" className="text-button" onClick={completedHasMore ? onLoadMoreCompleted : onLoadCompleted}>Try again</button>
        </div>
      ) : completedHasMore && (
        <AsyncButton className="button secondary library-load-more" loading={completedLoading} loadingLabel="Loading history…" onClick={onLoadMoreCompleted}>
          Load older workouts
        </AsyncButton>
      )}
    </section>
  ) : null;
  const loadMoreControl = error ? (
    <div className="feature-load-status error" role="alert">
      <span>{error}</span>
      {onLoadMore && (
        <button className="text-button" onClick={onLoadMore}>
          Try again
        </button>
      )}
    </div>
  ) : hasMore || loading ? (
    <AsyncButton
      className="button secondary library-load-more"
      loading={loading}
      loadingLabel="Loading workouts…"
      disabled={!onLoadMore}
      onClick={onLoadMore}
    >
      Load more workouts
    </AsyncButton>
  ) : null;

  if (schedules.length) {
    return (
      <>
        <PageHeader
          eyebrow="Your schedule"
          title="Next workouts"
          description="Every workout scheduled from today onward. Start any one whenever you are ready."
        >
          {completedControl}
        </PageHeader>
        <section className="next-workouts-list" aria-label="Scheduled workouts">
          {schedules.map((schedule) => {
            const dateLabel = formatDateOnly(schedule.plannedDate!, {
              weekday: "long",
              day: "numeric",
              month: "long",
            }, "en");
            return (
              <article className="panel next-workout-card" key={schedule.id}>
                <div className="next-workout-date">
                  <CalendarDays size={17} />
                  <div>
                    <small>{dateLabel}</small>
                    <strong>{schedule.plannedDate}</strong>
                  </div>
                </div>
                <button
                  className="next-workout-summary"
                  onClick={() => onOpen(schedule)}
                >
                  <SourceTag source={sourceFromScheduledWorkout(schedule)} compact />
                  <p>{schedule.programTitle}</p>
                  <h2>{schedule.workoutTitle}</h2>
                  <small>
                    {schedule.workout.dayLabel}
                    {schedule.workout.durationMinutes > 0
                      ? ` · ${formatDuration(schedule.workout.durationMinutes)}`
                      : ""}
                  </small>
                </button>
                {schedule.status === "skipped" ? (
                  <AsyncButton
                    className="button secondary"
                    loading={statusAction?.id === schedule.id}
                    loadingLabel="Restoring…"
                    onClick={() => onSetStatus(schedule.id, "planned")}
                  >
                    Set back to planned
                  </AsyncButton>
                ) : (
                  <AsyncButton
                    className="button primary"
                    loading={startingScheduleId === schedule.id}
                    loadingLabel="Starting…"
                    icon={Activity}
                    onClick={() => onStart(schedule)}
                  >
                    {activeScheduleId === schedule.id
                      ? "Resume workout"
                      : "Start workout"}
                  </AsyncButton>
                )}
              </article>
            );
          })}
        </section>
        {loadMoreControl}
        {completedSection}
      </>
    );
  }

  if (loading || error || hasMore) {
    return (
      <>
        <PageHeader
          eyebrow="Your schedule"
          title="Next workouts"
          description="Scheduled workouts will appear here as they load."
        >
          {completedControl}
        </PageHeader>
        {loadMoreControl}
        {completedSection}
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Next workouts"
        title="No future workouts scheduled"
        description={
          hasProgram
            ? "Start a program to schedule the full workout sequence, or keep its dates flexible."
            : "Start only when you choose a program or create one of your own."
        }
      >
        {completedControl}
      </PageHeader>
      <div className="panel empty-state today-empty">
        <CalendarDays size={28} />
        <h3>
          {hasProgram
            ? "Choose a training plan"
            : "No training has been added"}
        </h3>
        <p>
          {hasProgram
            ? hasPublishedProgram
              ? "You can set every workout date in one step and adjust them later."
              : "Open an editable program and add at least one workout."
            : "Choose a workout or build a training plan in Programs."}
        </p>
        <div className="empty-actions">
          {hasPublishedProgram && (
            <button className="button primary" onClick={onSchedule}>
              <Activity size={15} />
              Start training
            </button>
          )}
          <button
            className="button secondary"
            onClick={() => onNavigate("program")}
          >
            <Dumbbell size={15} />
            {hasProgram ? "Open program" : "Choose a program"}
          </button>
        </div>
      </div>
      {completedSection}
    </>
  );
}
