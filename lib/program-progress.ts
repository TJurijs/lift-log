import type { ScheduledWorkout } from "./domain";

export type ProgramWorkoutProgressState =
  | "unscheduled"
  | "scheduled"
  | "due"
  | "overdue"
  | "completed"
  | "skipped";

export type ProgramRunStatus =
  | "editable"
  | "locked"
  | "scheduled"
  | "in_progress"
  | "needs_attention"
  | "completed";

export type SingleWorkoutStatus = Exclude<ProgramRunStatus, "completed">;

export type SingleWorkoutStatusSummary = {
  status: SingleWorkoutStatus;
  upcomingCount: number;
  nextDate?: string;
  overdueDate?: string;
  lastCompletedDate?: string;
};

export function deriveProgramWorkoutProgressState(
  schedule: Pick<ScheduledWorkout, "plannedDate" | "status"> | undefined,
  today: string,
): ProgramWorkoutProgressState {
  if (!schedule) return "unscheduled";
  if (schedule.status === "completed") return "completed";
  if (schedule.status === "skipped") return "skipped";
  if (!schedule.plannedDate) return "unscheduled";
  if (schedule.plannedDate < today) return "overdue";
  if (schedule.plannedDate === today) return "due";
  return "scheduled";
}

export function deriveProgramRunStatus(
  editable: boolean,
  workoutStates: ProgramWorkoutProgressState[],
): ProgramRunStatus {
  if (editable) return "editable";
  if (
    workoutStates.length > 0 &&
    workoutStates.every((state) => state === "completed")
  ) {
    return "completed";
  }
  if (workoutStates.includes("overdue")) return "needs_attention";
  if (workoutStates.includes("completed")) return "in_progress";
  if (workoutStates.some((state) => ["scheduled", "due"].includes(state))) {
    return "scheduled";
  }
  return "locked";
}

export function programRunStatusLabel(status: ProgramRunStatus) {
  return {
    editable: "Editable",
    locked: "Locked",
    scheduled: "Scheduled",
    in_progress: "In progress",
    needs_attention: "Needs attention",
    completed: "Completed",
  }[status];
}

export function programWorkoutProgressLabel(
  state: ProgramWorkoutProgressState,
) {
  return {
    unscheduled: "not scheduled",
    scheduled: "scheduled in the future",
    due: "due today",
    overdue: "overdue",
    completed: "completed",
    skipped: "skipped",
  }[state];
}

export function deriveSingleWorkoutStatus(
  editable: boolean,
  schedules: Array<Pick<ScheduledWorkout, "plannedDate" | "status">>,
  today: string,
): SingleWorkoutStatusSummary {
  const completedDates = schedules
    .filter(
      (schedule) =>
        schedule.status === "completed" && Boolean(schedule.plannedDate),
    )
    .map((schedule) => schedule.plannedDate as string)
    .sort();
  const base = {
    upcomingCount: 0,
    lastCompletedDate: completedDates.at(-1),
  };
  if (editable) return { ...base, status: "editable" };

  const active = schedules.find((schedule) => schedule.status === "in_progress");
  if (active) {
    return {
      ...base,
      status: "in_progress",
      nextDate: active.plannedDate,
    };
  }

  const overdueDates = schedules
    .filter(
      (schedule) =>
        schedule.status === "planned" &&
        Boolean(schedule.plannedDate) &&
        (schedule.plannedDate as string) < today,
    )
    .map((schedule) => schedule.plannedDate as string)
    .sort();
  if (overdueDates.length) {
    return {
      ...base,
      status: "needs_attention",
      overdueDate: overdueDates[0],
    };
  }

  const upcomingDates = schedules
    .filter(
      (schedule) =>
        schedule.status === "planned" &&
        Boolean(schedule.plannedDate) &&
        (schedule.plannedDate as string) >= today,
    )
    .map((schedule) => schedule.plannedDate as string)
    .sort();
  if (upcomingDates.length) {
    return {
      ...base,
      status: "scheduled",
      upcomingCount: upcomingDates.length,
      nextDate: upcomingDates[0],
    };
  }

  return { ...base, status: "locked" };
}
