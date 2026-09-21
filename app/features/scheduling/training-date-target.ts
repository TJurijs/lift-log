import type { Program, ProgramRunDetail, ProgramRunSummary, ScheduledWorkout } from "../../../lib/domain";
import { programWorkouts } from "../../../lib/program-tree";

export type TrainingDateTarget =
  | { kind: "source"; program: Program }
  | { kind: "run"; run: ProgramRunSummary }
  | { kind: "occurrence"; schedule: ScheduledWorkout };

/** A date editor can preview a new workout without creating any database records. */
export function sourceDateDetail(program: Program): ProgramRunDetail {
  const workouts = programWorkouts(program);
  return {
    id: program.id, programId: program.id, programVersionId: program.versionId,
    athleteId: program.athleteId, createdById: program.createdById ?? program.athleteId,
    title: program.title, contentType: program.contentType ?? "program", status: "not_started",
    totalWorkouts: program.workoutCount ?? workouts.length, completedWorkouts: 0,
    scheduledWorkouts: 0, completionPercent: 0, createdAt: "",
    workouts: workouts.map((workout, position) => ({
      id: workout.id, workoutId: workout.id, runId: program.id, title: workout.title,
      position, estimatedMinutes: workout.durationMinutes, status: "unscheduled",
      prescriptionOverrides: {}, canEdit: true,
    })),
  };
}

export function occurrenceDateDetail(schedule: ScheduledWorkout, viewerId: string): ProgramRunDetail {
  return {
    id: schedule.id, programId: schedule.programId, programVersionId: schedule.programVersionId,
    athleteId: viewerId, createdById: viewerId, title: schedule.workoutTitle, contentType: "quick_workout",
    status: "not_started", totalWorkouts: 1, completedWorkouts: 0,
    scheduledWorkouts: schedule.plannedDate ? 1 : 0, completionPercent: 0, createdAt: "",
    workouts: [{ id: schedule.id, runId: schedule.id, workoutId: schedule.workoutId,
      title: schedule.workoutTitle, position: 0, estimatedMinutes: schedule.workout.durationMinutes,
      status: schedule.plannedDate ? "scheduled" : "unscheduled", plannedDate: schedule.plannedDate,
      scheduledWorkoutId: schedule.id, prescriptionOverrides: {} }],
  };
}
