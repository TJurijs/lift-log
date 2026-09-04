import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ActiveSession,
  AthleteSummary,
  CalendarCursor,
  CalendarWorkspaceData,
  CoachAthleteCursor,
  CoachAgendaEntry,
  CoachAssignedProgramStatus,
  CoachAssignedProgramSummary,
  CoachConnection,
  CoachingWorkspaceData,
  CoachInviteReceipt,
  CoachInviteTarget,
  CompletedSession,
  CompletedSessionDetail,
  CursorPage,
  EntryMode,
  Exercise,
  ExerciseCursor,
  ExerciseWorkspaceData,
  FrequentSchedulableWorkoutCandidate,
  OwnProfile,
  OutgoingCoachInvite,
  PendingCoachInvite,
  PlannedWorkout,
  PrescriptionEntry,
  Prescription,
  Program,
  ProgramCursor,
  ProgramRunDetail,
  ProgramRunCursor,
  ProgramRunMutation,
  ProgramRunStatus,
  ProgramRunSummary,
  ProgramRunWorkout,
  ProgramRunWorkoutDate,
  ProgramRunWorkoutStatus,
  ProgramWorkspaceData,
  ScheduledWorkout,
  SchedulableWorkoutCandidate,
  SchedulableWorkoutCursor,
  SessionSetValue,
  TrackingField,
  HistoryCursor,
  WorkoutItem,
  WorkoutSection,
  WorkspaceData,
} from "./domain";
import { trackingFieldsForMode } from "./domain";
import { recordClientPerformance } from "./performance";
import { implicitProgramWeek } from "./program-tree";
import { BoundedQueryCache } from "./query-cache";
import { collectAllBatches, collectAllPages, collectCursorPages } from "./pagination";
import { activeWeekForDate, localDateOnly } from "./date-only";

const REPOSITORY_QUERY_CACHE_MAX_SERIALIZED_BYTES = 12 * 1024 * 1024;

type NumericValue = number | string | null;

interface ExerciseRow {
  id: string;
  scope: "global" | "personal";
  owner_id: string | null;
  name: string;
  category: string;
  discipline?: "weightlifting" | "gym" | "functional" | null;
  tags?: string[] | null;
  source_provider?: string | null;
  source_external_id?: string | null;
  source_url?: string | null;
  video_url?: string | null;
  cue: string;
  default_entry_mode: EntryMode;
  default_tracking_fields: TrackingField[];
}

interface VersionRow {
  id: string;
  program_id: string;
  version_number: number;
  status: "draft" | "published" | "superseded";
  effective_from: string | null;
  title: string;
  description: string;
}

interface PrescriptionRow {
  id: string;
  workout_item_id: string;
  position: number;
  reps_min: NumericValue;
  reps_max: NumericValue;
  load_kg: NumericValue;
  duration_seconds: number | null;
  distance_metres: NumericValue;
  rounds: number | null;
  work_seconds: number | null;
  rest_seconds: number | null;
  target_rpe_min: NumericValue;
  target_rpe_max: NumericValue;
  target_text: string | null;
}

interface SessionRow {
  id: string;
  draft_revision?: NumericValue;
  program_run_id?: string | null;
  program_run_workout_id?: string | null;
  program_version_id: string | null;
  workout_id: string | null;
  scheduled_workout_id: string | null;
  workout_title: string;
  started_at: string;
  completed_at: string | null;
  completed_for_date: string | null;
  session_rpe: NumericValue;
}

export interface SessionDraftEntryPayload {
  position: number;
  reps: number | null;
  loadKg: number | null;
  durationSeconds: number | null;
  distanceMetres: number | null;
  rounds: number | null;
  heartRate: number | null;
  rpe: number | null;
}

export interface SessionDraftPayload {
  sessionRpe: number | null;
  sessionNote: string;
  items: Array<{
    itemLogId: string;
    entries: SessionDraftEntryPayload[];
  }>;
}

interface SessionItemRow {
  id: string;
  workout_session_id: string;
  source_workout_item_id: string | null;
  entry_mode: EntryMode;
  position: number;
}

interface CompletedSessionItemRow extends SessionItemRow {
  snapshot_name: string;
  snapshot_category: string;
  snapshot_video_url: string | null;
  snapshot_cue: string;
  tracking_fields: TrackingField[];
}

interface SessionEntryRow {
  id: string;
  session_item_log_id: string;
  position: number;
  reps: NumericValue;
  load_kg: NumericValue;
  duration_seconds: number | null;
  distance_metres: NumericValue;
  rounds: number | null;
  heart_rate: number | null;
  rpe: NumericValue;
}

interface OwnSessionNotes {
  sessionNote: string;
  itemNotes: Record<string, string>;
  entryNotes: Record<string, string>;
}

export interface CreateExerciseInput {
  name: string;
  category: string;
  discipline?: Exercise["discipline"];
  tags?: string[];
  sourceProvider?: string;
  sourceExternalId?: string;
  sourceUrl?: string;
  videoUrl?: string;
  mode: EntryMode;
  fields?: TrackingField[];
  cue: string;
}

export interface ProgramPageOptions {
  limit?: number;
  cursor?: ProgramCursor;
}

export interface ProgramRunPageOptions {
  limit?: number;
  cursor?: ProgramRunCursor;
  creatorScope?: "all" | "self" | "coach";
}

export interface CalendarPageOptions {
  limit?: number;
  cursor?: CalendarCursor;
}

export interface SchedulableWorkoutPageOptions {
  limit?: number;
  cursor?: SchedulableWorkoutCursor;
}

export interface HistoryPageOptions {
  limit?: number;
  cursor?: HistoryCursor;
}

export interface ExerciseSearchOptions {
  query?: string;
  scope?: "all" | Exercise["scope"];
  disciplines?: NonNullable<Exercise["discipline"]>[];
  categories?: string[];
  modes?: EntryMode[];
  tracking?: TrackingField[];
  limit?: number;
  cursor?: ExerciseCursor;
}

export interface CoachAthletePageOptions {
  limit?: number;
  cursor?: CoachAthleteCursor;
}

function fail(context: string, error: { message: string } | null): never {
  throw new Error(error ? `${context}: ${error.message}` : context);
}

export class SessionRevisionConflictError extends Error {
  constructor(
    message = "This workout keeps changing in another tab or device. Your entries are safe here; close the other copy and try again.",
  ) {
    super(message);
    this.name = "SessionRevisionConflictError";
  }
}

export class SessionDraftAmbiguousWriteError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SessionDraftAmbiguousWriteError";
  }
}

export function isAmbiguousSessionDraftError(error: unknown) {
  if (error instanceof SessionDraftAmbiguousWriteError) return true;
  return (
    error instanceof Error &&
    /failed to fetch|fetch failed|network|timed? out|connection|load failed|abort(?:ed|error)?|\bjwt\b|authentication required/i.test(
      error.message,
    )
  );
}

type JsonRecord = Record<string, unknown>;

function jsonRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function firstJsonRecord(value: unknown): JsonRecord | null {
  if (Array.isArray(value)) return jsonRecord(value[0]);
  return jsonRecord(value);
}

function jsonRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const record = jsonRecord(item);
        return record ? [record] : [];
      })
    : [];
}

function jsonField(record: JsonRecord, ...keys: string[]) {
  for (const key of keys) {
    if (Object.hasOwn(record, key)) return record[key];
  }
  return undefined;
}

function jsonString(record: JsonRecord, ...keys: string[]) {
  const value = jsonField(record, ...keys);
  return typeof value === "string" ? value : undefined;
}

function jsonNullableString(record: JsonRecord, ...keys: string[]) {
  const value = jsonField(record, ...keys);
  return typeof value === "string" ? value : null;
}

function jsonNumeric(record: JsonRecord, ...keys: string[]): NumericValue {
  const value = jsonField(record, ...keys);
  return typeof value === "number" || typeof value === "string" ? value : null;
}

function jsonInteger(record: JsonRecord, ...keys: string[]) {
  const value = numberValue(jsonNumeric(record, ...keys));
  return value === null ? undefined : Math.trunc(value);
}

function jsonStringMap(value: unknown): Record<string, string> {
  const record = jsonRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function jsonStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function jsonBoolean(record: JsonRecord, ...keys: string[]) {
  const value = jsonField(record, ...keys);
  return typeof value === "boolean" ? value : undefined;
}

function scheduledWorkoutSourceType(
  row: JsonRecord,
  assignmentId: string | undefined,
  viewerId: string,
): ScheduledWorkout["sourceType"] {
  const explicitSource = jsonString(row, "sourceType", "source_type");
  if (
    explicitSource === "self" ||
    explicitSource === "coach" ||
    explicitSource === "library"
  ) {
    return explicitSource;
  }
  if (assignmentId) return "coach";

  const scheduledById =
    jsonNullableString(row, "scheduledById", "scheduled_by_id") ?? undefined;
  const athleteId =
    jsonNullableString(row, "athleteId", "athlete_id") ?? viewerId;
  return scheduledById && scheduledById !== athleteId ? "coach" : "self";
}

function parseScheduledWorkoutSummary(
  value: unknown,
  viewerId: string,
): ScheduledWorkout | null {
  const row = jsonRecord(value);
  if (!row) return null;
  const id = jsonString(row, "id");
  const programId = jsonString(row, "program_id", "programId");
  const versionId = jsonString(row, "program_version_id", "programVersionId");
  const programTitle = jsonString(row, "program_title", "programTitle");
  const workoutId = jsonString(row, "workout_id", "workoutId");
  const workoutTitle = jsonString(row, "workout_title", "workoutTitle");
  const plannedDate = jsonString(row, "planned_date", "plannedDate");
  const status = jsonString(row, "status");
  if (
    !id ||
    !programId ||
    !versionId ||
    !programTitle ||
    !workoutId ||
    !workoutTitle ||
    !plannedDate ||
    (status !== "planned" &&
      status !== "in_progress" &&
      status !== "completed" &&
      status !== "skipped")
  ) {
    return null;
  }
  const sequenceNumber =
    jsonInteger(row, "sequence_number", "sequenceNumber") ?? 0;
  const estimatedMinutes =
    jsonInteger(row, "estimated_minutes", "estimatedMinutes") ?? 0;
  const assignmentId =
    jsonNullableString(row, "assignment_id", "assignmentId") ?? undefined;
  return {
    id,
    assignmentId,
    programRunId:
      jsonNullableString(row, "program_run_id", "programRunId") ?? undefined,
    programRunWorkoutId:
      jsonNullableString(
        row,
        "program_run_workout_id",
        "programRunWorkoutId",
      ) ?? undefined,
    programId,
    programTitle,
    programVersionId: versionId,
    workoutId,
    workoutTitle,
    slotLabel: `${programTitle} · ${workoutTitle}`,
    plannedDate,
    sequenceNumber,
    status,
    sourceType: scheduledWorkoutSourceType(row, assignmentId, viewerId),
    workout: {
      id: workoutId,
      programVersionId: versionId,
      scheduledWorkoutId: id,
      plannedDate,
      title: workoutTitle,
      dayLabel: `Session ${sequenceNumber || 1}`,
      durationMinutes: estimatedMinutes,
      sections: [],
    },
    detailsLoaded: false,
  };
}

function parseOwnSessionNotes(value: unknown): OwnSessionNotes {
  const record = firstJsonRecord(value);
  return {
    sessionNote: record
      ? (jsonString(record, "sessionNote", "session_note") ?? "")
      : "",
    itemNotes: record
      ? jsonStringMap(jsonField(record, "itemNotes", "item_notes"))
      : {},
    entryNotes: record
      ? jsonStringMap(jsonField(record, "entryNotes", "entry_notes"))
      : {},
  };
}

function parseSessionRow(value: unknown): SessionRow | null {
  const row = jsonRecord(value);
  if (!row) return null;
  const id = jsonString(row, "id");
  const workoutTitle = jsonString(row, "workout_title", "workoutTitle");
  const startedAt = jsonString(row, "started_at", "startedAt");
  if (!id || !workoutTitle || !startedAt) return null;
  return {
    id,
    program_run_id: jsonNullableString(
      row,
      "program_run_id",
      "programRunId",
    ),
    program_run_workout_id: jsonNullableString(
      row,
      "program_run_workout_id",
      "programRunWorkoutId",
    ),
    program_version_id: jsonNullableString(
      row,
      "program_version_id",
      "programVersionId",
    ),
    workout_id: jsonNullableString(row, "workout_id", "workoutId"),
    scheduled_workout_id: jsonNullableString(
      row,
      "scheduled_workout_id",
      "scheduledWorkoutId",
    ),
    workout_title: workoutTitle,
    started_at: startedAt,
    completed_at: jsonNullableString(row, "completed_at", "completedAt"),
    completed_for_date: jsonNullableString(
      row,
      "completed_for_date",
      "completedForDate",
    ),
    session_rpe: jsonNumeric(row, "session_rpe", "sessionRpe"),
  };
}

function parseSchedulableWorkoutCandidate(
  row: JsonRecord,
): SchedulableWorkoutCandidate | null {
  const kind = jsonString(row, "kind");
  const programId = jsonString(row, "program_id", "programId");
  const versionId = jsonString(
    row,
    "program_version_id",
    "programVersionId",
  );
  const workoutId = jsonString(row, "workout_id", "workoutId");
  const programTitle = jsonString(row, "program_title", "programTitle");
  const workoutTitle = jsonString(row, "workout_title", "workoutTitle");
  if (
    (kind !== "program" && kind !== "assignment") ||
    !programId ||
    !versionId ||
    !workoutId ||
    !programTitle ||
    !workoutTitle
  ) {
    return null;
  }
  const latestStatus = jsonNullableString(
    row,
    "latest_status",
    "latestStatus",
  );
  const latestId = jsonNullableString(
    row,
    "latest_occurrence_id",
    "latestOccurrenceId",
  );
  const normalizedLatestStatus: ScheduledWorkout["status"] | undefined =
    latestStatus === "planned" ||
    latestStatus === "in_progress" ||
    latestStatus === "completed" ||
    latestStatus === "skipped"
      ? latestStatus
      : undefined;
  const latestOccurrence =
    latestId && normalizedLatestStatus
      ? {
          id: latestId,
          plannedDate:
            jsonNullableString(
              row,
              "latest_planned_date",
              "latestPlannedDate",
            ) ?? undefined,
          status: normalizedLatestStatus,
          sequenceNumber:
            jsonInteger(
              row,
              "latest_sequence_number",
              "latestSequenceNumber",
            ) ?? 0,
        }
      : undefined;
  const contentType =
    jsonString(row, "content_type", "contentType") === "quick_workout"
      ? "quick_workout"
      : "program";
  return {
    kind,
    programId,
    assignmentId:
      jsonNullableString(row, "assignment_id", "assignmentId") ?? undefined,
    programVersionId: versionId,
    workoutId,
    programTitle,
    workoutTitle,
    contentType,
    isQuickWorkout:
      jsonBoolean(row, "is_quick_workout", "isQuickWorkout") ??
      contentType === "quick_workout",
    weekIndex: jsonInteger(row, "week_index", "weekIndex") ?? 1,
    weekLabel: jsonString(row, "week_label", "weekLabel") ?? "Week 1",
    workoutPosition:
      jsonInteger(row, "workout_position", "workoutPosition") ?? 0,
    scheduleLabel:
      jsonString(row, "schedule_label", "scheduleLabel") ?? "",
    estimatedMinutes:
      jsonInteger(row, "estimated_minutes", "estimatedMinutes") ?? 45,
    latestOccurrence,
  };
}

const programRunStatuses = new Set<ProgramRunStatus>([
  "not_started",
  "in_progress",
  "completed",
  "ended",
]);
const programRunWorkoutStatuses = new Set<ProgramRunWorkoutStatus>([
  "unscheduled",
  "scheduled",
  "in_progress",
  "completed",
  "skipped",
  "cancelled",
]);

function parseProgramRunWorkout(value: unknown): ProgramRunWorkout | null {
  const row = jsonRecord(value);
  if (!row) return null;
  const id = jsonString(row, "id");
  const runId = jsonString(row, "runId", "program_run_id");
  const workoutId = jsonString(row, "workoutId", "workout_id");
  const title = jsonString(row, "title", "workout_title");
  const status = jsonString(row, "status");
  if (
    !id ||
    !runId ||
    !workoutId ||
    !title ||
    !status ||
    !programRunWorkoutStatuses.has(status as ProgramRunWorkoutStatus)
  ) return null;
  return {
    id,
    runId,
    workoutId,
    title,
    position: jsonInteger(row, "position") ?? 0,
    estimatedMinutes:
      jsonInteger(row, "estimatedMinutes", "estimated_minutes") ?? 0,
    plannedDate:
      jsonNullableString(row, "plannedDate", "planned_date") ?? undefined,
    status: status as ProgramRunWorkoutStatus,
    scheduledWorkoutId:
      jsonNullableString(
        row,
        "scheduledWorkoutId",
        "scheduled_workout_id",
      ) ?? undefined,
    sessionId:
      jsonNullableString(row, "sessionId", "session_id") ?? undefined,
    completedAt:
      jsonNullableString(row, "completedAt", "completed_at") ?? undefined,
    completedForDate:
      jsonNullableString(
        row,
        "completedForDate",
        "completed_for_date",
      ) ?? undefined,
    sessionRpe:
      numberValue(jsonNumeric(row, "sessionRpe", "session_rpe")) ?? undefined,
    prescriptionOverrides:
      jsonRecord(
        jsonField(row, "prescriptionOverrides", "prescription_overrides"),
      ) ?? {},
  };
}

function parseProgramRunSummary(value: unknown): ProgramRunSummary | null {
  const row = jsonRecord(value);
  if (!row) return null;
  const id = jsonString(row, "id", "runId", "run_id");
  const athleteId = jsonString(row, "athleteId", "athlete_id");
  const createdById = jsonString(row, "createdById", "created_by_id");
  const programId = jsonString(row, "programId", "program_id");
  const programVersionId = jsonString(
    row,
    "programVersionId",
    "program_version_id",
  );
  const title = jsonString(row, "title");
  const contentType =
    jsonString(row, "contentType", "content_type") === "quick_workout"
      ? "quick_workout"
      : "program";
  const status = jsonString(row, "status");
  const createdAt = jsonString(row, "createdAt", "created_at");
  if (
    !id ||
    !athleteId ||
    !createdById ||
    !programId ||
    !programVersionId ||
    !title ||
    !status ||
    !createdAt ||
    !programRunStatuses.has(status as ProgramRunStatus)
  ) return null;

  const nestedNext = jsonRecord(jsonField(row, "nextWorkout", "next_workout"));
  const nextId = nestedNext
    ? jsonString(nestedNext, "id")
    : jsonNullableString(row, "nextWorkoutId", "next_workout_id") ?? undefined;
  const nextTitle = nestedNext
    ? jsonString(nestedNext, "title", "workoutTitle", "workout_title")
    : jsonNullableString(row, "nextWorkoutTitle", "next_workout_title") ??
      undefined;
  const nextStatus = nestedNext
    ? jsonString(nestedNext, "status")
    : jsonNullableString(row, "nextWorkoutStatus", "next_workout_status") ??
      undefined;
  const nextPlannedDate = nestedNext
    ? jsonNullableString(nestedNext, "plannedDate", "planned_date") ?? undefined
    : jsonNullableString(row, "nextWorkoutDate", "next_workout_date") ??
      undefined;

  return {
    id,
    athleteId,
    createdById,
    programId,
    programVersionId,
    title,
    contentType,
    status: status as ProgramRunStatus,
    totalWorkouts: jsonInteger(row, "totalWorkouts", "total_workouts") ?? 0,
    scheduledWorkouts:
      jsonInteger(row, "scheduledWorkouts", "scheduled_workouts") ?? 0,
    completedWorkouts:
      jsonInteger(row, "completedWorkouts", "completed_workouts") ?? 0,
    completionPercent:
      jsonInteger(row, "completionPercent", "completion_percent") ?? 0,
    ...(nextId && nextTitle && nextStatus &&
    programRunWorkoutStatuses.has(nextStatus as ProgramRunWorkoutStatus)
      ? {
          nextWorkout: {
            id: nextId,
            title: nextTitle,
            ...(nextPlannedDate ? { plannedDate: nextPlannedDate } : {}),
            status: nextStatus as ProgramRunWorkoutStatus,
          },
        }
      : {}),
    repeatedFromRunId:
      jsonNullableString(
        row,
        "repeatedFromRunId",
        "repeated_from_run_id",
      ) ?? undefined,
    createdAt,
    finishedAt:
      jsonNullableString(row, "finishedAt", "finished_at") ?? undefined,
    endedAt: jsonNullableString(row, "endedAt", "ended_at") ?? undefined,
  };
}

function parseProgramRunDetail(value: unknown): ProgramRunDetail | null {
  const row = firstJsonRecord(value);
  const summary = parseProgramRunSummary(row);
  if (!row || !summary) return null;
  return {
    ...summary,
    workouts: jsonRecords(jsonField(row, "workouts"))
      .map(parseProgramRunWorkout)
      .filter((workout): workout is ProgramRunWorkout => workout !== null)
      .sort((left, right) => left.position - right.position),
  };
}

function parseCoachCompletedAgendaEntry(value: unknown): CoachAgendaEntry | null {
  const row = jsonRecord(value);
  if (!row) return null;
  const sessionId = jsonString(row, "id");
  const programId = jsonString(row, "programId", "program_id");
  const versionId = jsonString(row, "programVersionId", "program_version_id");
  const programTitle = jsonString(row, "programTitle", "program_title");
  const workoutTitle = jsonString(row, "workoutTitle", "workout_title");
  const completedAt = jsonNullableString(row, "completedAt", "completed_at") ??
    undefined;
  const date =
    jsonNullableString(row, "completedForDate", "completed_for_date") ??
    completedAt?.slice(0, 10);
  if (!sessionId || !programId || !versionId || !programTitle || !workoutTitle || !date) {
    return null;
  }
  return {
    id: `session:${sessionId}`,
    assignmentId:
      jsonNullableString(row, "assignmentId", "assignment_id") ?? undefined,
    programRunId:
      jsonNullableString(row, "programRunId", "program_run_id") ?? undefined,
    programRunWorkoutId:
      jsonNullableString(
        row,
        "programRunWorkoutId",
        "program_run_workout_id",
      ) ?? undefined,
    kind: "completed",
    status: "completed",
    programId,
    programVersionId: versionId,
    programTitle,
    workoutId:
      jsonNullableString(row, "workoutId", "workout_id") ?? undefined,
    workoutTitle,
    date,
    rpe: numberValue(jsonNumeric(row, "sessionRpe", "session_rpe")) ?? undefined,
    scheduleId:
      jsonNullableString(
        row,
        "scheduledWorkoutId",
        "scheduled_workout_id",
      ) ?? undefined,
    sessionId,
  };
}

function isMissingProgramRunsRpc(error: unknown) {
  const row = jsonRecord(error);
  const code = row ? jsonString(row, "code") : undefined;
  const message = row ? jsonString(row, "message") : undefined;
  return (
    code === "PGRST202" ||
    code === "42883" ||
    /could not find the function|does not exist/i.test(message ?? "")
  );
}

function isMissingProgramRunsColumn(error: unknown) {
  const row = jsonRecord(error);
  const code = row ? jsonString(row, "code") : undefined;
  const message = row ? jsonString(row, "message") : undefined;
  return (
    code === "PGRST204" ||
    code === "42703" ||
    /program_run_(?:workout_)?id.*does not exist|could not find.*program_run_/i.test(
      message ?? "",
    )
  );
}

const entryModes = new Set<EntryMode>([
  "none",
  "sets",
  "result",
  "intervals",
]);
const trackingFields = new Set<TrackingField>([
  "reps",
  "load",
  "duration",
  "distance",
  "rounds",
  "heartRate",
  "rpe",
]);

function parseCoachCompletedSessionDetail(
  value: unknown,
): CompletedSessionDetail | null {
  const row = firstJsonRecord(value);
  const session = parseSessionRow(row);
  if (!row || !session) return null;
  const itemsValue = jsonField(row, "items");
  const items = jsonRecords(itemsValue).flatMap((item) => {
    const id = jsonString(item, "id");
    const title = jsonString(item, "title", "snapshot_name");
    const modeValue = jsonString(item, "mode", "entry_mode");
    if (!id || !title || !modeValue || !entryModes.has(modeValue as EntryMode))
      return [];
    const rawFields = jsonField(item, "fields", "tracking_fields");
    const fields = Array.isArray(rawFields)
      ? rawFields.filter(
          (field): field is TrackingField =>
            typeof field === "string" && trackingFields.has(field as TrackingField),
        )
      : [];
    const entriesValue = jsonField(item, "entries");
    return [
      {
        id,
        title,
        category:
          jsonNullableString(
            item,
            "exerciseCategory",
            "exercise_category",
            "snapshot_category",
          ) ?? undefined,
        videoUrl:
          jsonNullableString(
            item,
            "videoUrl",
            "video_url",
            "snapshot_video_url",
          ) ?? undefined,
        cue: jsonString(item, "cue", "snapshot_cue") ?? "",
        mode: modeValue as EntryMode,
        fields,
        position: jsonInteger(item, "position") ?? 0,
        entries: jsonRecords(entriesValue)
          .map((entry) => ({
            position: jsonInteger(entry, "position") ?? 0,
            reps: numberValue(jsonNumeric(entry, "reps")) ?? undefined,
            loadKg:
              numberValue(jsonNumeric(entry, "loadKg", "load_kg")) ??
              undefined,
            durationMinutes: (() => {
              const seconds = numberValue(
                jsonNumeric(entry, "durationSeconds", "duration_seconds"),
              );
              return seconds === null ? undefined : seconds / 60;
            })(),
            distanceKm: (() => {
              const metres = numberValue(
                jsonNumeric(entry, "distanceMetres", "distance_metres"),
              );
              return metres === null ? undefined : metres / 1000;
            })(),
            rounds:
              jsonInteger(entry, "rounds") ?? undefined,
            heartRate:
              jsonInteger(entry, "heartRate", "heart_rate") ?? undefined,
            rpe: numberValue(jsonNumeric(entry, "rpe")) ?? undefined,
          }))
          .sort((left, right) => left.position - right.position),
      },
    ];
  });
  return {
    ...mapCompletedSession(session),
    items: items.sort((left, right) => left.position - right.position),
  };
}

function numberValue(value: NumericValue | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function displayNumber(value: NumericValue | undefined) {
  const parsed = numberValue(value);
  return parsed === null ? "" : String(parsed);
}

function numericRange(value?: string) {
  const numbers = (value ?? "")
    .split(/[–-]/)
    .map((part) => numberValue(part.trim()))
    .filter((part): part is number => part !== null);
  return {
    minimum: numbers[0] ?? null,
    maximum: numbers[1] ?? numbers[0] ?? null,
  };
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "LL"
  );
}

function shiftDateOnly(value: string, days: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDateOnly(date);
}

function mapCompletedSession(
  session: SessionRow,
  note?: string,
): CompletedSession {
  const start = new Date(session.started_at);
  const end = session.completed_at ? new Date(session.completed_at) : start;
  return {
    id: session.id,
    programRunId: session.program_run_id ?? undefined,
    programRunWorkoutId: session.program_run_workout_id ?? undefined,
    programVersionId: session.program_version_id ?? undefined,
    workoutId: session.workout_id ?? undefined,
    workoutTitle: session.workout_title,
    date: session.completed_for_date ?? localDateOnly(start),
    durationMinutes: Math.max(
      1,
      Math.round((end.getTime() - start.getTime()) / 60_000),
    ),
    rpe: numberValue(session.session_rpe) ?? 0,
    ...(note ? { note } : {}),
  };
}

function prescriptionEntryFromRow(row: PrescriptionRow): PrescriptionEntry {
  const rpeLow = displayNumber(row.target_rpe_min);
  const rpeHigh = displayNumber(row.target_rpe_max);
  const repsLow = displayNumber(row.reps_min);
  const repsHigh = displayNumber(row.reps_max);
  return {
    reps:
      repsLow && repsHigh && repsLow !== repsHigh
        ? `${repsLow}–${repsHigh}`
        : repsLow || repsHigh || undefined,
    loadKg: numberValue(row.load_kg) ?? undefined,
    durationMinutes: row.duration_seconds ? row.duration_seconds / 60 : undefined,
    distance: numberValue(row.distance_metres)
      ? Number(numberValue(row.distance_metres)) / 1000
      : undefined,
    distanceUnit: "km",
    rounds: row.rounds ?? undefined,
    workSeconds: row.work_seconds ?? undefined,
    restSeconds: row.rest_seconds ?? undefined,
    targetRpe:
      rpeLow && rpeHigh && rpeLow !== rpeHigh
        ? `${rpeLow}–${rpeHigh}`
        : rpeLow || rpeHigh || undefined,
  };
}

function prescriptionFromRows(
  mode: EntryMode,
  rows: PrescriptionRow[],
): Prescription {
  const ordered = [...rows].sort(
    (left, right) => left.position - right.position,
  );
  const first = ordered[0];
  if (!first) return {};
  const entries = ordered.map(prescriptionEntryFromRow);
  const rpeLow = displayNumber(first.target_rpe_min);
  const rpeHigh = displayNumber(first.target_rpe_max);
  const targetRpe =
    rpeLow && rpeHigh && rpeLow !== rpeHigh
      ? `${rpeLow}–${rpeHigh}`
      : rpeLow || rpeHigh || undefined;

  if (mode === "sets") {
    const repsLow = displayNumber(first.reps_min);
    const repsHigh = displayNumber(first.reps_max);
    return {
      sets: ordered.length,
      reps:
        repsLow && repsHigh && repsLow !== repsHigh
          ? `${repsLow}–${repsHigh}`
          : repsLow || repsHigh || first.target_text || undefined,
      loadKg: numberValue(first.load_kg) ?? undefined,
      targetRpe,
      targetText: first.target_text ?? undefined,
      entries,
    };
  }

  return {
    loadKg: numberValue(first.load_kg) ?? undefined,
    durationMinutes: first.duration_seconds
      ? first.duration_seconds / 60
      : undefined,
    distance: numberValue(first.distance_metres)
      ? Number(numberValue(first.distance_metres)) / 1000
      : undefined,
    distanceUnit: "km",
    rounds:
      mode === "intervals" && ordered.length > 1
        ? ordered.length
        : first.rounds ?? undefined,
    workSeconds: first.work_seconds ?? undefined,
    restSeconds: first.rest_seconds ?? undefined,
    targetRpe,
    targetText: first.target_text ?? undefined,
    entries,
  };
}

function activeWeekIndex(version: VersionRow, weekCount: number) {
  if (!version.effective_from || version.status === "draft") return 1;
  return activeWeekForDate(
    version.effective_from,
    localDateOnly(),
    weekCount,
  );
}

function mapExercise(row: ExerciseRow, ownerName: string): Exercise {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    discipline: row.discipline ?? undefined,
    tags: row.tags ?? [],
    sourceProvider: row.source_provider ?? undefined,
    sourceExternalId: row.source_external_id ?? undefined,
    sourceUrl: row.source_url ?? undefined,
    videoUrl: row.video_url ?? undefined,
    cue: row.cue,
    scope: row.scope,
    ownerName: row.scope === "personal" ? ownerName : undefined,
    defaultMode: row.default_entry_mode,
    defaultFields: row.default_tracking_fields,
  };
}

function parseEntryMode(value: unknown): EntryMode {
  return typeof value === "string" && entryModes.has(value as EntryMode)
    ? (value as EntryMode)
    : "none";
}

function parseTrackingFields(value: unknown): TrackingField[] {
  return jsonStringArray(value).filter((field): field is TrackingField =>
    trackingFields.has(field as TrackingField),
  );
}

function parsePrescriptionPayload(
  value: unknown,
  workoutItemId: string,
): PrescriptionRow[] {
  return jsonRecords(value).map((entry, index) => ({
    id: jsonString(entry, "id") ?? `${workoutItemId}:entry:${index}`,
    workout_item_id: workoutItemId,
    position: jsonInteger(entry, "position") ?? index,
    reps_min: jsonNumeric(entry, "repsMin", "reps_min"),
    reps_max: jsonNumeric(entry, "repsMax", "reps_max"),
    load_kg: jsonNumeric(entry, "loadKg", "load_kg"),
    duration_seconds:
      jsonInteger(entry, "durationSeconds", "duration_seconds") ?? null,
    distance_metres: jsonNumeric(
      entry,
      "distanceMetres",
      "distance_metres",
    ),
    rounds: jsonInteger(entry, "rounds") ?? null,
    work_seconds: jsonInteger(entry, "workSeconds", "work_seconds") ?? null,
    rest_seconds: jsonInteger(entry, "restSeconds", "rest_seconds") ?? null,
    target_rpe_min: jsonNumeric(
      entry,
      "targetRpeMin",
      "target_rpe_min",
    ),
    target_rpe_max: jsonNumeric(
      entry,
      "targetRpeMax",
      "target_rpe_max",
    ),
    target_text: jsonNullableString(entry, "targetText", "target_text"),
  }));
}

function parseWorkoutItemPayload(
  value: unknown,
  itemIndex = 0,
): (WorkoutItem & { position: number }) | null {
  const item = jsonRecord(value);
  if (!item) return null;
  const itemId = jsonString(item, "id");
  if (!itemId) return null;
  const mode = parseEntryMode(jsonField(item, "entryMode", "entry_mode"));
  return {
    id: itemId,
    exerciseId:
      jsonNullableString(item, "sourceExerciseId", "source_exercise_id") ?? undefined,
    category:
      jsonNullableString(item, "category", "exerciseCategory", "exercise_category") ?? undefined,
    videoUrl: jsonNullableString(item, "videoUrl", "video_url") ?? undefined,
    title: jsonString(item, "name", "snapshotName", "snapshot_name") ?? "Exercise",
    cue: jsonString(item, "cue", "snapshotCue", "snapshot_cue") ?? "",
    mode,
    fields: parseTrackingFields(jsonField(item, "trackingFields", "tracking_fields")),
    prescription: prescriptionFromRows(
      mode,
      parsePrescriptionPayload(
        jsonField(item, "prescribedEntries", "prescribed_entries"), itemId,
      ),
    ),
    position: jsonInteger(item, "position") ?? itemIndex,
  };
}

function parseWorkoutPayload(
  value: unknown,
  programVersionId: string,
  occurrence?: {
    id?: string;
    plannedDate?: string;
    sequenceNumber?: number;
  },
): PlannedWorkout | null {
  const workout = jsonRecord(value);
  if (!workout) return null;
  const id = jsonString(workout, "id");
  const title = jsonString(workout, "title");
  if (!id || !title) return null;
  const position = jsonInteger(workout, "position") ?? 0;
  const scheduleLabel = jsonString(workout, "scheduleLabel", "schedule_label");
  const sections = jsonRecords(jsonField(workout, "sections"))
    .map(
      (
        section,
        sectionIndex,
      ): (WorkoutSection & { position: number }) | null => {
      const sectionId = jsonString(section, "id");
      if (!sectionId) return null;
      const kind = jsonString(section, "kind", "sectionKind", "section_kind");
      const items = jsonRecords(jsonField(section, "items"))
        .map(parseWorkoutItemPayload)
        .filter((item): item is WorkoutItem & { position: number } => item !== null)
        .sort((left, right) => left.position - right.position);
      const normalizedKind: WorkoutSection["kind"] =
        kind === "warmup" ||
        kind === "main" ||
        kind === "conditioning" ||
        kind === "cooldown" ||
        kind === "custom"
          ? kind
          : "custom";
      return {
        id: sectionId,
        title: jsonString(section, "title") ?? "Section",
        kind: normalizedKind,
        items,
        position: jsonInteger(section, "position") ?? sectionIndex,
      };
      },
    )
    .filter(
      (section): section is WorkoutSection & { position: number } =>
        section !== null,
    )
    .sort((left, right) => left.position - right.position);

  return {
    id,
    programVersionId,
    scheduledWorkoutId: occurrence?.id,
    plannedDate: occurrence?.plannedDate,
    title,
    dayLabel:
      scheduleLabel ||
      (occurrence?.sequenceNumber
        ? `Session ${occurrence.sequenceNumber}`
        : `Workout ${position + 1}`),
    durationMinutes:
      jsonInteger(workout, "estimatedMinutes", "estimated_minutes") ?? 45,
    sections,
  };
}

function parseProgramDetailPayload(
  value: unknown,
  viewerId: string,
  viewerName: string,
): Program | null {
  const row = firstJsonRecord(value);
  if (!row) return null;
  const programId = jsonString(row, "programId", "program_id");
  const athleteId = jsonString(row, "athleteId", "athlete_id");
  const createdById = jsonString(row, "createdById", "created_by_id");
  const versionId = jsonString(row, "versionId", "version_id");
  const title = jsonString(row, "title");
  const status = jsonString(row, "versionStatus", "version_status");
  if (
    !programId ||
    !athleteId ||
    !createdById ||
    !versionId ||
    !title ||
    (status !== "draft" && status !== "published" && status !== "superseded")
  ) {
    return null;
  }
  const kind = jsonString(row, "kind");
  const assignmentId = jsonNullableString(row, "assignmentId", "assignment_id");
  const phases = jsonRecords(jsonField(row, "phases")).sort(
    (left, right) =>
      (jsonInteger(left, "position") ?? 0) -
      (jsonInteger(right, "position") ?? 0),
  );
  const weeks = jsonRecords(jsonField(row, "weeks"))
    .map((week, index) => {
      const weekId = jsonString(week, "id");
      if (!weekId) return null;
      const weekIndex = jsonInteger(week, "weekIndex", "week_index") ?? index + 1;
      return {
        id: weekId,
        index: weekIndex,
        label: jsonString(week, "label") ?? `Week ${weekIndex}`,
        workouts: jsonRecords(jsonField(week, "workouts"))
          .map((workout) => parseWorkoutPayload(workout, versionId))
          .filter((workout): workout is PlannedWorkout => workout !== null),
      };
    })
    .filter((week): week is NonNullable<typeof week> => week !== null)
    .sort((left, right) => left.index - right.index);
  const effectiveFrom = jsonNullableString(row, "effectiveFrom", "effective_from");
  const contentType = jsonString(row, "contentType", "content_type");
  const rawSourceType = jsonString(row, "sourceType", "source_type");
  const sourceType =
    kind === "assignment"
      ? "coach"
      : rawSourceType === "coach" || rawSourceType === "library"
        ? rawSourceType
        : "self";
  const ownerName = athleteId === viewerId ? viewerName : "Athlete";
  const createdByName = createdById === viewerId ? viewerName : "Coach";
  return {
    id: programId,
    athleteId,
    versionId,
    versionStatus: status,
    effectiveFrom: effectiveFrom ?? undefined,
    title,
    description: jsonString(row, "description") ?? "",
    phase: jsonString(phases[0] ?? {}, "name") ?? "Plan",
    activeWeek: activeWeekIndex(
      {
        id: versionId,
        program_id: programId,
        version_number: jsonInteger(row, "versionNumber", "version_number") ?? 1,
        status,
        effective_from: effectiveFrom,
        title,
        description: jsonString(row, "description") ?? "",
      },
      weeks.length,
    ),
    weeks,
    ownerName,
    createdById,
    createdByName,
    sourceType,
    sourceLabel:
      sourceType === "self"
        ? "Created by you"
        : sourceType === "library"
          ? "Library"
          : "Assigned by coach",
    assignmentId: assignmentId ?? undefined,
    programRunId:
      jsonNullableString(row, "programRunId", "program_run_id") ?? undefined,
    customizedProgramId:
      jsonNullableString(
        row,
        "customizedProgramId",
        "customized_program_id",
      ) ?? undefined,
    contentType: contentType === "quick_workout" ? "quick_workout" : "program",
    weekCount: weeks.length,
    workoutCount: weeks.reduce((count, week) => count + week.workouts.length, 0),
    workoutIds: weeks.flatMap((week) => week.workouts.map((workout) => workout.id)),
    detailsLoaded: true,
  };
}

function parseActiveSessionPayload(value: unknown): ActiveSession | null {
  const row = jsonRecord(value);
  if (!row) return null;
  const id = jsonString(row, "id");
  const workoutId = jsonString(row, "workoutId", "workout_id");
  const programVersionId = jsonString(
    row,
    "programVersionId",
    "program_version_id",
  );
  if (!id || !workoutId || !programVersionId) return null;
  const itemLogIds = jsonStringMap(jsonField(row, "itemLogIds", "item_log_ids"));
  const setLogs: Record<string, SessionSetValue[]> = {};
  const resultLogs: Record<string, Record<string, string>> = {};
  for (const item of jsonRecords(jsonField(row, "items"))) {
    const sourceItemId = jsonString(
      item,
      "sourceWorkoutItemId",
      "source_workout_item_id",
    );
    const itemLogId = jsonString(item, "itemLogId", "item_log_id");
    if (!sourceItemId || !itemLogId) continue;
    itemLogIds[sourceItemId] = itemLogId;
    const mode = parseEntryMode(jsonField(item, "entryMode", "entry_mode"));
    const entries = jsonRecords(jsonField(item, "entries")).sort(
      (left, right) =>
        (jsonInteger(left, "position") ?? 0) -
        (jsonInteger(right, "position") ?? 0),
    );
    if (mode === "sets") {
      setLogs[sourceItemId] = entries.map((entry) => ({
        reps: displayNumber(jsonNumeric(entry, "reps")),
        load: displayNumber(jsonNumeric(entry, "loadKg", "load_kg")),
        rpe: displayNumber(jsonNumeric(entry, "rpe")),
      }));
      continue;
    }
    if (mode === "intervals") {
      resultLogs[sourceItemId] = Object.fromEntries(
        entries.flatMap((entry, index) => {
          const position = jsonInteger(entry, "position") ?? index;
          const durationSeconds = jsonInteger(
            entry,
            "durationSeconds",
            "duration_seconds",
          );
          const distance = numberValue(
            jsonNumeric(entry, "distanceMetres", "distance_metres"),
          );
          return [
            [`round.${position}.completed`, jsonInteger(entry, "rounds") ? "1" : ""],
            [
              `round.${position}.duration`,
              durationSeconds === undefined
                ? ""
                : String(durationSeconds),
            ],
            [`round.${position}.distance`, distance === null ? "" : String(distance / 1000)],
            [`round.${position}.heartRate`, displayNumber(jsonNumeric(entry, "heartRate", "heart_rate"))],
            [`round.${position}.rpe`, displayNumber(jsonNumeric(entry, "rpe"))],
          ];
        }),
      );
      continue;
    }
    if (mode !== "none") {
      const entry = entries[0];
      const durationSeconds = entry
        ? jsonInteger(entry, "durationSeconds", "duration_seconds")
        : undefined;
      const distance = entry
        ? numberValue(jsonNumeric(entry, "distanceMetres", "distance_metres"))
        : null;
      resultLogs[sourceItemId] = entry
        ? {
            rounds: displayNumber(jsonNumeric(entry, "rounds")),
            duration:
              durationSeconds === undefined ? "" : String(durationSeconds / 60),
            distance: distance === null ? "" : String(distance / 1000),
            load: displayNumber(jsonNumeric(entry, "loadKg", "load_kg")),
            heartRate: displayNumber(jsonNumeric(entry, "heartRate", "heart_rate")),
            rpe: displayNumber(jsonNumeric(entry, "rpe")),
          }
        : {};
    }
  }
  return {
    id,
    draftRevision: jsonInteger(row, "draftRevision", "draft_revision") ?? 0,
    draftWriteToken:
      jsonNullableString(row, "draftWriteToken", "draft_write_token") ?? undefined,
    draftSavedAt:
      jsonNullableString(row, "draftSavedAt", "draft_saved_at") ?? undefined,
    assignmentId:
      jsonNullableString(row, "assignmentId", "assignment_id") ?? undefined,
    programRunId:
      jsonNullableString(row, "programRunId", "program_run_id") ?? undefined,
    programRunWorkoutId:
      jsonNullableString(
        row,
        "programRunWorkoutId",
        "program_run_workout_id",
      ) ?? undefined,
    workoutId,
    programVersionId,
    scheduledWorkoutId:
      jsonNullableString(
        row,
        "scheduledWorkoutId",
        "scheduled_workout_id",
      ) ?? undefined,
    itemLogIds,
    setLogs,
    resultLogs,
    sessionRpe: displayNumber(jsonNumeric(row, "sessionRpe", "session_rpe")) || "7",
    sessionNote: jsonString(row, "sessionNote", "session_note") ?? "",
  };
}

export function buildSessionDraftPayload(
  session: ActiveSession,
  setLogs: Record<string, SessionSetValue[]>,
  resultLogs: Record<string, Record<string, string>>,
  sessionRpe: string,
  sessionNote: string,
): SessionDraftPayload {
  const items = Object.entries(session.itemLogIds).map(
    ([itemId, itemLogId]) => {
      const sets = setLogs[itemId];
      const result = resultLogs[itemId];
      const touchedIntervalPositions = result
        ? Object.keys(result)
            .map((key) => /^round\.(\d+)\./.exec(key)?.[1])
            .filter((position): position is string => position !== undefined)
            .map(Number)
        : [];
      const intervalPositions = touchedIntervalPositions.length
        ? Array.from(
            { length: Math.max(...touchedIntervalPositions) + 1 },
            (_, position) => position,
          )
        : [];
      const entries: SessionDraftEntryPayload[] = sets
        ? sets.map((set, position) => ({
            position,
            reps: numberValue(set.reps),
            loadKg: numberValue(set.load),
            durationSeconds: null,
            distanceMetres: null,
            rounds: null,
            heartRate: null,
            rpe: numberValue(set.rpe),
          }))
        : result && intervalPositions.length
          ? intervalPositions.map((position) => ({
              position,
              reps: null,
              loadKg: null,
              durationSeconds:
                numberValue(result[`round.${position}.duration`]) === null
                  ? null
                  : Math.round(Number(result[`round.${position}.duration`])),
              distanceMetres:
                numberValue(result[`round.${position}.distance`]) === null
                  ? null
                  : Number(result[`round.${position}.distance`]) * 1000,
              rounds: result[`round.${position}.completed`] ? 1 : null,
              heartRate: numberValue(result[`round.${position}.heartRate`]),
              rpe: numberValue(result[`round.${position}.rpe`]),
            }))
          : result
          ? [
              {
                position: 0,
                reps: null,
                loadKg: numberValue(result.load),
                durationSeconds:
                  numberValue(result.duration) === null
                    ? null
                    : Math.round(Number(result.duration) * 60),
                distanceMetres:
                  numberValue(result.distance) === null
                    ? null
                    : Number(result.distance) * 1000,
                rounds: numberValue(result.rounds),
                heartRate: numberValue(result.heartRate),
                rpe: numberValue(result.rpe),
              },
            ]
          : [];
      return { itemLogId, entries };
    },
  );
  return {
    sessionRpe: numberValue(sessionRpe),
    sessionNote,
    items,
  };
}

export class LiftLogRepository {
  private disposed = false;
  private readonly queryCache = new BoundedQueryCache(96, 30_000, Date.now, {
    maximumWeight: REPOSITORY_QUERY_CACHE_MAX_SERIALIZED_BYTES,
  });
  private readonly programSelectors = new Map<
    string,
    { programId: string; assignmentId?: string; versionId?: string }
  >();

  constructor(
    private readonly client: SupabaseClient,
    private readonly viewerId: string,
    private readonly viewerName: string,
  ) {}

  dispose() {
    this.disposed = true;
    this.programSelectors.clear();
    this.queryCache.dispose();
  }

  private assertActive() {
    if (this.disposed) throw new Error("This data workspace is no longer active");
  }

  async loadBootstrap(): Promise<WorkspaceData> {
    return this.queryCache.getOrLoad("bootstrap", async () => {
      const startedAt = performance.now();
      try {
        return await this.loadBootstrapData();
      } finally {
        recordClientPerformance("bootstrap", startedAt, { phase: "repository" });
      }
    }, { shouldCache: () => false });
  }

  private async loadBootstrapData(): Promise<WorkspaceData> {
    this.assertActive();
    const result = await this.client.rpc("get_workspace_bootstrap");
    this.assertActive();
    if (result.error) fail("Could not load your training workspace", result.error);
    const payload = firstJsonRecord(result.data);
    const profileRow = payload
      ? jsonRecord(jsonField(payload, "profile"))
      : null;
    const profileId = profileRow ? jsonString(profileRow, "id") : undefined;
    const displayName = profileRow
      ? jsonString(profileRow, "displayName", "display_name")
      : undefined;
    const firstName = profileRow
      ? jsonString(profileRow, "firstName", "first_name")
      : undefined;
    const lastName = profileRow
      ? jsonString(profileRow, "lastName", "last_name")
      : undefined;
    const liftlogId = profileRow
      ? jsonString(profileRow, "liftlogId", "liftlog_id")
      : undefined;
    if (
      !payload ||
      !profileRow ||
      !profileId ||
      !displayName ||
      firstName === undefined ||
      lastName === undefined ||
      !liftlogId
    ) {
      fail("Could not load your training workspace", null);
    }
    const profile: OwnProfile = {
      id: profileId,
      firstName,
      lastName,
      displayName,
      liftlogId,
      weekStartsOnSunday:
        jsonBoolean(
          profileRow,
          "weekStartsOnSunday",
          "week_starts_on_sunday",
        ) ?? false,
      weightUnit:
        jsonString(profileRow, "weightUnit", "weight_unit") === "lb"
          ? "lb"
          : "kg",
      distanceUnit:
        jsonString(profileRow, "distanceUnit", "distance_unit") === "mi"
          ? "mi"
          : "km",
    };
    await this.syncTimezoneIfChanged(
      jsonNullableString(profileRow, "timezone"),
    );
    this.assertActive();
    const activeSession = parseActiveSessionPayload(
      jsonField(payload, "activeSession", "active_session"),
    );
    const coachingAccessRow = jsonRecord(
      jsonField(payload, "coachingAccess", "coaching_access"),
    );
    const activeWorkout = activeSession
      ? parseWorkoutPayload(
          jsonField(payload, "activeWorkout", "active_workout"),
          activeSession.programVersionId,
          {
            id: activeSession.scheduledWorkoutId,
          },
        )
      : null;
    const scheduledWorkouts = jsonRecords(
      jsonField(payload, "nextWorkouts", "next_workouts"),
    ).flatMap((row): ScheduledWorkout[] => {
      const id = jsonString(row, "id");
      const versionId = jsonString(row, "programVersionId", "program_version_id");
      const workoutId = jsonString(row, "workoutId", "workout_id");
      const workoutTitle = jsonString(row, "workoutTitle", "workout_title");
      const programTitle = jsonString(row, "programTitle", "program_title");
      const status = jsonString(row, "status");
      if (
        !id ||
        !versionId ||
        !workoutId ||
        !workoutTitle ||
        !programTitle ||
        (status !== "planned" && status !== "in_progress")
      ) {
        return [];
      }
      const plannedDate =
        jsonNullableString(row, "plannedDate", "planned_date") ?? undefined;
      const sequenceNumber =
        jsonInteger(row, "sequenceNumber", "sequence_number") ?? 0;
      const assignmentId =
        jsonNullableString(row, "assignmentId", "assignment_id") ?? undefined;
      const hydratedWorkout =
        activeSession?.scheduledWorkoutId === id && activeWorkout
          ? { ...activeWorkout, plannedDate }
          : {
              id: workoutId,
              programVersionId: versionId,
              scheduledWorkoutId: id,
              plannedDate,
              title: workoutTitle,
              dayLabel: `Session ${sequenceNumber || 1}`,
              durationMinutes:
                jsonInteger(row, "estimatedMinutes", "estimated_minutes") ??
                0,
              sections: [],
            };
      return [
        {
          id,
          assignmentId,
          programRunId:
            jsonNullableString(row, "programRunId", "program_run_id") ??
            undefined,
          programRunWorkoutId:
            jsonNullableString(
              row,
              "programRunWorkoutId",
              "program_run_workout_id",
            ) ?? undefined,
          // The bounded bootstrap intentionally omits content program identity.
          // Opening a row uses get_scheduled_workout_detail(id), not this field.
          programId: "",
          programTitle,
          programVersionId: versionId,
          workoutId,
          workoutTitle,
          slotLabel: `${programTitle} · ${workoutTitle}`,
          plannedDate,
          sequenceNumber,
          status,
          sourceType: scheduledWorkoutSourceType(
            row,
            assignmentId,
            this.viewerId,
          ),
          workout: hydratedWorkout,
          detailsLoaded: hydratedWorkout.sections.length > 0,
        },
      ];
    });

    return {
      profile,
      coachingAccess: {
        hasCoach:
          (coachingAccessRow
            ? jsonBoolean(coachingAccessRow, "hasCoach", "has_coach")
            : undefined) ?? false,
        coachedAthleteCount:
          (coachingAccessRow
            ? jsonInteger(
                coachingAccessRow,
                "coachedAthleteCount",
                "coached_athlete_count",
              )
            : undefined) ?? 0,
        pendingInviteCount:
          (coachingAccessRow
            ? jsonInteger(
                coachingAccessRow,
                "pendingInviteCount",
                "pending_invite_count",
              )
            : undefined) ?? 0,
      },
      programCatalog: [],
      schedulableProgramIds: [],
      schedulablePrograms: [],
      draftProgram: null,
      activeProgram: null,
      scheduledWorkouts,
      globalExercises: [],
      personalExercises: [],
      completedSessions: [],
      coachConnections: [],
      coachedAthletes: [],
      pendingCoachInvites: [],
      outgoingCoachInvites: [],
      activeSession,
    };
  }

  async loadExerciseWorkspace(): Promise<ExerciseWorkspaceData> {
    return this.queryCache.getOrLoad(
      "feature:exercises",
      async () => {
        const [globalPage, personalPage] = await Promise.all([
          this.searchExercises({ scope: "global", limit: 50 }),
          this.searchExercises({ scope: "personal", limit: 50 }),
        ]);
        return {
          globalExercises: globalPage.items,
          personalExercises: personalPage.items,
        };
      },
      { ttlMs: 30_000 },
    );
  }

  async loadProgramWorkspace(): Promise<ProgramWorkspaceData> {
    const [programPage, programRunPage, coachProgramRunPage] = await Promise.all([
      this.listProgramSummaries(),
      this.listProgramRuns(),
      this.listProgramRuns(undefined, { creatorScope: "coach" }),
    ]);
    const programCatalog = programPage.items;
    const schedulablePrograms = programCatalog.filter(
      (program) =>
        program.versionStatus === "published" && program.sourceType !== "library",
    );
    return {
      programCatalog,
      schedulableProgramIds: schedulablePrograms.map((program) => program.id),
      schedulablePrograms,
      draftProgram:
        programCatalog.find((program) => program.versionStatus === "draft") ?? null,
      activeProgram:
        programCatalog.find(
          (program) =>
            program.sourceType !== "library" &&
            program.versionStatus === "published",
        ) ?? null,
      programRuns: programRunPage.items,
      programRunCursor: programRunPage.nextCursor,
      hasMoreProgramRuns: programRunPage.hasMore,
      coachProgramRuns: coachProgramRunPage.items,
      coachProgramRunCursor: coachProgramRunPage.nextCursor,
      hasMoreCoachProgramRuns: coachProgramRunPage.hasMore,
    };
  }

  /**
   * Lists one athlete's concrete program runs. Missing-RPC fallback keeps an
   * older backend usable during the additive database/frontend rollout.
   */
  async listProgramRuns(
    athleteId?: string,
    options: ProgramRunPageOptions = {},
  ): Promise<CursorPage<ProgramRunSummary, ProgramRunCursor>> {
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 25), 1), 50);
    const creatorScope = options.creatorScope ?? "all";
    const cursorKey = options.cursor
      ? `${options.cursor.createdAt}:${options.cursor.id}`
      : "first";
    const cacheKey = `program-runs:${athleteId ?? "self"}:${creatorScope}:${limit}:${cursorKey}`;
    return this.queryCache.getOrLoad(
      cacheKey,
      async () => {
        const result = await this.client.rpc("list_program_run_summaries", {
          target_athlete_id: athleteId ?? null,
          page_limit: limit + 1,
          after_created_at: options.cursor?.createdAt ?? null,
          after_id: options.cursor?.id ?? null,
          creator_scope: creatorScope,
        });
        if (result.error) {
          if (isMissingProgramRunsRpc(result.error)) {
            return { items: [], hasMore: false };
          }
          fail("Could not load program runs", result.error);
        }
        const runs = jsonRecords(result.data)
          .map(parseProgramRunSummary)
          .filter((run): run is ProgramRunSummary => run !== null);
        const items = runs.slice(0, limit);
        const hasMore = runs.length > limit;
        const last = items.at(-1);
        return {
          items,
          hasMore,
          ...(hasMore && last
            ? { nextCursor: { createdAt: last.createdAt, id: last.id } }
            : {}),
        };
      },
      { ttlMs: 15_000 },
    );
  }

  async loadProgramRunDetail(runId: string): Promise<ProgramRunDetail | null> {
    return this.queryCache.getOrLoad(
      `program-run-detail:${runId}`,
      async () => {
        const result = await this.client.rpc("get_program_run_detail", {
          target_run_id: runId,
        });
        if (result.error) fail("Could not load the program run", result.error);
        return parseProgramRunDetail(result.data);
      },
      { ttlMs: 15_000, shouldCache: (value) => value !== null },
    );
  }

  async loadProgramForRun(runId: string): Promise<Program | null> {
    return this.queryCache.getOrLoad(
      `program-run-content:${runId}`,
      async () => {
        const result = await this.client.rpc("get_program_run_program_detail", {
          target_run_id: runId,
        });
        if (result.error) fail("Could not load the program run", result.error);
        return parseProgramDetailPayload(result.data, this.viewerId, this.viewerName);
      },
      { ttlMs: 30_000, shouldCache: (value) => value !== null },
    );
  }

  async listProgramSummaries(
    options: ProgramPageOptions = {},
  ): Promise<CursorPage<Program, ProgramCursor>> {
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 25), 1), 49);
    const cursorKey = options.cursor
      ? `${options.cursor.createdAt}:${options.cursor.id}`
      : "first";
    return this.queryCache.getOrLoad(
      `program-page:${limit}:${cursorKey}`,
      async () => {
        const result = await this.client.rpc("list_program_summaries", {
          page_limit: limit + 1,
          after_created_at: options.cursor?.createdAt ?? null,
          after_id: options.cursor?.id ?? null,
        });
        if (result.error) fail("Could not load programs", result.error);
        const rows = jsonRecords(result.data);
        const visibleRows = rows.slice(0, limit);
        const items = visibleRows.flatMap((row): Program[] => {
          const rowId = jsonString(row, "id");
          const programId = jsonString(row, "program_id", "programId");
          const athleteId = jsonString(row, "athlete_id", "athleteId");
          const versionId = jsonString(row, "version_id", "versionId");
          const title = jsonString(row, "title");
          const createdById = jsonString(row, "created_by_id", "createdById");
          const createdAt = jsonString(row, "created_at", "createdAt");
          const status = jsonString(row, "version_status", "versionStatus");
          const kind = jsonString(row, "kind");
          if (
            !rowId ||
            !programId ||
            !athleteId ||
            !versionId ||
            !title ||
            !createdById ||
            !createdAt ||
            (status !== "draft" &&
              status !== "published" &&
              status !== "superseded")
          ) {
            return [];
          }
          const assignmentId =
            jsonNullableString(row, "assignment_id", "assignmentId") ??
            undefined;
          this.programSelectors.set(`${programId}:${versionId}`, {
            programId,
            assignmentId,
            versionId,
          });
          this.programSelectors.set(rowId, { programId, assignmentId, versionId });
          this.programSelectors.set(programId, {
            programId,
            assignmentId,
            versionId,
          });
          const rawSource = jsonString(row, "source_type", "sourceType");
          const sourceType =
            kind === "assignment"
              ? "coach"
              : rawSource === "coach" || rawSource === "library"
                ? rawSource
                : "self";
          const weekCount =
            numberValue(jsonNumeric(row, "week_count", "weekCount")) ?? 0;
          const workoutCount =
            numberValue(jsonNumeric(row, "workout_count", "workoutCount")) ?? 0;
          return [
            {
              id: programId,
              athleteId,
              versionId,
              versionStatus: status,
              title,
              description: jsonString(row, "description") ?? "",
              phase: "Plan",
              activeWeek: 1,
              weeks: [],
              ownerName: athleteId === this.viewerId ? this.viewerName : "Athlete",
              createdById,
              createdByName:
                createdById === this.viewerId ? this.viewerName : "Coach",
              sourceType,
              sourceLabel:
                sourceType === "self"
                  ? "Created by you"
                  : sourceType === "library"
                    ? "Library"
                    : "Assigned by coach",
              assignmentId,
              customizedProgramId:
                jsonNullableString(
                  row,
                  "customized_program_id",
                  "customizedProgramId",
                ) ?? undefined,
              contentType:
                jsonString(row, "content_type", "contentType") ===
                "quick_workout"
                  ? "quick_workout"
                  : "program",
              weekCount,
              workoutCount,
              workoutIds: [],
              detailsLoaded: false,
            },
          ];
        });
        const last = visibleRows.at(-1);
        const nextCursor =
          rows.length > limit && last
            ? {
                createdAt:
                  jsonString(last, "created_at", "createdAt") ?? "",
                id: jsonString(last, "id") ?? "",
              }
            : undefined;
        return {
          items,
          hasMore: Boolean(nextCursor?.createdAt && nextCursor.id),
          ...(nextCursor?.createdAt && nextCursor.id ? { nextCursor } : {}),
        };
      },
      { ttlMs: 30_000 },
    );
  }

  async listCalendarOccurrences(
    rangeStart: string,
    rangeEnd: string,
    options: CalendarPageOptions = {},
  ): Promise<CursorPage<ScheduledWorkout, CalendarCursor>> {
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 100), 1), 199);
    const result = await this.client.rpc("list_calendar_occurrences", {
      range_start: rangeStart,
      range_end: rangeEnd,
      page_limit: limit + 1,
      after_planned_date: options.cursor?.plannedDate ?? null,
      after_id: options.cursor?.id ?? null,
    });
    if (result.error) fail("Could not load your calendar", result.error);
    const rows = jsonRecords(result.data);
    const visibleRows = rows.slice(0, limit);
    const items = visibleRows.flatMap((row): ScheduledWorkout[] => {
      const id = jsonString(row, "id");
      const programId = jsonString(row, "program_id", "programId");
      const versionId = jsonString(row, "program_version_id", "programVersionId");
      const programTitle = jsonString(row, "program_title", "programTitle");
      const workoutId = jsonString(row, "workout_id", "workoutId");
      const workoutTitle = jsonString(row, "workout_title", "workoutTitle");
      const plannedDate = jsonString(row, "planned_date", "plannedDate");
      const status = jsonString(row, "status");
      if (
        !id ||
        !programId ||
        !versionId ||
        !programTitle ||
        !workoutId ||
        !workoutTitle ||
        !plannedDate ||
        (status !== "planned" &&
          status !== "in_progress" &&
          status !== "completed" &&
          status !== "skipped")
      ) {
        return [];
      }
      const sequenceNumber =
        jsonInteger(row, "sequence_number", "sequenceNumber") ?? 0;
      const assignmentId =
        jsonNullableString(row, "assignment_id", "assignmentId") ?? undefined;
      return [
        {
          id,
          assignmentId,
          programRunId:
            jsonNullableString(row, "program_run_id", "programRunId") ??
            undefined,
          programRunWorkoutId:
            jsonNullableString(
              row,
              "program_run_workout_id",
              "programRunWorkoutId",
            ) ?? undefined,
          programId,
          programTitle,
          programVersionId: versionId,
          workoutId,
          workoutTitle,
          slotLabel: `${programTitle} · ${workoutTitle}`,
          plannedDate,
          sequenceNumber,
          status,
          sourceType: scheduledWorkoutSourceType(
            row,
            assignmentId,
            this.viewerId,
          ),
          workout: {
            id: workoutId,
            programVersionId: versionId,
            scheduledWorkoutId: id,
            plannedDate,
            title: workoutTitle,
            dayLabel: `Session ${sequenceNumber || 1}`,
            durationMinutes: 45,
            sections: [],
          },
          detailsLoaded: false,
        },
      ];
    });
    const last = visibleRows.at(-1);
    const nextCursor =
      rows.length > limit && last
        ? {
            plannedDate:
              jsonString(last, "planned_date", "plannedDate") ?? "",
            id: jsonString(last, "id") ?? "",
          }
        : undefined;
    return {
      items,
      hasMore: Boolean(nextCursor?.plannedDate && nextCursor.id),
      ...(nextCursor?.plannedDate && nextCursor.id ? { nextCursor } : {}),
    };
  }

  /**
   * Pages every current/future occurrence for Next with a stable date/id
   * cursor. The bootstrap intentionally remains tiny; this is the complete,
   * lazy path for larger training calendars.
   */
  async listUpcomingScheduledWorkouts(
    options: CalendarPageOptions = {},
  ): Promise<CursorPage<ScheduledWorkout, CalendarCursor>> {
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 20), 1), 99);
    const cursorKey = options.cursor
      ? `${options.cursor.plannedDate}:${options.cursor.id}`
      : "first";
    return this.queryCache.getOrLoad(
      `upcoming-schedule-page:${limit}:${cursorKey}`,
      async () => {
        const result = await this.client.rpc(
          "list_upcoming_scheduled_workouts",
          {
            page_limit: limit + 1,
            after_planned_date: options.cursor?.plannedDate ?? null,
            after_id: options.cursor?.id ?? null,
          },
        );
        if (result.error)
          fail("Could not load your upcoming workouts", result.error);
        const rows = jsonRecords(result.data);
        const visibleRows = rows.slice(0, limit);
        const items = visibleRows
          .map((row) => parseScheduledWorkoutSummary(row, this.viewerId))
          .filter((item): item is ScheduledWorkout => item !== null);
        const last = visibleRows.at(-1);
        const nextCursor =
          rows.length > limit && last
            ? {
                plannedDate:
                  jsonString(last, "planned_date", "plannedDate") ?? "",
                id: jsonString(last, "id") ?? "",
              }
            : undefined;
        return {
          items,
          hasMore: Boolean(nextCursor?.plannedDate && nextCursor.id),
          ...(nextCursor?.plannedDate && nextCursor.id ? { nextCursor } : {}),
        };
      },
      { ttlMs: 15_000 },
    );
  }

  async listCalendarSessionSummaries(
    rangeStart: string,
    rangeEnd: string,
    limit = 100,
  ): Promise<CompletedSession[]> {
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 200);
    return collectCursorPages<CompletedSession, CalendarCursor>(
      "Could not load completed workouts for your calendar",
      async (cursor) => {
        const result = await this.client.rpc("list_calendar_session_summaries", {
          range_start: rangeStart,
          range_end: rangeEnd,
          page_limit: boundedLimit,
          ...(cursor ? {
            after_completed_for_date: cursor.plannedDate,
            after_id: cursor.id,
          } : {}),
        });
        if (result.error)
          fail("Could not load completed workouts for your calendar", result.error);
        const rows = jsonRecords(result.data);
        const last = rows.at(-1);
        return {
          items: rows.flatMap((row): CompletedSession[] => {
            const session = parseSessionRow(row);
            return session ? [mapCompletedSession(session)] : [];
          }),
          hasMore: rows.length >= boundedLimit,
          nextCursor: last ? {
            plannedDate: jsonString(last, "completed_for_date", "completedForDate") ?? "",
            id: jsonString(last, "id") ?? "",
          } : undefined,
        };
      },
    );
  }

  async listSchedulableWorkouts(
    options: SchedulableWorkoutPageOptions = {},
  ): Promise<CursorPage<SchedulableWorkoutCandidate, SchedulableWorkoutCursor>> {
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), 99);
    const result = await this.client.rpc("list_schedulable_workouts", {
      page_limit: limit + 1,
      after_program_title: options.cursor?.programTitle ?? null,
      after_week_index: options.cursor?.weekIndex ?? null,
      after_workout_position: options.cursor?.workoutPosition ?? null,
      after_id: options.cursor?.id ?? null,
    });
    if (result.error)
      fail("Could not load workouts available to schedule", result.error);
    const rows = jsonRecords(result.data);
    const visibleRows = rows.slice(0, limit);
    const items = visibleRows.flatMap((row): SchedulableWorkoutCandidate[] => {
      const candidate = parseSchedulableWorkoutCandidate(row);
      return candidate ? [candidate] : [];
    });
    const last = visibleRows.at(-1);
    const nextCursor =
      rows.length > limit && last
        ? {
            programTitle:
              jsonString(last, "program_title", "programTitle") ?? "",
            weekIndex: jsonInteger(last, "week_index", "weekIndex") ?? 0,
            workoutPosition:
              jsonInteger(last, "workout_position", "workoutPosition") ?? 0,
            id: jsonString(last, "workout_id", "workoutId") ?? "",
          }
        : undefined;
    return {
      items,
      hasMore: Boolean(nextCursor?.programTitle && nextCursor.id),
      ...(nextCursor?.programTitle && nextCursor.id ? { nextCursor } : {}),
    };
  }

  async listFrequentSchedulableWorkouts(
    limit = 6,
  ): Promise<FrequentSchedulableWorkoutCandidate[]> {
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 12);
    const result = await this.client.rpc("list_frequent_schedulable_workouts", {
      page_limit: boundedLimit,
    });
    if (result.error)
      fail("Could not load frequently used workouts", result.error);
    return jsonRecords(result.data).flatMap(
      (row): FrequentSchedulableWorkoutCandidate[] => {
        const candidate = parseSchedulableWorkoutCandidate(row);
        const usageCount = jsonInteger(row, "usage_count", "usageCount");
        const lastUsedAt = jsonString(row, "last_used_at", "lastUsedAt");
        if (
          !candidate?.isQuickWorkout ||
          usageCount === undefined ||
          usageCount < 1 ||
          !lastUsedAt
        )
          return [];
        return [{ ...candidate, usageCount, lastUsedAt }];
      },
    );
  }

  async listCompletedSessionSummaries(
    options: HistoryPageOptions = {},
  ): Promise<CursorPage<CompletedSession, HistoryCursor>> {
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), 99);
    const result = await this.client.rpc("list_completed_session_summaries", {
      page_limit: limit + 1,
      before_started_at: options.cursor?.startedAt ?? null,
      before_id: options.cursor?.id ?? null,
    });
    if (result.error) fail("Could not load training history", result.error);
    const rows = jsonRecords(result.data);
    const visibleRows = rows.slice(0, limit);
    const items = visibleRows.flatMap((row): CompletedSession[] => {
      const parsed = parseSessionRow(row);
      return parsed ? [mapCompletedSession(parsed)] : [];
    });
    const last = visibleRows.at(-1);
    const nextCursor =
      rows.length > limit && last
        ? {
            startedAt: jsonString(last, "started_at", "startedAt") ?? "",
            id: jsonString(last, "id") ?? "",
          }
        : undefined;
    return {
      items,
      hasMore: Boolean(nextCursor?.startedAt && nextCursor.id),
      ...(nextCursor?.startedAt && nextCursor.id ? { nextCursor } : {}),
    };
  }

  async listCoachCompletedHistory(
    athleteId: string,
    options: HistoryPageOptions = {},
  ): Promise<CursorPage<CoachAgendaEntry, HistoryCursor>> {
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 25), 1), 99);
    const result = await this.client.rpc(
      "list_authored_coach_session_summaries",
      {
        target_athlete_id: athleteId,
        target_limit: limit + 1,
        target_before_started_at: options.cursor?.startedAt ?? null,
        target_before_id: options.cursor?.id ?? null,
      },
    );
    if (result.error) fail("Could not load the athlete's workout history", result.error);
    const rows = jsonRecords(result.data);
    const visibleRows = rows.slice(0, limit);
    const items = visibleRows
      .map(parseCoachCompletedAgendaEntry)
      .filter((entry): entry is CoachAgendaEntry => entry !== null);
    const last = visibleRows.at(-1);
    const nextCursor =
      rows.length > limit && last
        ? {
            startedAt: jsonString(last, "startedAt", "started_at") ?? "",
            id: jsonString(last, "id") ?? "",
          }
        : undefined;
    return {
      items,
      hasMore: Boolean(nextCursor?.startedAt && nextCursor.id),
      ...(nextCursor?.startedAt && nextCursor.id ? { nextCursor } : {}),
    };
  }

  async searchExercises(
    options: ExerciseSearchOptions = {},
  ): Promise<CursorPage<Exercise, ExerciseCursor>> {
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), 99);
    const result = await this.client.rpc("search_exercises", {
      search_text: options.query?.trim() ?? "",
      scope_filter: options.scope ?? "all",
      discipline_filters: options.disciplines?.length
        ? options.disciplines
        : null,
      category_filters: options.categories?.length ? options.categories : null,
      mode_filters: options.modes?.length ? options.modes : null,
      tracking_filters: options.tracking?.length ? options.tracking : null,
      page_limit: limit + 1,
      after_name: options.cursor?.name ?? null,
      after_id: options.cursor?.id ?? null,
    });
    if (result.error) fail("Could not load the exercise library", result.error);
    const rows = jsonRecords(result.data);
    const visibleRows = rows.slice(0, limit);
    const items = visibleRows.flatMap((row): Exercise[] => {
      const id = jsonString(row, "id");
      const scope = jsonString(row, "scope");
      const name = jsonString(row, "name");
      if (!id || (scope !== "global" && scope !== "personal") || !name) return [];
      return [
        mapExercise(
          {
            id,
            scope,
            owner_id: jsonNullableString(row, "owner_id", "ownerId"),
            name,
            category: jsonString(row, "category") ?? "General",
            discipline:
              jsonString(row, "discipline") === "weightlifting" ||
              jsonString(row, "discipline") === "gym" ||
              jsonString(row, "discipline") === "functional"
                ? (jsonString(row, "discipline") as Exercise["discipline"])
                : undefined,
            tags: jsonStringArray(jsonField(row, "tags")),
            source_provider:
              jsonNullableString(row, "source_provider", "sourceProvider"),
            source_external_id:
              jsonNullableString(
                row,
                "source_external_id",
                "sourceExternalId",
              ),
            source_url: jsonNullableString(row, "source_url", "sourceUrl"),
            video_url: jsonNullableString(row, "video_url", "videoUrl"),
            cue: jsonString(row, "cue") ?? "",
            default_entry_mode: parseEntryMode(
              jsonField(row, "default_entry_mode", "defaultEntryMode"),
            ),
            default_tracking_fields: parseTrackingFields(
              jsonField(
                row,
                "default_tracking_fields",
                "defaultTrackingFields",
              ),
            ),
          },
          this.viewerName,
        ),
      ];
    });
    const last = visibleRows.at(-1);
    const nextCursor =
      rows.length > limit && last
        ? {
            name: jsonString(last, "name") ?? "",
            id: jsonString(last, "id") ?? "",
          }
        : undefined;
    return {
      items,
      hasMore: Boolean(nextCursor?.name && nextCursor.id),
      ...(nextCursor?.name && nextCursor.id ? { nextCursor } : {}),
    };
  }

  async listCoachAthletes(
    options: CoachAthletePageOptions = {},
  ): Promise<CursorPage<AthleteSummary, CoachAthleteCursor>> {
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 25), 1), 49);
    const result = await this.client.rpc("list_coach_athletes", {
      page_limit: limit + 1,
      after_display_name: options.cursor?.displayName ?? null,
      after_id: options.cursor?.id ?? null,
    });
    if (result.error) fail("Could not load coached athletes", result.error);
    const rows = jsonRecords(result.data);
    const visibleRows = rows.slice(0, limit);
    const items = visibleRows.flatMap((row): AthleteSummary[] => {
      const id = jsonString(row, "id");
      const displayName = jsonString(row, "display_name", "displayName");
      if (!id || !displayName) return [];
      return [
        {
          id,
          relationshipId:
            jsonNullableString(row, "relationship_id", "relationshipId") ??
            undefined,
          name: displayName,
          initials: initials(displayName),
          assignedProgramCount:
            numberValue(
              jsonNumeric(row, "assigned_program_count", "assignedProgramCount"),
            ) ?? 0,
          detailsLoaded: false,
          assignedPrograms: [],
          agenda: [],
        },
      ];
    });
    const last = visibleRows.at(-1);
    const nextCursor =
      rows.length > limit && last
        ? {
            displayName:
              jsonString(last, "display_name", "displayName") ?? "",
            id: jsonString(last, "id") ?? "",
          }
        : undefined;
    return {
      items,
      hasMore: Boolean(nextCursor?.displayName && nextCursor.id),
      ...(nextCursor?.displayName && nextCursor.id ? { nextCursor } : {}),
    };
  }

  invalidatePrograms(programId?: string) {
    this.queryCache.invalidate("program-page:");
    if (programId) {
      this.queryCache.invalidate(`program-detail:program:${programId}:`);
    } else {
      this.queryCache.invalidate("program-detail:");
      this.programSelectors.clear();
    }
    this.queryCache.delete("bootstrap");
  }

  private invalidateCalendarMutation(scheduleId?: string) {
    this.queryCache.invalidate("feature:calendar:");
    this.queryCache.invalidate("upcoming-schedule-page:");
    this.queryCache.invalidate("schedulable-page:");
    this.queryCache.invalidate(
      scheduleId ? `schedule-detail:${scheduleId}` : "schedule-detail:",
    );
    this.queryCache.delete("bootstrap");
  }

  private invalidateProgramRunProgress(runId?: string) {
    this.queryCache.invalidate("program-runs:");
    this.queryCache.invalidate("coach-athlete:");
    this.queryCache.invalidate("feature:coaching:");
    this.queryCache.invalidate(
      runId ? `program-run-detail:${runId}` : "program-run-detail:",
    );
    this.invalidateCalendarMutation();
  }

  private invalidateProgramRunMutation(runId?: string) {
    this.invalidateProgramRunProgress(runId);
    this.queryCache.invalidate(
      runId ? `program-run-content:${runId}` : "program-run-content:",
    );
    this.invalidatePrograms();
  }

  private invalidateCoachingMutation(accessChanged = false) {
    if (accessChanged) {
      // Cached immutable content still depends on a mutable access grant.
      this.programSelectors.clear();
      this.queryCache.clear();
      return;
    }
    this.queryCache.invalidate("feature:coaching:");
    this.queryCache.delete("bootstrap");
  }

  async loadCalendarWorkspace(): Promise<CalendarWorkspaceData> {
    const today = localDateOnly();
    return this.loadCalendarRange(shiftDateOnly(today, -31), shiftDateOnly(today, 61));
  }

  async loadCalendarRange(
    rangeStart: string,
    rangeEnd: string,
  ): Promise<CalendarWorkspaceData> {
    return this.queryCache.getOrLoad(
      `feature:calendar:${rangeStart}:${rangeEnd}`,
      async () => {
        const [scheduledWorkouts, completedSessions] = await Promise.all([
          collectCursorPages<ScheduledWorkout, CalendarCursor>(
            "Could not load your calendar",
            (cursor) => this.listCalendarOccurrences(rangeStart, rangeEnd, { limit: 100, cursor }),
          ),
          this.listCalendarSessionSummaries(rangeStart, rangeEnd),
        ]);
        return {
          scheduledWorkouts,
          completedSessions,
        };
      },
      { ttlMs: 15_000 },
    );
  }

  async loadCoachingWorkspace(): Promise<CoachingWorkspaceData> {
    return this.queryCache.getOrLoad("feature:coaching:workspace", async () => {
      const startedAt = performance.now();
      try {
        const [access, athletePage] = await Promise.all([
          this.loadCoachingAccessSummary(),
          this.listCoachAthletes({ limit: 25 }),
        ]);
        return {
          ...access,
          coachedAthletes: athletePage.items,
          ...(athletePage.nextCursor
            ? { coachAthleteCursor: athletePage.nextCursor }
            : {}),
        };
      } finally {
        recordClientPerformance("navigation", startedAt, { phase: "repository" });
      }
    }, { shouldCache: () => false });
  }

  async loadProgramDetail(
    _athleteId: string,
    programId: string,
    versionId?: string,
    assignmentId?: string,
  ): Promise<Program | null> {
    const inferred =
      assignmentId === undefined
        ? this.programSelectors.get(`${programId}:${versionId ?? ""}`) ??
          this.programSelectors.get(programId)
        : undefined;
    const selectedAssignmentId = assignmentId ?? inferred?.assignmentId;
    return this.getProgramVersionDetail(
      selectedAssignmentId
        ? { assignmentId: selectedAssignmentId, versionId }
        : { programId: inferred?.programId ?? programId, versionId },
    );
  }

  async getProgramVersionDetail(selector: {
    programId?: string;
    assignmentId?: string;
    versionId?: string;
  }): Promise<Program | null> {
    if (Boolean(selector.programId) === Boolean(selector.assignmentId)) {
      throw new Error("Choose exactly one program or assignment");
    }
    const selectorKind = selector.assignmentId ? "assignment" : "program";
    const selectorId = selector.assignmentId ?? selector.programId!;
    return this.queryCache.getOrLoad(
      `program-detail:${selectorKind}:${selectorId}:${selector.versionId ?? "selected"}`,
      async () => {
        const result = await this.client.rpc("get_program_version_detail", {
          target_program_id: selector.assignmentId
            ? null
            : selector.programId ?? null,
          target_assignment_id: selector.assignmentId ?? null,
          target_version_id: selector.versionId ?? null,
        });
        if (result.error)
          fail("Could not load the training program", result.error);
        return parseProgramDetailPayload(
          result.data,
          this.viewerId,
          this.viewerName,
        );
      },
      {
        // A selected/current version is a mutable pointer; only an explicit
        // version ID identifies an immutable snapshot.
        ttlMs: selector.versionId ? Infinity : 30_000,
        shouldCache: (value) => value !== null && value.versionStatus !== "draft",
      },
    );
  }

  async loadProgramForAthleteById(
    _athleteId: string,
    programId: string,
    assignmentId?: string,
  ): Promise<Program | null> {
    const inferred = this.programSelectors.get(programId);
    const selectedAssignmentId = assignmentId ?? inferred?.assignmentId;
    return this.getProgramVersionDetail(
      selectedAssignmentId
        ? { assignmentId: selectedAssignmentId }
        : { programId: inferred?.programId ?? programId },
    );
  }

  async loadProgramVersionForAthleteById(
    _athleteId: string,
    programId: string,
    versionId: string,
    assignmentId?: string,
  ): Promise<Program | null> {
    const inferred = this.programSelectors.get(programId);
    const selectedAssignmentId = assignmentId ?? inferred?.assignmentId;
    return this.getProgramVersionDetail(
      selectedAssignmentId
        ? { assignmentId: selectedAssignmentId, versionId }
        : { programId: inferred?.programId ?? programId, versionId },
    );
  }

  async loadOwnScheduledProgramVersionById(
    programId: string,
    versionId: string,
    assignmentId?: string,
  ): Promise<Program | null> {
    const inferred = this.programSelectors.get(`${programId}:${versionId}`) ??
      this.programSelectors.get(programId);
    const selectedAssignmentId = assignmentId ?? inferred?.assignmentId;
    return this.getProgramVersionDetail(
      selectedAssignmentId
        ? { assignmentId: selectedAssignmentId, versionId }
        : { programId: inferred?.programId ?? programId, versionId },
    );
  }

  async loadEditableProgram(
    _athleteId: string,
    programId: string,
    assignmentId?: string,
  ) {
    const inferred =
      assignmentId === undefined
        ? this.programSelectors.get(programId)?.assignmentId
        : assignmentId;
    const program = await this.getProgramVersionDetail(
      inferred ? { assignmentId: inferred } : { programId },
    );
    if (program?.versionStatus === "draft") return program;
    throw new Error("This content is locked. Duplicate it to make changes.");
  }

  private async syncTimezoneIfChanged(savedTimezone: string | null) {
    const currentTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!currentTimezone || currentTimezone === savedTimezone) return;
    await this.client
      .from("profiles")
      .update({ timezone: currentTimezone })
      .eq("id", this.viewerId);
  }

  async loadScheduledWorkoutDetail(
    scheduleId: string,
  ): Promise<ScheduledWorkout | null> {
    return this.queryCache.getOrLoad(
      `schedule-detail:${scheduleId}`,
      async () => {
        const result = await this.client.rpc("get_scheduled_workout_detail", {
          target_schedule_id: scheduleId,
        });
        if (result.error)
          fail("Could not load the scheduled workout", result.error);
        const row = firstJsonRecord(result.data);
        if (!row) return null;
        const id = jsonString(row, "id");
        const programId = jsonString(row, "programId", "program_id");
        const versionId = jsonString(
          row,
          "programVersionId",
          "program_version_id",
        );
        const programTitle = jsonString(row, "programTitle", "program_title");
        const workoutId = jsonString(row, "workoutId", "workout_id");
        const status = jsonString(row, "status");
        if (
          !id ||
          !programId ||
          !versionId ||
          !programTitle ||
          !workoutId ||
          (status !== "planned" &&
            status !== "in_progress" &&
            status !== "completed" &&
            status !== "skipped")
        ) {
          return null;
        }
        const plannedDate =
          jsonNullableString(row, "plannedDate", "planned_date") ?? undefined;
        const sequenceNumber =
          jsonInteger(row, "sequenceNumber", "sequence_number") ?? 0;
        const workout = parseWorkoutPayload(
          jsonField(row, "workout"),
          versionId,
          { id, plannedDate, sequenceNumber },
        );
        if (!workout) return null;
        const assignmentId =
          jsonNullableString(row, "assignmentId", "assignment_id") ?? undefined;
        return {
          id,
          assignmentId,
          programRunId:
            jsonNullableString(row, "programRunId", "program_run_id") ??
            undefined,
          programRunWorkoutId:
            jsonNullableString(
              row,
              "programRunWorkoutId",
              "program_run_workout_id",
            ) ?? undefined,
          programId,
          programTitle,
          programVersionId: versionId,
          workoutId,
          workoutTitle: workout.title,
          slotLabel: `${programTitle} · ${workout.title}`,
          plannedDate,
          sequenceNumber,
          status,
          sourceType: scheduledWorkoutSourceType(
            row,
            assignmentId,
            this.viewerId,
          ),
          workout,
          detailsLoaded: true,
        };
      },
      { ttlMs: 15_000, shouldCache: (value) => value !== null },
    );
  }
  async updateOwnProfile(
    firstName: string,
    lastName: string,
    weekStartsOnSunday: boolean,
    weightUnit: OwnProfile["weightUnit"],
    distanceUnit: OwnProfile["distanceUnit"],
  ): Promise<OwnProfile> {
    const result = await this.client.rpc("update_own_profile", {
      target_first_name: firstName,
      target_last_name: lastName,
      target_week_starts_on_sunday: weekStartsOnSunday,
      target_weight_unit: weightUnit,
      target_distance_unit: distanceUnit,
    });
    if (result.error || !result.data)
      fail("Could not update your account", result.error);
    this.queryCache.delete("bootstrap");
    return result.data as OwnProfile;
  }

  async createBlankProgram(athleteId: string, title: string) {
    const result = await this.client.rpc("create_blank_program", {
      target_athlete_id: athleteId,
      target_title: title,
    });
    if (result.error || !result.data)
      fail("Could not create the program", result.error);
    this.invalidatePrograms();
    return String(result.data);
  }

  async createBlankQuickWorkout(title: string) {
    const result = await this.client.rpc("create_blank_quick_workout", {
      target_title: title,
    });
    if (result.error || !result.data)
      fail("Could not create the workout", result.error);
    this.invalidatePrograms();
    return String(result.data);
  }

  async updateProgramDescription(programId: string, description: string) {
    const result = await this.client
      .from("programs")
      .update({ description })
      .eq("id", programId)
      .select("id")
      .single();
    if (result.error || !result.data)
      fail("Could not save the program description", result.error);
    this.invalidatePrograms(programId);
  }

  async updateProgramTitle(programId: string, title: string) {
    const result = await this.client
      .from("programs")
      .update({ title })
      .eq("id", programId)
      .select("id")
      .single();
    if (result.error || !result.data)
      fail("Could not save the program name", result.error);
    this.invalidatePrograms(programId);
  }

  async createProgramFromTemplate(templateId: string) {
    const result = await this.client.rpc("create_program_from_template", {
      target_template_id: templateId,
    });
    if (result.error || !result.data)
      fail("Could not start the library program", result.error);
    this.invalidateProgramRunMutation();
    return String(result.data);
  }

  async deleteOwnProgram(programId: string) {
    const result = await this.client.rpc("delete_own_program", {
      target_program_id: programId,
    });
    if (result.error) fail("Could not delete the program", result.error);
    this.invalidateProgramRunMutation();
  }

  async copyProgramToOwn(programId: string) {
    const result = await this.client.rpc("copy_program_to_own", {
      target_program_id: programId,
    });
    if (result.error || !result.data)
      fail("Could not duplicate the content", result.error);
    this.invalidatePrograms();
    return String(result.data);
  }

  async copyProgramRunToOwn(runId: string) {
    const result = await this.client.rpc("copy_program_run_to_own", {
      target_run_id: runId,
    });
    if (result.error || !result.data)
      fail("Could not duplicate the assigned plan", result.error);
    const programId = String(result.data);
    this.invalidatePrograms(programId);
    return programId;
  }

  async createProgramRuns(
    programId: string,
    athleteIds: string[],
    workoutDates: ProgramRunWorkoutDate[] = [],
    idempotencyKey: string = crypto.randomUUID(),
    repeatedFromRunId?: string,
  ): Promise<ProgramRunMutation[]> {
    const uniqueAthleteIds = Array.from(new Set(athleteIds));
    if (!uniqueAthleteIds.length) throw new Error("Choose at least one athlete");
    const result = await this.client.rpc("create_program_runs", {
      target_program_id: programId,
      target_athlete_ids: uniqueAthleteIds,
      target_workout_dates: workoutDates.map((date) => ({
        workoutId: date.workoutId,
        plannedDate: date.plannedDate ?? null,
      })),
      target_idempotency_key: idempotencyKey,
      target_repeated_from_run_id: repeatedFromRunId ?? null,
    });
    if (result.error) fail("Could not start the program", result.error);
    const mutations = jsonRecords(result.data).flatMap((row) => {
      const athleteId = jsonString(row, "athleteId", "athlete_id");
      const runId = jsonString(row, "runId", "run_id");
      const returnedProgramId = jsonString(row, "programId", "program_id");
      const programVersionId = jsonString(
        row,
        "programVersionId",
        "program_version_id",
      );
      return athleteId && runId && returnedProgramId && programVersionId
        ? [{
            athleteId,
            runId,
            programId: returnedProgramId,
            programVersionId,
            created: jsonBoolean(row, "created") ?? false,
          } satisfies ProgramRunMutation]
        : [];
    });
    if (!mutations.length) fail("Could not start the program", null);
    this.invalidateProgramRunMutation();
    return mutations;
  }

  /**
   * Calendar one-off scheduling is deliberately limited to reusable quick
   * workouts. It still creates a normal run so self and coach history share
   * one lifecycle model.
   */
  async createScheduledQuickWorkoutRun(
    programId: string,
    plannedDate: string,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<ScheduledWorkout> {
    const source = await this.loadEditableProgram(this.viewerId, programId);
    const workouts = source.weeks.flatMap((week) => week.workouts);
    if (source.contentType !== "quick_workout" || workouts.length !== 1) {
      throw new Error("Choose a reusable quick workout for a calendar date.");
    }
    const [created] = await this.createProgramRuns(
      programId,
      [this.viewerId],
      [{ workoutId: workouts[0].id, plannedDate }],
      idempotencyKey,
    );
    if (!created) fail("Could not schedule the workout", null);
    const run = await this.loadProgramRunDetail(created.runId);
    const scheduleId = run?.workouts[0]?.scheduledWorkoutId;
    if (!scheduleId) fail("Could not load the scheduled workout", null);
    const schedule = await this.loadScheduledWorkoutDetail(scheduleId);
    if (!schedule) fail("Could not load the scheduled workout", null);
    return schedule;
  }

  async repeatProgramRun(
    runId: string,
    workoutDates: ProgramRunWorkoutDate[] = [],
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<ProgramRunMutation> {
    const result = await this.client.rpc("repeat_program_run", {
      target_run_id: runId,
      target_workout_dates: workoutDates.map((date) => ({
        workoutId: date.workoutId,
        plannedDate: date.plannedDate ?? null,
      })),
      target_idempotency_key: idempotencyKey,
    });
    if (result.error) fail("Could not repeat the program", result.error);
    const row = firstJsonRecord(result.data);
    const athleteId = row ? jsonString(row, "athleteId", "athlete_id") : undefined;
    const createdRunId = row ? jsonString(row, "runId", "run_id") : undefined;
    const programId = row ? jsonString(row, "programId", "program_id") : undefined;
    const programVersionId = row
      ? jsonString(row, "programVersionId", "program_version_id")
      : undefined;
    if (!row || !athleteId || !createdRunId || !programId || !programVersionId)
      fail("Could not repeat the program", null);
    this.invalidateProgramRunMutation(createdRunId);
    return {
      athleteId,
      runId: createdRunId,
      programId,
      programVersionId,
      created: jsonBoolean(row, "created") ?? false,
    };
  }

  async scheduleProgramRunWorkouts(
    runId: string,
    workoutDates: ProgramRunWorkoutDate[],
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<ProgramRunDetail | null> {
    const result = await this.client.rpc("schedule_program_run_workouts", {
      target_run_id: runId,
      target_workout_dates: workoutDates.map((date) => ({
        workoutId: date.workoutId,
        plannedDate: date.plannedDate ?? null,
      })),
      target_idempotency_key: idempotencyKey,
    });
    if (result.error) fail("Could not schedule the program", result.error);
    this.invalidateProgramRunMutation(runId);
    return parseProgramRunDetail(result.data) ?? this.loadProgramRunDetail(runId);
  }

  async endProgramRun(runId: string): Promise<void> {
    const result = await this.client.rpc("end_program_run", {
      target_run_id: runId,
    });
    if (result.error) fail("Could not end the program", result.error);
    this.invalidateProgramRunMutation(runId);
  }

  async updateProgramRunWorkoutOverrides(
    runWorkoutId: string,
    overrides: Record<string, unknown>,
  ): Promise<ProgramRunDetail | null> {
    const result = await this.client.rpc(
      "update_program_run_workout_overrides",
      {
        target_program_run_workout_id: runWorkoutId,
        target_overrides: overrides,
      },
    );
    if (result.error) fail("Could not adjust the workout", result.error);
    const detail = parseProgramRunDetail(result.data);
    const returnedRunId =
      detail?.id ??
      jsonString(firstJsonRecord(result.data) ?? {}, "runId", "run_id");
    this.invalidateProgramRunMutation(returnedRunId);
    return detail ?? (returnedRunId
      ? await this.loadProgramRunDetail(returnedRunId)
      : null);
  }

  async deleteWorkout(workoutId: string) {
    const result = await this.client.rpc("delete_program_workout", {
      target_workout_id: workoutId,
    });
    if (result.error) fail("Could not delete the workout", result.error);
    this.invalidatePrograms();
  }

  async reorderWorkouts(program: Program, workoutIds: string[]) {
    const week = implicitProgramWeek(program);
    if (!week || program.weeks.length !== 1)
      fail("The program workout sequence is unavailable", null);
    const result = await this.client.rpc("reorder_week_workouts", {
      target_week_id: week.id,
      ordered_ids: workoutIds,
    });
    if (result.error) fail("Could not reorder workouts", result.error);
    this.invalidatePrograms(program.id);
  }

  async reorderWorkoutItems(workoutId: string, itemIds: string[]) {
    const result = await this.client.rpc("reorder_workout_items", {
      target_workout_id: workoutId,
      ordered_ids: itemIds,
    });
    if (result.error) fail("Could not reorder exercises", result.error);
    this.invalidatePrograms();
  }

  async scheduleWorkout(
    scheduledWorkoutId: string,
    plannedDate: string | null,
  ) {
    const result = await this.client.rpc("schedule_workout", {
      target_scheduled_workout_id: scheduledWorkoutId,
      target_planned_date: plannedDate || null,
    });
    if (result.error) fail("Could not update the workout date", result.error);
    this.invalidateProgramRunProgress();
    this.queryCache.invalidate(`schedule-detail:${scheduledWorkoutId}`);
  }

  async unassignProgram(assignmentId: string): Promise<void> {
    const result = await this.client.rpc("unassign_program_assignment", {
      target_assignment_id: assignmentId,
    });
    if (result.error) fail("Could not unassign the program", result.error);
    this.queryCache.invalidate("coach-athlete:");
    this.queryCache.invalidate("feature:coaching:");
    this.queryCache.invalidate("program-page:");
    this.queryCache.invalidate(`program-detail:assignment:${assignmentId}:`);
    this.invalidateCalendarMutation();
    this.queryCache.delete("bootstrap");
  }

  async setScheduledWorkoutStatus(
    scheduledWorkoutId: string,
    status: "planned" | "skipped",
  ) {
    const result = await this.client.rpc("set_scheduled_workout_status", {
      target_scheduled_workout_id: scheduledWorkoutId,
      target_status: status,
    });
    if (result.error)
      fail("Could not update the scheduled workout", result.error);
    this.invalidateProgramRunProgress();
    this.queryCache.invalidate(`schedule-detail:${scheduledWorkoutId}`);
  }

  async deactivateProgram(programId: string) {
    const result = await this.client.rpc("deactivate_current_program", {
      target_program_id: programId,
    });
    if (result.error)
      fail("Could not deactivate the current program", result.error);
    this.invalidateProgramRunMutation();
  }

  async createPersonalExercise(input: CreateExerciseInput) {
    const fields = trackingFieldsForMode(input.mode, input.fields);
    const result = await this.client
      .from("exercises")
      .insert({
        scope: "personal",
        owner_id: this.viewerId,
        name: input.name,
        category: input.category || "Custom",
        discipline: input.discipline ?? null,
        tags: input.tags ?? [],
        source_provider: input.sourceProvider ?? null,
        source_external_id: input.sourceExternalId ?? null,
        source_url: input.sourceUrl ?? null,
        video_url: input.videoUrl ?? null,
        cue: input.cue,
        default_entry_mode: input.mode,
        default_tracking_fields: fields,
      })
      .select(
        "id, scope, owner_id, name, category, discipline, tags, source_provider, source_external_id, source_url, video_url, cue, default_entry_mode, default_tracking_fields",
      )
      .single();
    if (result.error || !result.data)
      fail("Could not save the exercise", result.error);
    this.queryCache.delete("feature:exercises");
    return mapExercise(result.data as ExerciseRow, this.viewerName);
  }

  async updatePersonalExercise(
    exerciseId: string,
    input: CreateExerciseInput,
  ) {
    const fields = trackingFieldsForMode(input.mode, input.fields);
    const result = await this.client
      .from("exercises")
      .update({
        name: input.name,
        category: input.category || "Custom",
        discipline: input.discipline ?? null,
        tags: input.tags ?? [],
        source_provider: input.sourceProvider ?? null,
        source_external_id: input.sourceExternalId ?? null,
        source_url: input.sourceUrl ?? null,
        video_url: input.videoUrl ?? null,
        cue: input.cue,
        default_entry_mode: input.mode,
        default_tracking_fields: fields,
      })
      .eq("id", exerciseId)
      .eq("scope", "personal")
      .eq("owner_id", this.viewerId)
      .select(
        "id, scope, owner_id, name, category, discipline, tags, source_provider, source_external_id, source_url, video_url, cue, default_entry_mode, default_tracking_fields",
      )
      .maybeSingle();
    if (result.error || !result.data)
      fail("Could not update the exercise", result.error);
    this.queryCache.delete("feature:exercises");
    return mapExercise(result.data as ExerciseRow, this.viewerName);
  }

  async deletePersonalExercise(exerciseId: string) {
    const result = await this.client
      .from("exercises")
      .delete({ count: "exact" })
      .eq("id", exerciseId)
      .eq("scope", "personal")
      .eq("owner_id", this.viewerId);
    if (result.error) fail("Could not delete the exercise", result.error);
    if (result.count !== 1) {
      fail(
        "Could not delete the exercise because it no longer exists or is not owned by this account",
        null,
      );
    }
    this.queryCache.delete("feature:exercises");
  }

  async addWorkout(
    program: Program,
    title: string,
  ): Promise<PlannedWorkout> {
    const week = implicitProgramWeek(program);
    if (!week || program.weeks.length !== 1)
      fail("The program workout sequence is unavailable", null);
    const result = await this.client.rpc("append_program_workout", {
      target_week_id: week.id,
      target_title: title,
    });
    if (result.error) fail("Could not add the workout", result.error);
    const workout = parseWorkoutPayload(result.data, program.versionId);
    if (!workout || workout.sections.length !== 1)
      fail("Could not add the workout", null);
    this.invalidatePrograms();
    return workout;
  }

  async updateWorkout(
    workoutId: string,
    title: string,
    durationMinutes: number,
  ) {
    const result = await this.client
      .from("workouts")
      .update({
        title,
        estimated_minutes: durationMinutes,
      })
      .eq("id", workoutId)
      .select("id")
      .single();
    if (result.error || !result.data)
      fail("Could not update the workout", result.error);
    this.invalidatePrograms();
  }

  async addWorkoutItem(
    section: WorkoutSection,
    exercise: Exercise,
  ): Promise<WorkoutItem> {
    const result = await this.client.rpc("append_workout_exercise", {
      target_section_id: section.id,
      target_exercise_id: exercise.id,
    });
    if (result.error)
      fail("Could not add the exercise to the workout", result.error);
    const item = parseWorkoutItemPayload(result.data);
    if (!item) fail("Could not add the exercise to the workout", null);
    this.invalidatePrograms();
    return item;
  }

  async removeWorkoutItem(itemId: string) {
    const result = await this.client.rpc("delete_workout_item", {
      target_item_id: itemId,
    });
    if (result.error) fail("Could not remove the workout item", result.error);
    this.invalidatePrograms();
  }

  async updateWorkoutItemPrescription(item: WorkoutItem) {
    const count =
      item.mode === "sets"
        ? Math.max(1, item.prescription.sets ?? 1)
        : item.mode === "intervals"
          ? Math.max(1, item.prescription.rounds ?? 1)
          : 1;
    const sourceEntries = item.prescription.entries?.length
      ? item.prescription.entries
      : Array.from({ length: count }, () => item.prescription);
    const entries =
      item.mode === "none"
        ? []
        : sourceEntries.slice(0, count).map((entry) => {
            const reps = numericRange(entry.reps ?? item.prescription.reps);
            const rpe = numericRange(entry.targetRpe ?? item.prescription.targetRpe);
            return {
            reps_min: reps.minimum,
            reps_max: reps.maximum,
            load_kg: entry.loadKg ?? item.prescription.loadKg ?? null,
            duration_seconds: (entry.durationMinutes ?? item.prescription.durationMinutes)
              ? Math.round((entry.durationMinutes ?? item.prescription.durationMinutes ?? 0) * 60)
              : null,
            distance_metres: (entry.distance ?? item.prescription.distance)
              ? (entry.distance ?? item.prescription.distance ?? 0) *
                ((entry.distanceUnit ?? item.prescription.distanceUnit) === "km" ? 1000 : 1)
              : null,
            rounds: item.mode === "intervals" ? count : entry.rounds ?? item.prescription.rounds ?? null,
            work_seconds: entry.workSeconds ?? item.prescription.workSeconds ?? null,
            rest_seconds: entry.restSeconds ?? item.prescription.restSeconds ?? null,
            target_rpe_min: rpe.minimum,
            target_rpe_max: rpe.maximum,
            target_text: item.prescription.targetText ?? null,
          };
        });
    const result = await this.client.rpc("save_workout_item_prescription", {
      target_item_id: item.id,
      target_cue: item.cue,
      target_mode: item.mode,
      target_fields: item.fields,
      target_entries: entries,
    });
    if (result.error)
      fail("Could not save the exercise prescription", result.error);
    this.invalidatePrograms();
  }

  async startOrResumeSession(scheduledWorkoutId: string) {
    if (!scheduledWorkoutId)
      throw new Error("Choose a scheduled workout before starting it");
    const result = await this.client.rpc("start_scheduled_workout", {
      target_scheduled_workout_id: scheduledWorkoutId,
    });
    if (result.error) fail("Could not start the workout", result.error);
    const sessionId = String(result.data);
    this.invalidateProgramRunProgress();
    this.queryCache.invalidate(`schedule-detail:${scheduledWorkoutId}`);
    this.queryCache.delete("bootstrap");
    const activeSession = (await this.loadBootstrapData()).activeSession;
    if (!activeSession || activeSession.id !== sessionId)
      fail("Could not restore the active workout", null);
    return activeSession;
  }

  /**
   * Reloads one in-progress session after a compare-and-swap conflict.
   * Keeping this read scoped to the known session avoids reloading the whole
   * workspace while the athlete is actively logging a workout.
   */
  async reloadActiveSession(sessionId: string) {
    const activeSession = (await this.loadBootstrapData()).activeSession;
    return activeSession?.id === sessionId ? activeSession : null;
  }

  async saveSessionDraft(
    session: ActiveSession,
    setLogs: Record<string, SessionSetValue[]>,
    resultLogs: Record<string, Record<string, string>>,
    sessionRpe: string,
    sessionNote: string,
    expectedRevision: number,
    writeToken: string,
  ) {
    let result;
    try {
      result = await this.client.rpc("save_workout_session_draft", {
        target_session_id: session.id,
        expected_revision: expectedRevision,
        write_token: writeToken,
        draft_payload: buildSessionDraftPayload(
          session,
          setLogs,
          resultLogs,
          sessionRpe,
          sessionNote,
        ),
      });
    } catch (error) {
      throw new SessionDraftAmbiguousWriteError(
        "The workout save was interrupted before it could be confirmed",
        { cause: error },
      );
    }
    if (result.error) {
      if (/revision is stale/i.test(result.error.message))
        throw new SessionRevisionConflictError();
      fail("Could not save workout changes", result.error);
    }
    const record = jsonRecord(result.data);
    if (!record)
      throw new SessionDraftAmbiguousWriteError(
        "Workout autosave returned an invalid response",
      );
    const revision = jsonInteger(record, "revision");
    if (revision === undefined)
      throw new SessionDraftAmbiguousWriteError(
        "Workout autosave did not confirm a revision",
      );
    return {
      revision,
      savedAt: jsonString(record, "savedAt", "saved_at") ?? undefined,
    };
  }

  async completeSession(
    sessionId: string,
    rpe: string,
    note: string,
    expectedRevision: number,
    completionToken: string,
  ) {
    const result = await this.client.rpc("complete_workout_session_confirmed", {
      target_session_id: sessionId,
      expected_revision: expectedRevision,
      completion_token: completionToken,
      final_rpe: numberValue(rpe),
      final_note: note,
    });
    if (result.error) {
      if (/revision is stale/i.test(result.error.message))
        throw new SessionRevisionConflictError();
      fail("Could not complete the workout", result.error);
    }
    this.invalidateProgramRunProgress();
  }

  private async loadOwnSessionNotes(sessionId: string): Promise<OwnSessionNotes> {
    const result = await this.client.rpc("get_own_session_notes", {
      target_session_id: sessionId,
    });
    if (result.error)
      fail("Could not load your private workout notes", result.error);
    return parseOwnSessionNotes(result.data);
  }

  async loadCompletedSessionDetail(
    sessionId: string,
    athleteId: string = this.viewerId,
  ): Promise<CompletedSessionDetail | null> {
    return this.queryCache.getOrLoad(
      `completed-session:${athleteId}:${sessionId}`,
      () => this.loadCompletedSessionDetailUncached(sessionId, athleteId),
      { ttlMs: Infinity, shouldCache: (value) => value !== null },
    );
  }

  private async loadCompletedSessionDetailUncached(
    sessionId: string,
    athleteId: string,
  ): Promise<CompletedSessionDetail | null> {
    if (athleteId !== this.viewerId) {
      const result = await this.client.rpc(
        "get_authored_coach_session_detail",
        { target_session_id: sessionId },
      );
      if (result.error)
        fail("Could not load athlete workout results", result.error);
      if (!firstJsonRecord(result.data)) return null;
      const detail = parseCoachCompletedSessionDetail(result.data);
      if (!detail)
        fail("Could not load athlete workout results", null);
      return detail;
    }

    let sessionResult = await this.client
      .from("workout_sessions")
      .select(
        "id, draft_revision, program_run_id, program_run_workout_id, program_version_id, workout_id, scheduled_workout_id, workout_title, started_at, completed_at, completed_for_date, session_rpe",
      )
      .eq("id", sessionId)
      .eq("athlete_id", this.viewerId)
      .eq("status", "completed")
      .maybeSingle();
    if (sessionResult.error && isMissingProgramRunsColumn(sessionResult.error)) {
      sessionResult = await this.client
        .from("workout_sessions")
        .select(
          "id, draft_revision, program_version_id, workout_id, scheduled_workout_id, workout_title, started_at, completed_at, completed_for_date, session_rpe",
        )
        .eq("id", sessionId)
        .eq("athlete_id", this.viewerId)
        .eq("status", "completed")
        .maybeSingle();
    }
    if (sessionResult.error)
      fail("Could not load workout results", sessionResult.error);
    if (!sessionResult.data) return null;

    const session = sessionResult.data as SessionRow;
    const [items, notes] = await Promise.all([
      collectAllPages<CompletedSessionItemRow>(
        "Could not load completed workout items",
        (from, to) => this.client
          .from("session_item_logs")
          .select(
            "id, workout_session_id, source_workout_item_id, snapshot_name, snapshot_category, snapshot_video_url, snapshot_cue, entry_mode, tracking_fields, position",
          )
          .eq("workout_session_id", session.id)
          .order("position")
          .order("id")
          .range(from, to),
      ),
      this.loadOwnSessionNotes(session.id),
    ]);
    const itemIds = items.map((item) => item.id);
    const entries = await collectAllBatches<SessionEntryRow, string>(
      "Could not load completed workout entries",
      itemIds,
      (batch, from, to) => this.client
          .from("session_entries")
          .select(
            "id, session_item_log_id, position, reps, load_kg, duration_seconds, distance_metres, rounds, heart_rate, rpe",
          )
          .in("session_item_log_id", [...batch])
          .order("session_item_log_id")
          .order("position")
          .order("id")
          .range(from, to),
    );
    const entriesByItem = new Map<string, SessionEntryRow[]>();
    for (const entry of entries) {
      const itemEntries = entriesByItem.get(entry.session_item_log_id);
      if (itemEntries) itemEntries.push(entry);
      else entriesByItem.set(entry.session_item_log_id, [entry]);
    }

    return {
      ...mapCompletedSession(session, notes.sessionNote),
      items: items.map((item) => ({
        id: item.id,
        title: item.snapshot_name,
        category: item.snapshot_category,
        videoUrl: item.snapshot_video_url ?? undefined,
        cue: item.snapshot_cue,
        mode: item.entry_mode,
        fields: item.tracking_fields,
        position: item.position,
        note: notes.itemNotes[item.id] || undefined,
        entries: (entriesByItem.get(item.id) ?? [])
          .map((entry) => ({
            position: entry.position,
            reps: numberValue(entry.reps) ?? undefined,
            loadKg: numberValue(entry.load_kg) ?? undefined,
            durationMinutes:
              entry.duration_seconds === null
                ? undefined
                : entry.duration_seconds / 60,
            distanceKm:
              numberValue(entry.distance_metres) === null
                ? undefined
                : Number(numberValue(entry.distance_metres)) / 1000,
            rounds: entry.rounds ?? undefined,
            heartRate: entry.heart_rate ?? undefined,
            rpe: numberValue(entry.rpe) ?? undefined,
            note: notes.entryNotes[entry.id] || undefined,
          })),
      })),
    };
  }

  private async loadCoachingAccessSummary(): Promise<
    Pick<
      CoachingWorkspaceData,
      "coachConnections" | "pendingCoachInvites" | "outgoingCoachInvites"
    >
  > {
    const result = await this.client.rpc("get_coaching_access_summary");
    if (result.error)
      fail("Could not load coaching access", result.error);
    const payload = firstJsonRecord(result.data);
    if (!payload) fail("Could not load coaching access", null);

    const coachConnections = jsonRecords(
      jsonField(payload, "coachConnections", "coach_connections"),
    ).flatMap((row): CoachConnection[] => {
      const relationshipId = jsonString(
        row,
        "relationshipId",
        "relationship_id",
      );
      const coachId = jsonString(row, "coachId", "coach_id");
      const name = jsonString(row, "coachName", "coach_name");
      const connectedSince = jsonString(
        row,
        "connectedSince",
        "connected_since",
      );
      return relationshipId && coachId && name && connectedSince
        ? [{
            relationshipId,
            coachId,
            name,
            initials: initials(name),
            connectedSince: connectedSince.slice(0, 10),
          }]
        : [];
    });
    const pendingCoachInvites = jsonRecords(
      jsonField(payload, "pendingCoachInvites", "pending_coach_invites"),
    ).flatMap((row): PendingCoachInvite[] => {
      const id = jsonString(row, "id");
      const athleteId = jsonString(row, "athleteId", "athlete_id");
      const athleteName = jsonString(row, "athleteName", "athlete_name");
      const createdAt = jsonString(row, "createdAt", "created_at");
      const expiresAt = jsonString(row, "expiresAt", "expires_at");
      return id && athleteId && athleteName && createdAt && expiresAt
        ? [{
            id,
            athleteId,
            athleteName,
            athleteInitials: initials(athleteName),
            createdAt,
            expiresAt,
          }]
        : [];
    });
    const outgoingCoachInvites = jsonRecords(
      jsonField(payload, "outgoingCoachInvites", "outgoing_coach_invites"),
    ).flatMap((row): OutgoingCoachInvite[] => {
      const id = jsonString(row, "id");
      const coachId = jsonString(row, "coachId", "coach_id");
      const coachName = jsonString(row, "coachName", "coach_name");
      const createdAt = jsonString(row, "createdAt", "created_at");
      const expiresAt = jsonString(row, "expiresAt", "expires_at");
      return id && coachId && coachName && createdAt && expiresAt
        ? [{
            id,
            coachId,
            coachName,
            coachInitials: initials(coachName),
            createdAt,
            expiresAt,
          }]
        : [];
    });
    return {
      coachConnections,
      pendingCoachInvites,
      outgoingCoachInvites,
    };
  }

  async loadCoachedAthleteDetail(
    athleteId: string,
  ): Promise<AthleteSummary | null> {
    const [result, programRunPage, historyPage] = await Promise.all([
      this.client.rpc("get_coach_athlete_detail", {
        target_athlete_id: athleteId,
        program_limit: 25,
        upcoming_limit: 6,
        completed_limit: 6,
      }),
      this.listProgramRuns(athleteId),
      this.listCoachCompletedHistory(athleteId, { limit: 25 }),
    ]);
    if (result.error)
      fail("Could not load the athlete overview", result.error);
    const payload = firstJsonRecord(result.data);
    const athlete = payload
      ? jsonRecord(jsonField(payload, "athlete"))
      : null;
    const id = athlete ? jsonString(athlete, "id") : undefined;
    const name = athlete
      ? jsonString(athlete, "displayName", "display_name")
      : undefined;
    if (!payload || !athlete || !id || !name) return null;
    const assignedPrograms = jsonRecords(jsonField(payload, "programs")).flatMap(
      (row): CoachAssignedProgramSummary[] => {
        const identity = jsonString(row, "id");
        const programId = jsonString(row, "programId", "program_id");
        const assignmentId =
          jsonNullableString(row, "assignmentId", "assignment_id") ??
          undefined;
        const versionId = jsonString(row, "versionId", "version_id");
        const title = jsonString(row, "title");
        const assignedAt = jsonString(row, "assignedAt", "assigned_at");
        if (!identity || !programId || !versionId || !title || !assignedAt)
          return [];
        this.programSelectors.set(identity, {
          programId,
          assignmentId,
          versionId,
        });
        const totalWorkouts =
          jsonInteger(row, "totalWorkouts", "total_workouts") ?? 0;
        const scheduledWorkouts =
          jsonInteger(row, "scheduledWorkouts", "scheduled_workouts") ?? 0;
        const completedWorkouts =
          jsonInteger(row, "completedWorkouts", "completed_workouts") ?? 0;
        const next = jsonRecord(jsonField(row, "nextWorkout", "next_workout"));
        const nextStatus = next ? jsonString(next, "status") : undefined;
        const status: CoachAssignedProgramStatus =
          totalWorkouts > 0 && completedWorkouts >= totalWorkouts
            ? "completed"
            : nextStatus === "in_progress"
              ? "in_progress"
              : nextStatus === "planned"
                ? "scheduled"
                : "awaiting_schedule";
        const nextId = next ? jsonString(next, "id") : undefined;
        const nextTitle = next
          ? jsonString(next, "workoutTitle", "workout_title")
          : undefined;
        const nextDate = next
          ? jsonString(next, "plannedDate", "planned_date")
          : undefined;
        return [
          {
            id: identity,
            programId,
            assignmentId,
            versionId,
            title,
            assignedAt,
            status,
            totalWorkouts,
            scheduledWorkouts,
            scheduledPercent: totalWorkouts
              ? Math.round((scheduledWorkouts / totalWorkouts) * 100)
              : 0,
            completedWorkouts,
            completionPercent: totalWorkouts
              ? Math.round((completedWorkouts / totalWorkouts) * 100)
              : 0,
            ...(nextId && nextTitle && nextDate
              ? { nextWorkout: { id: nextId, title: nextTitle, date: nextDate } }
              : {}),
          },
        ];
      },
    );
    const today = localDateOnly();
    const upcoming: CoachAgendaEntry[] = jsonRecords(
      jsonField(payload, "upcoming"),
    ).flatMap((row): CoachAgendaEntry[] => {
      const occurrenceId = jsonString(row, "id");
      const programId = jsonString(row, "programId", "program_id");
      const versionId = jsonString(row, "programVersionId", "program_version_id");
      const programTitle = jsonString(row, "programTitle", "program_title");
      const workoutTitle = jsonString(row, "workoutTitle", "workout_title");
      const date = jsonString(row, "plannedDate", "planned_date");
      const rawStatus = jsonString(row, "status");
      if (
        !occurrenceId ||
        !programId ||
        !versionId ||
        !programTitle ||
        !workoutTitle ||
        !date ||
        (rawStatus !== "planned" && rawStatus !== "in_progress")
      ) return [];
      return [{
        id: `schedule:${occurrenceId}`,
        assignmentId:
          jsonNullableString(row, "assignmentId", "assignment_id") ??
          undefined,
        programRunId:
          jsonNullableString(row, "programRunId", "program_run_id") ??
          undefined,
        programRunWorkoutId:
          jsonNullableString(
            row,
            "programRunWorkoutId",
            "program_run_workout_id",
          ) ?? undefined,
        kind: "upcoming",
        status:
          rawStatus === "in_progress"
            ? "in_progress"
            : date < today
              ? "overdue"
              : "planned",
        programId,
        programVersionId: versionId,
        programTitle,
        workoutId:
          jsonNullableString(row, "workoutId", "workout_id") ?? undefined,
        workoutTitle,
        date,
        scheduleId: occurrenceId,
      }];
    });
    const completedFallback: CoachAgendaEntry[] = jsonRecords(
      jsonField(payload, "completed"),
    ).flatMap((row): CoachAgendaEntry[] => {
      const entry = parseCoachCompletedAgendaEntry(row);
      return entry ? [entry] : [];
    });
    const completed = historyPage.items.length || historyPage.hasMore
      ? historyPage.items
      : completedFallback;
    return {
      id,
      relationshipId:
        jsonNullableString(athlete, "relationshipId", "relationship_id") ??
        undefined,
      name,
      initials: initials(name),
      assignedProgramCount: Math.max(
        numberValue(
          jsonNumeric(payload, "assignedProgramCount", "assigned_program_count"),
        ) ?? 0,
        assignedPrograms.length,
        programRunPage.items.length,
      ),
      detailsLoaded: true,
      assignedPrograms,
      programRuns: programRunPage.items,
      programRunCursor: programRunPage.nextCursor,
      hasMoreProgramRuns: programRunPage.hasMore,
      agenda: [...upcoming, ...completed],
      historyCursor: historyPage.nextCursor,
      hasMoreHistory: historyPage.hasMore,
    };
  }

  async resolveCoachInviteTarget(
    identifier: string,
  ): Promise<CoachInviteTarget> {
    const result = await this.client.rpc("resolve_coach_invite_target", {
      target_identifier: identifier,
    });
    if (result.error || !result.data)
      fail("Could not find that coach", result.error);
    return result.data as CoachInviteTarget;
  }

  async createCoachInvite(identifier: string): Promise<CoachInviteReceipt> {
    const result = await this.client.rpc("create_coach_invite", {
      target_email: identifier,
    });
    if (result.error || !result.data)
      fail("Could not create the coach invitation", result.error);
    this.invalidateCoachingMutation();
    return result.data as CoachInviteReceipt;
  }

  async cancelCoachInvite(inviteId: string): Promise<void> {
    const result = await this.client.rpc("cancel_coach_invite", {
      target_invite_id: inviteId,
    });
    if (result.error)
      fail("Could not cancel the coaching request", result.error);
    this.invalidateCoachingMutation();
  }

  async respondToCoachInvite(
    inviteId: string,
    response: "accepted" | "declined",
  ): Promise<string | null> {
    const result = await this.client.rpc("respond_to_coach_invite", {
      target_invite_id: inviteId,
      target_response: response,
    });
    if (result.error || !result.data)
      fail("Could not respond to the coaching invitation", result.error);
    this.invalidateCoachingMutation(response === "accepted");
    const payload = result.data as { relationshipId: string | null };
    return payload.relationshipId;
  }

  /** Supports invitation URLs issued before in-app requests were introduced. */
  async acceptCoachInvite(token: string) {
    const result = await this.client.rpc("accept_coach_invite", {
      invite_token: token,
    });
    if (result.error)
      fail("Could not accept the coach invitation", result.error);
    this.invalidateCoachingMutation(true);
  }

  async endCoachRelationship(relationshipId: string) {
    const result = await this.client
      .from("coach_relationships")
      .update({ ended_at: new Date().toISOString() })
      .eq("id", relationshipId)
      .is("ended_at", null)
      .select("id");
    if (result.error || result.data?.length !== 1)
      fail("Could not remove coach access", result.error);
    this.invalidateCoachingMutation(true);
  }
}
