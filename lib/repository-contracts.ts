import type { LiftLogRepository } from "./repository";

/** Feature dependencies are narrow type-only views of the one session repository. */
export type ActiveWorkoutRepository = Pick<LiftLogRepository,
  "reloadActiveSession" | "saveSessionDraft">;
export type CoachingRepository = Pick<LiftLogRepository,
  "loadCoachingWorkspace" | "listCoachAthletes" | "loadCoachedAthleteDetail" |
  "listCoachCompletedHistory" | "listProgramRuns">;
export type SchedulingRepository = Pick<LiftLogRepository,
  "listSchedulableWorkouts" | "listFrequentSchedulableWorkouts" | "scheduleWorkout" |
  "scheduleProgramRunWorkouts" | "loadProgramRunDetail">;
export type ExerciseSearchRepository = Pick<LiftLogRepository, "searchExercises">;
