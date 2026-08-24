import type {
  ActiveSession,
  PlannedWorkout,
  Program,
  ScheduledWorkout,
} from "./domain";
import { localDateOnly } from "./date-only";

export type WorkoutFocusTiming = "active" | "overdue" | "today" | "future";

export interface WorkoutFocus {
  schedule: ScheduledWorkout | null;
  workout: PlannedWorkout;
  timing: WorkoutFocusTiming;
  plannedDate?: string;
}

/**
 * Calendar workouts that are still ahead of the athlete. The Next workouts
 * page intentionally shows every dated planned or skipped occurrence from
 * today onward, not just the earliest one.
 */
export function listUpcomingWorkouts(
  schedules: ScheduledWorkout[],
  today = localDateOnly(),
) {
  return schedules
    .filter(
      (schedule) =>
        (schedule.status === "planned" || schedule.status === "skipped") &&
        Boolean(schedule.plannedDate) &&
        String(schedule.plannedDate) >= today,
    )
    .slice()
    .sort(
      (left, right) =>
        String(left.plannedDate).localeCompare(String(right.plannedDate)) ||
        left.sequenceNumber - right.sequenceNumber ||
        left.id.localeCompare(right.id),
    );
}

function findProgramWorkout(
  programs: Program[],
  activeSession: ActiveSession,
): PlannedWorkout | undefined {
  const matchingVersion = programs.find(
    (program) => program.versionId === activeSession.programVersionId,
  );
  const versionWorkout = matchingVersion?.weeks
    .flatMap((week) => week.workouts)
    .find((workout) => workout.id === activeSession.workoutId);
  if (versionWorkout) return versionWorkout;

  return programs
    .flatMap((program) => program.weeks)
    .flatMap((week) => week.workouts)
    .find((workout) => workout.id === activeSession.workoutId);
}

function matchingActiveSchedule(
  activeSession: ActiveSession,
  schedules: ScheduledWorkout[],
) {
  const exactSchedule = activeSession.scheduledWorkoutId
    ? schedules.find(
        (schedule) => schedule.id === activeSession.scheduledWorkoutId,
      )
    : undefined;
  if (exactSchedule) return exactSchedule;

  return schedules.find(
    (schedule) =>
      schedule.status === "in_progress" &&
      schedule.programVersionId === activeSession.programVersionId &&
      schedule.workoutId === activeSession.workoutId,
  );
}

/**
 * Chooses the workout that belongs on the Next workout screen.
 *
 * An active session always wins, even when its scheduled date is in the future
 * or its scheduled occurrence is undated. Without an active session, only
 * dated outstanding occurrences are eligible. Past occurrences deliberately
 * remain visible as overdue instead of silently disappearing from the flow.
 */
export function selectNextWorkoutFocus(
  programs: Program[],
  activeSession: ActiveSession | null,
  schedules: ScheduledWorkout[],
  today = localDateOnly(),
): WorkoutFocus | null {
  if (activeSession) {
    const activeSchedule = matchingActiveSchedule(activeSession, schedules);
    const activeWorkout =
      activeSchedule?.workout ?? findProgramWorkout(programs, activeSession);

    if (activeWorkout) {
      return {
        schedule: activeSchedule ?? null,
        workout: activeWorkout,
        timing: "active",
        plannedDate: activeSchedule?.plannedDate,
      };
    }

    // Do not offer another workout while an unresolved active session exists.
    // The caller can present recovery UI instead of allowing a second session
    // to be started accidentally.
    return null;
  }

  const nextSchedule = schedules
    .filter(
      (schedule) =>
        Boolean(schedule.plannedDate) &&
        (schedule.status === "planned" || schedule.status === "in_progress"),
    )
    .slice()
    .sort(
      (left, right) =>
        String(left.plannedDate).localeCompare(String(right.plannedDate)) ||
        left.sequenceNumber - right.sequenceNumber ||
        left.id.localeCompare(right.id),
    )[0];

  if (!nextSchedule?.plannedDate) return null;

  return {
    schedule: nextSchedule,
    workout: nextSchedule.workout,
    timing:
      nextSchedule.plannedDate < today
        ? "overdue"
        : nextSchedule.plannedDate === today
          ? "today"
          : "future",
    plannedDate: nextSchedule.plannedDate,
  };
}
