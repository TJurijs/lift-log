export type ViewName =
  "today" | "program" | "calendar" | "exercises" | "coaching";

export type ContentOrigin = "self" | "coach" | "library";
export type TrainingContentType = "program" | "quick_workout";
export type ProgramVersionLifecycle = "draft" | "published" | "superseded";
export type OccurrenceStatus = "planned" | "in_progress" | "completed" | "skipped";
export type WorkoutSessionStatus = "in_progress" | "completed" | "abandoned";

export interface OwnProfile {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  liftlogId: string;
  weekStartsOnSunday: boolean;
  weightUnit: "kg" | "lb";
  distanceUnit: "km" | "mi";
}

export type ExerciseScope = "global" | "personal";
export type ExerciseDiscipline = "weightlifting" | "gym" | "functional";
export type EntryMode = "none" | "sets" | "result" | "intervals";
export type TrackingField =
  "reps" | "load" | "duration" | "distance" | "rounds" | "heartRate" | "rpe";

const defaultTrackingFieldsByMode: Record<
  EntryMode,
  readonly TrackingField[]
> = {
  none: [],
  sets: ["reps", "load", "rpe"],
  result: ["duration", "distance", "rpe"],
  intervals: ["rounds", "duration", "rpe"],
};

const compatibleTrackingFieldsByMode: Record<
  EntryMode,
  readonly TrackingField[]
> = {
  none: [],
  sets: ["reps", "load", "rpe"],
  result: ["duration", "distance", "load", "heartRate", "rpe"],
  intervals: ["rounds", "duration", "distance", "heartRate", "rpe"],
};

export function trackingFieldsForMode(
  mode: EntryMode,
  requested?: readonly TrackingField[],
): TrackingField[] {
  const defaults = defaultTrackingFieldsByMode[mode];
  if (requested === undefined) return [...defaults];
  const selected = compatibleTrackingFieldsByMode[mode].filter((field) =>
    requested.includes(field),
  );
  return selected.length || mode === "none" ? selected : [...defaults];
}

export interface Exercise {
  id: string;
  name: string;
  category: string;
  discipline?: ExerciseDiscipline;
  tags?: string[];
  cue: string;
  scope: ExerciseScope;
  ownerName?: string;
  defaultMode: EntryMode;
  defaultFields: TrackingField[];
}

export interface PrescriptionEntry {
  reps?: string;
  loadKg?: number;
  durationMinutes?: number;
  distance?: number;
  distanceUnit?: "m" | "km";
  rounds?: number;
  workSeconds?: number;
  restSeconds?: number;
  targetRpe?: string;
}

export interface Prescription {
  sets?: number;
  reps?: string;
  loadKg?: number;
  durationMinutes?: number;
  distance?: number;
  distanceUnit?: "m" | "km";
  rounds?: number;
  workSeconds?: number;
  restSeconds?: number;
  targetRpe?: string;
  targetText?: string;
  entries?: PrescriptionEntry[];
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
  kind?: "warmup" | "main" | "conditioning" | "cooldown" | "custom";
  items: WorkoutItem[];
}

export interface PlannedWorkout {
  id: string;
  programVersionId?: string;
  scheduledWorkoutId?: string;
  plannedDate?: string;
  title: string;
  dayLabel: string;
  durationMinutes: number;
  sections: WorkoutSection[];
}

export interface ScheduledWorkout {
  id: string;
  assignmentId?: string;
  programId: string;
  programTitle: string;
  programVersionId: string;
  workoutId: string;
  workoutTitle: string;
  slotLabel: string;
  plannedDate?: string;
  sequenceNumber: number;
  status: OccurrenceStatus;
  sourceType?: Program["sourceType"];
  sourceLabel?: string;
  createdByName?: string;
  workout: PlannedWorkout;
  /** False for calendar/list rows until the workout is opened or started. */
  detailsLoaded?: boolean;
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
  versionStatus: ProgramVersionLifecycle;
  effectiveFrom?: string;
  title: string;
  description: string;
  phase: string;
  activeWeek: number;
  weeks: ProgramWeek[];
  ownerName: string;
  createdById: string;
  createdByName: string;
  sourceType: ContentOrigin;
  sourceLabel: string;
  templateId?: string;
  /** Present when immutable published content is assigned without cloning. */
  assignmentId?: string;
  /** Present after an assigned program is explicitly forked for customization. */
  customizedProgramId?: string;
  /** A quick workout uses the same editable workout tree without week planning. */
  contentType?: TrainingContentType;
  /** Present for catalog rows, which intentionally defer the full workout tree. */
  weekCount?: number;
  /** Present for catalog rows, which intentionally defer the full workout tree. */
  workoutCount?: number;
  /** Workout ids are enough to render scheduling progress without loading exercises. */
  workoutIds?: string[];
  /** False means this is a lightweight catalog row, not an editable program tree. */
  detailsLoaded?: boolean;
}

export interface ProgramAssignment {
  athleteId: string;
  /** Stable assignment identity. Shared immutable content is not cloned. */
  assignmentId: string;
  /** Source/customized content program identity, when returned by the mutation. */
  programId: string;
  created: boolean;
}

export interface CursorPage<TItem, TCursor> {
  items: TItem[];
  /** Cursor for the next keyset page. Missing when this page is exhausted. */
  nextCursor?: TCursor;
  hasMore: boolean;
}

export interface ProgramCursor {
  createdAt: string;
  id: string;
}

export interface SchedulableWorkoutCursor {
  programTitle: string;
  weekIndex: number;
  workoutPosition: number;
  id: string;
}

export interface SchedulableWorkoutCandidate {
  kind: "program" | "assignment";
  programId: string;
  assignmentId?: string;
  programVersionId: string;
  workoutId: string;
  programTitle: string;
  workoutTitle: string;
  contentType: TrainingContentType;
  isQuickWorkout: boolean;
  weekIndex: number;
  weekLabel: string;
  workoutPosition: number;
  scheduleLabel: string;
  estimatedMinutes: number;
  latestOccurrence?: {
    id: string;
    plannedDate?: string;
    status: OccurrenceStatus;
    sequenceNumber: number;
  };
}

export interface CalendarCursor {
  plannedDate: string;
  id: string;
}

export interface HistoryCursor {
  startedAt: string;
  id: string;
}

export interface ExerciseCursor {
  name: string;
  id: string;
}

export interface CoachAthleteCursor {
  displayName: string;
  id: string;
}

export interface ProgramTemplate {
  id: string;
  title: string;
  description: string;
  weekCount: number;
  sessionsPerWeek: number;
  sourceLabel: string;
}

export interface CompletedSession {
  id: string;
  programVersionId?: string;
  workoutId?: string;
  workoutTitle: string;
  date: string;
  durationMinutes: number;
  rpe: number;
  note?: string;
}

export interface CompletedSessionEntry {
  position: number;
  reps?: number;
  loadKg?: number;
  durationMinutes?: number;
  distanceKm?: number;
  rounds?: number;
  heartRate?: number;
  rpe?: number;
  note?: string;
}

export interface CompletedSessionItemResult {
  id: string;
  title: string;
  cue: string;
  mode: EntryMode;
  fields: TrackingField[];
  position: number;
  note?: string;
  entries: CompletedSessionEntry[];
}

export interface CompletedSessionDetail extends CompletedSession {
  items: CompletedSessionItemResult[];
}

export type CoachAssignedProgramStatus =
  "awaiting_schedule" | "scheduled" | "in_progress" | "completed";

export interface CoachAssignedProgramSummary {
  id: string;
  programId: string;
  assignmentId?: string;
  versionId: string;
  title: string;
  assignedAt: string;
  status: CoachAssignedProgramStatus;
  totalWorkouts: number;
  scheduledWorkouts: number;
  scheduledPercent: number;
  completedWorkouts: number;
  completionPercent: number;
  nextWorkout?: {
    id: string;
    title: string;
    date: string;
  };
}

export interface CoachAgendaEntry {
  id: string;
  assignmentId?: string;
  kind: "upcoming" | "completed";
  status: "planned" | "overdue" | "in_progress" | "completed";
  programId: string;
  programVersionId: string;
  programTitle: string;
  workoutId?: string;
  workoutTitle: string;
  date: string;
  rpe?: number;
  scheduleId?: string;
  sessionId?: string;
}

export interface AthleteSummary {
  id: string;
  relationshipId?: string;
  name: string;
  initials: string;
  assignedProgramCount?: number;
  detailsLoaded?: boolean;
  assignedPrograms: CoachAssignedProgramSummary[];
  agenda: CoachAgendaEntry[];
}

export interface CoachConnection {
  relationshipId: string;
  coachId: string;
  name: string;
  initials: string;
  connectedSince: string;
}

export interface CoachInviteTarget {
  registered: boolean;
  identifierType: "email" | "id";
  displayName: string;
  liftlogId?: string;
}

export interface PendingCoachInvite {
  id: string;
  athleteId: string;
  athleteName: string;
  athleteInitials: string;
  createdAt: string;
  expiresAt: string;
}

export interface OutgoingCoachInvite {
  id: string;
  coachId: string;
  coachName: string;
  coachInitials: string;
  createdAt: string;
  expiresAt: string;
}

export interface CoachInviteReceipt {
  id: string;
  targetProfileId: string;
  targetName: string;
  expiresAt: string;
}

export interface SessionSetValue {
  reps: string;
  load: string;
  rpe: string;
}

export interface ActiveSession {
  id: string;
  /** Last server-confirmed atomic draft revision. */
  draftRevision: number;
  /** Server-issued identity for the last confirmed idempotent draft write. */
  draftWriteToken?: string;
  draftSavedAt?: string;
  assignmentId?: string;
  workoutId: string;
  programVersionId: string;
  scheduledWorkoutId?: string;
  itemLogIds: Record<string, string>;
  setLogs: Record<string, SessionSetValue[]>;
  resultLogs: Record<string, Record<string, string>>;
  sessionRpe: string;
  sessionNote: string;
}

export interface WorkspaceData {
  profile: OwnProfile;
  /** Coarse bootstrap capabilities; detailed coaching rows remain lazy. */
  coachingAccess?: {
    hasCoach: boolean;
    coachedAthleteCount: number;
    pendingInviteCount: number;
  };
  programCatalog: Program[];
  schedulableProgramIds: string[];
  schedulablePrograms: Program[];
  draftProgram: Program | null;
  activeProgram: Program | null;
  scheduledWorkouts: ScheduledWorkout[];
  globalExercises: Exercise[];
  personalExercises: Exercise[];
  completedSessions: CompletedSession[];
  coachConnections: CoachConnection[];
  coachedAthletes: AthleteSummary[];
  pendingCoachInvites: PendingCoachInvite[];
  outgoingCoachInvites: OutgoingCoachInvite[];
  activeSession: ActiveSession | null;
}

export type CoachingWorkspaceData = Pick<
  WorkspaceData,
  | "coachConnections"
  | "coachedAthletes"
  | "pendingCoachInvites"
  | "outgoingCoachInvites"
> & {
  /** Keyset cursor for the next coached-athlete summary page. */
  coachAthleteCursor?: CoachAthleteCursor;
};

export type CalendarWorkspaceData = Pick<
  WorkspaceData,
  "scheduledWorkouts" | "completedSessions"
>;

export type ExerciseWorkspaceData = Pick<
  WorkspaceData,
  "globalExercises" | "personalExercises"
>;

export type ProgramWorkspaceData = Pick<
  WorkspaceData,
  | "programCatalog"
  | "schedulableProgramIds"
  | "schedulablePrograms"
  | "draftProgram"
  | "activeProgram"
>;
