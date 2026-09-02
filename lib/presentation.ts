import type { Exercise, Program, ScheduledWorkout } from "./domain";

export type EntitySource = {
  kind: "library" | "self" | "coach" | "unknown";
  creatorName?: string;
};

export type DisplayStatus =
  | "editable"
  | "locked"
  | "in_schedule"
  | "planned"
  | "in_progress"
  | "completed"
  | "skipped"
  | "pending"
  | "connected";

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function getInitials(name?: string, fallback = "LL") {
  const initials = (name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("");
  return initials || fallback;
}

export function sourceFromProgram(program: Pick<
  Program,
  "sourceType" | "createdByName"
>): EntitySource {
  return {
    kind: program.sourceType,
    creatorName: program.createdByName,
  };
}

export function sourceFromScheduledWorkout(
  schedule: Pick<ScheduledWorkout, "sourceType" | "createdByName">,
): EntitySource {
  return {
    kind: schedule.sourceType ?? "unknown",
    creatorName: schedule.createdByName,
  };
}

export function sourceFromExercise(
  exercise: Pick<Exercise, "scope" | "ownerName">,
): EntitySource {
  return {
    kind: exercise.scope === "global" ? "library" : "self",
    creatorName: exercise.ownerName,
  };
}

export function formatWorkoutCount(count: number) {
  return `${count} ${count === 1 ? "workout" : "workouts"}`;
}

export function formatItemCount(count: number) {
  return `${count} ${count === 1 ? "item" : "items"}`;
}

export function formatDuration(minutes: number) {
  return `~ ${minutes} min`;
}
