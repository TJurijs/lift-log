export type ViewName = "today" | "program" | "calendar" | "exercises" | "coaching";

export type ExerciseScope = "global" | "personal";
export type EntryMode = "none" | "sets" | "result" | "intervals";
export type TrackingField =
  | "reps"
  | "load"
  | "duration"
  | "distance"
  | "rounds"
  | "heartRate"
  | "rpe";

export interface Exercise {
  id: string;
  name: string;
  category: string;
  cue: string;
  scope: ExerciseScope;
  ownerName?: string;
  defaultMode: EntryMode;
  defaultFields: TrackingField[];
}

export interface Prescription {
  sets?: number;
  reps?: string;
  durationMinutes?: number;
  distance?: number;
  distanceUnit?: "m" | "km";
  rounds?: number;
  workSeconds?: number;
  restSeconds?: number;
  targetRpe?: string;
}

export interface WorkoutItem {
  id: string;
  exerciseId?: string;
  title: string;
  cue: string;
  mode: EntryMode;
  fields: TrackingField[];
  prescription: Prescription;
}

export interface WorkoutSection {
  id: string;
  title: string;
  items: WorkoutItem[];
}

export interface PlannedWorkout {
  id: string;
  scheduledWorkoutId?: string;
  plannedDate?: string;
  title: string;
  dayLabel: string;
  durationMinutes: number;
  sections: WorkoutSection[];
}

export interface ProgramWeek {
  id: string;
  index: number;
  label: string;
  workouts: PlannedWorkout[];
}

export interface Program {
  id: string;
  athleteId: string;
  versionId: string;
  versionStatus: "draft" | "published" | "superseded";
  effectiveFrom?: string;
  title: string;
  description: string;
  mode: "repeating" | "fixed";
  phase: string;
  activeWeek: number;
  weeks: ProgramWeek[];
  ownerName: string;
  createdByName: string;
}

export interface CompletedSession {
  id: string;
  workoutId?: string;
  workoutTitle: string;
  date: string;
  durationMinutes: number;
  rpe: number;
  note?: string;
}

export interface AthleteSummary {
  id: string;
  relationshipId?: string;
  name: string;
  initials: string;
  programTitle: string;
  completedThisWeek: number;
  plannedThisWeek: number;
  latestRpe: number | null;
  lastTrainingLabel: string;
  trend: "steady" | "watch" | "strong";
}

export interface CoachConnection {
  relationshipId: string;
  coachId: string;
  name: string;
  initials: string;
  connectedSince: string;
}

export interface SessionSetValue {
  reps: string;
  load: string;
  rpe: string;
}

export interface ActiveSession {
  id: string;
  workoutId: string;
  scheduledWorkoutId?: string;
  itemLogIds: Record<string, string>;
  setLogs: Record<string, SessionSetValue[]>;
  resultLogs: Record<string, Record<string, string>>;
  sessionRpe: string;
  sessionNote: string;
}

export interface WorkspaceData {
  draftProgram: Program;
  activeProgram: Program;
  globalExercises: Exercise[];
  personalExercises: Exercise[];
  completedSessions: CompletedSession[];
  coachConnection: CoachConnection | null;
  coachedAthletes: AthleteSummary[];
  activeSession: ActiveSession | null;
}
