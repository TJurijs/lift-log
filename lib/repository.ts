import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ActiveSession,
  AthleteSummary,
  CoachAgendaEntry,
  CoachAssignedProgramStatus,
  CoachAssignedProgramSummary,
  CoachConnection,
  CoachingWorkspaceData,
  CoachInviteReceipt,
  CoachInviteTarget,
  CompletedSession,
  CompletedSessionDetail,
  EntryMode,
  Exercise,
  OwnProfile,
  OutgoingCoachInvite,
  PendingCoachInvite,
  PlannedWorkout,
  PrescriptionEntry,
  Prescription,
  Program,
  ProgramAssignment,
  ProgramTemplate,
  ScheduledWorkout,
  SessionSetValue,
  TrackingField,
  WorkoutItem,
  WorkoutProgressState,
  WorkoutSection,
  WorkspaceData,
} from "./domain";
import { recordClientPerformance } from "./performance";
import { collectAllBatches, collectAllPages } from "./pagination";
import { activeWeekForDate, localDateOnly } from "./date-only";

type NumericValue = number | string | null;

interface ExerciseRow {
  id: string;
  scope: "global" | "personal";
  owner_id: string | null;
  name: string;
  category: string;
  discipline?: "weightlifting" | "gym" | "functional" | null;
  tags?: string[] | null;
  cue: string;
  default_entry_mode: EntryMode;
  default_tracking_fields: TrackingField[];
}

interface ProgramRow {
  id: string;
  athlete_id: string;
  created_by_id: string;
  title: string;
  description: string;
  source_type: "self" | "coach" | "library";
  source_label: string;
  template_id: string | null;
  content_type?: "program" | "quick_workout";
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

interface PhaseRow {
  id: string;
  program_version_id: string;
  name: string;
  position: number;
}

interface WeekRow {
  id: string;
  program_version_id: string;
  phase_id: string | null;
  week_index: number;
  label: string;
}

interface WorkoutRow {
  id: string;
  program_week_id: string;
  title: string;
  day_of_week: number | null;
  schedule_label: string;
  position: number;
  estimated_minutes: number | null;
}

interface SectionRow {
  id: string;
  workout_id: string;
  title: string;
  section_kind: string;
  notes: string;
  position: number;
}

interface ItemRow {
  id: string;
  section_id: string;
  source_exercise_id: string | null;
  snapshot_name: string;
  snapshot_cue: string;
  entry_mode: EntryMode;
  tracking_fields: TrackingField[];
  position: number;
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

interface ScheduleRow {
  id: string;
  program_version_id: string;
  workout_id: string;
  planned_date: string | null;
  sequence_number: number | null;
  status: "planned" | "in_progress" | "completed" | "skipped";
}

interface TemplateRow {
  id: string;
  title: string;
  description: string;
  week_count: number;
  source_label: string;
  workouts: unknown[];
}

interface SessionRow {
  id: string;
  draft_revision?: NumericValue;
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

interface ConnectedProfileSummaryRow {
  id: string;
  display_name: string;
}

interface OwnSessionNotes {
  sessionNote: string;
  itemNotes: Record<string, string>;
  entryNotes: Record<string, string>;
}

interface RelationshipRow {
  id: string;
  athlete_id: string;
  coach_id: string;
  accepted_at: string;
}

interface ProgramPair {
  draftProgram: Program | null;
  activeProgram: Program | null;
}

interface LoadedOwnProfile {
  profile: OwnProfile;
  timezone: string | null;
}

interface PrescriptionInsert {
  workout_item_id: string;
  position: number;
  reps_min?: number;
  reps_max?: number;
  target_rpe_min?: number;
  target_rpe_max?: number;
  rounds?: number;
  work_seconds?: number;
  rest_seconds?: number;
  duration_seconds?: number;
}

export interface CreateExerciseInput {
  name: string;
  category: string;
  mode: EntryMode;
  cue: string;
}

function fail(context: string, error: { message: string } | null): never {
  throw new Error(error ? `${context}: ${error.message}` : context);
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

const coachProgramStatuses = new Set<CoachAssignedProgramStatus>([
  "awaiting_schedule",
  "scheduled",
  "in_progress",
  "completed",
]);
const workoutProgressStates = new Set<WorkoutProgressState>([
  "unscheduled",
  "scheduled",
  "planned",
  "in_progress",
  "completed",
  "skipped",
]);

function parseCoachAssignedPrograms(value: unknown): CoachAssignedProgramSummary[] {
  return jsonRecords(value).flatMap((row) => {
    const id = jsonString(row, "id");
    const versionId = jsonString(row, "versionId", "version_id");
    const title = jsonString(row, "title");
    const assignedAt = jsonString(row, "assignedAt", "assigned_at");
    const status = jsonString(row, "status");
    if (
      !id ||
      !versionId ||
      !title ||
      !assignedAt ||
      !status ||
      !coachProgramStatuses.has(status as CoachAssignedProgramStatus)
    ) {
      return [];
    }
    const progressValue = jsonField(row, "workoutProgress", "workout_progress");
    const workoutProgress = Array.isArray(progressValue)
      ? progressValue.filter(
          (state): state is WorkoutProgressState =>
            typeof state === "string" &&
            workoutProgressStates.has(state as WorkoutProgressState),
        )
      : [];
    const nextValue = jsonRecord(jsonField(row, "nextWorkout", "next_workout"));
    const nextId = nextValue ? jsonString(nextValue, "id") : undefined;
    const nextTitle = nextValue ? jsonString(nextValue, "title") : undefined;
    const nextDate = nextValue ? jsonString(nextValue, "date") : undefined;
    return [
      {
        id,
        versionId,
        title,
        assignedAt,
        status: status as CoachAssignedProgramStatus,
        totalWorkouts: jsonInteger(row, "totalWorkouts", "total_workouts") ?? 0,
        scheduledWorkouts:
          jsonInteger(row, "scheduledWorkouts", "scheduled_workouts") ?? 0,
        scheduledPercent:
          jsonInteger(row, "scheduledPercent", "scheduled_percent") ?? 0,
        completedWorkouts:
          jsonInteger(row, "completedWorkouts", "completed_workouts") ?? 0,
        completionPercent:
          jsonInteger(row, "completionPercent", "completion_percent") ?? 0,
        workoutProgress,
        hiddenWorkoutCount:
          jsonInteger(row, "hiddenWorkoutCount", "hidden_workout_count") ?? 0,
        ...(nextId && nextTitle && nextDate
          ? { nextWorkout: { id: nextId, title: nextTitle, date: nextDate } }
          : {}),
      },
    ];
  });
}

function parseCoachAgenda(value: unknown): CoachAgendaEntry[] {
  return jsonRecords(value).flatMap((row) => {
    const id = jsonString(row, "id");
    const kind = jsonString(row, "kind");
    const status = jsonString(row, "status");
    const programId = jsonString(row, "programId", "program_id");
    const programVersionId = jsonString(
      row,
      "programVersionId",
      "program_version_id",
    );
    const programTitle = jsonString(row, "programTitle", "program_title");
    const workoutTitle = jsonString(row, "workoutTitle", "workout_title");
    const date = jsonString(row, "date");
    if (
      !id ||
      (kind !== "upcoming" && kind !== "completed") ||
      !status ||
      !["planned", "overdue", "in_progress", "completed"].includes(status) ||
      !programId ||
      !programVersionId ||
      !programTitle ||
      !workoutTitle ||
      !date
    ) {
      return [];
    }
    return [
      {
        id,
        kind,
        status: status as CoachAgendaEntry["status"],
        programId,
        programVersionId,
        programTitle,
        workoutId: jsonString(row, "workoutId", "workout_id"),
        workoutTitle,
        date,
        rpe: numberValue(jsonNumeric(row, "rpe")) ?? undefined,
        scheduleId: jsonString(row, "scheduleId", "schedule_id"),
        sessionId: jsonString(row, "sessionId", "session_id"),
      },
    ];
  });
}

function parseCoachAthleteOverviews(value: unknown): AthleteSummary[] {
  const rows = Array.isArray(value)
    ? jsonRecords(value)
    : [firstJsonRecord(value)].filter((row): row is JsonRecord => row !== null);
  return rows.flatMap((row) => {
    const id = jsonString(row, "id", "athlete_id", "athleteId");
    const relationshipId = jsonString(
      row,
      "relationship_id",
      "relationshipId",
    );
    const name = jsonString(row, "display_name", "displayName", "name");
    if (!id || !relationshipId || !name) return [];
    const assignedProgramsValue = jsonField(
      row,
      "assigned_programs",
      "assignedPrograms",
    );
    const agendaValue = jsonField(row, "agenda");
    return [
      {
        id,
        relationshipId,
        name,
        initials: initials(name),
        assignedProgramCount:
          jsonInteger(
            row,
            "assigned_program_count",
            "assignedProgramCount",
          ) ?? 0,
        detailsLoaded:
          Array.isArray(assignedProgramsValue) && Array.isArray(agendaValue),
        assignedPrograms: parseCoachAssignedPrograms(assignedProgramsValue),
        agenda: parseCoachAgenda(agendaValue),
      },
    ];
  });
}

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

function mapCompletedSession(
  session: SessionRow,
  note?: string,
): CompletedSession {
  const start = new Date(session.started_at);
  const end = session.completed_at ? new Date(session.completed_at) : start;
  return {
    id: session.id,
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
    cue: row.cue,
    scope: row.scope,
    ownerName: row.scope === "personal" ? ownerName : undefined,
    defaultMode: row.default_entry_mode,
    defaultFields: row.default_tracking_fields,
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
        : result
          ? [
              {
                position: 0,
                reps: null,
                loadKg: null,
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
  private workspaceLoadPromise: Promise<WorkspaceData> | null = null;
  private coachingWorkspaceLoadPromise: Promise<CoachingWorkspaceData> | null =
    null;
  private readonly programVersionCache = new Map<
    string,
    Promise<Program | null>
  >();
  private readonly completedSessionCache = new Map<
    string,
    Promise<CompletedSessionDetail | null>
  >();

  constructor(
    private readonly client: SupabaseClient,
    private readonly viewerId: string,
    private readonly viewerName: string,
  ) {}

  dispose() {
    this.workspaceLoadPromise = null;
    this.coachingWorkspaceLoadPromise = null;
    this.programVersionCache.clear();
    this.completedSessionCache.clear();
  }

  private cacheImmutable<T>(
    cache: Map<string, Promise<T>>,
    key: string,
    load: () => Promise<T>,
  ) {
    const current = cache.get(key);
    if (current) return current;
    const pending = load();
    cache.set(key, pending);
    void pending.catch(() => {
      if (cache.get(key) === pending) cache.delete(key);
    });
    return pending;
  }

  async loadWorkspace(): Promise<WorkspaceData> {
    if (this.workspaceLoadPromise) return this.workspaceLoadPromise;
    const startedAt = performance.now();
    const pending = this.loadWorkspaceData();
    this.workspaceLoadPromise = pending;
    try {
      return await pending;
    } finally {
      recordClientPerformance("workspace:repository-load", startedAt);
      if (this.workspaceLoadPromise === pending) this.workspaceLoadPromise = null;
    }
  }

  private async loadWorkspaceData(): Promise<WorkspaceData> {
    const [
      loadedProfile,
      programCatalog,
      availableProgramIds,
      programTemplates,
      scheduledWorkouts,
      exercises,
      completedSessions,
      coachingWorkspace,
      activeSession,
    ] = await Promise.all([
      this.loadOwnProfile(),
      this.loadProgramCatalog(this.viewerId),
      this.listAvailableProgramIds(),
      this.listProgramTemplates(),
      this.listScheduledWorkouts(this.viewerId),
      this.listExercises(),
      this.listCompletedSessions(this.viewerId),
      this.loadCoachingWorkspace(),
      this.loadActiveSession(),
    ]);

    this.syncTimezoneIfChanged(loadedProfile.timezone);
    const activeSchedule = activeSession
      ? scheduledWorkouts.find(
          (schedule) =>
            schedule.id === activeSession.scheduledWorkoutId ||
            (schedule.programVersionId === activeSession.programVersionId &&
              schedule.workoutId === activeSession.workoutId),
        )
      : undefined;
    const activeScheduleDetail = activeSchedule
      ? await this.loadScheduledWorkoutDetail(activeSchedule.id)
      : null;
    const hydratedSchedules = activeScheduleDetail
      ? scheduledWorkouts.map((schedule) =>
          schedule.id === activeScheduleDetail.id ? activeScheduleDetail : schedule,
        )
      : scheduledWorkouts;

    return {
      profile: loadedProfile.profile,
      programCatalog,
      availableProgramIds,
      availablePrograms: programCatalog.filter((program) =>
        availableProgramIds.includes(program.id),
      ),
      draftProgram:
        programCatalog.find((program) => program.versionStatus === "draft") ??
        null,
      activeProgram:
        programCatalog.find(
          (program) =>
            availableProgramIds.includes(program.id) &&
            program.versionStatus === "published",
        ) ?? null,
      programTemplates,
      scheduledWorkouts: hydratedSchedules,
      globalExercises: exercises.filter(
        (exercise) => exercise.scope === "global",
      ),
      personalExercises: exercises.filter(
        (exercise) => exercise.scope === "personal",
      ),
      completedSessions,
      ...coachingWorkspace,
      activeSession,
    };
  }

  async loadCoachingWorkspace(): Promise<CoachingWorkspaceData> {
    if (this.coachingWorkspaceLoadPromise)
      return this.coachingWorkspaceLoadPromise;
    const startedAt = performance.now();
    const pending = Promise.all([
      this.loadCoachConnections(),
      this.loadCoachedAthletes(),
      this.loadPendingCoachInvites(),
      this.loadOutgoingCoachInvites(),
    ]).then(
      ([
        coachConnections,
        coachedAthletes,
        pendingCoachInvites,
        outgoingCoachInvites,
      ]) => ({
        coachConnections,
        coachedAthletes,
        pendingCoachInvites,
        outgoingCoachInvites,
      }),
    );
    this.coachingWorkspaceLoadPromise = pending;
    try {
      return await pending;
    } finally {
      recordClientPerformance("coaching:repository-load", startedAt);
      if (this.coachingWorkspaceLoadPromise === pending)
        this.coachingWorkspaceLoadPromise = null;
    }
  }

  async loadProgramForAthlete(athleteId: string) {
    const pair = await this.loadProgramPair(athleteId);
    return pair.activeProgram ?? pair.draftProgram;
  }

  async loadProgramDetail(
    athleteId: string,
    programId: string,
  ): Promise<Program | null> {
    const pair = await this.loadProgramPair(athleteId, programId);
    return pair.activeProgram ?? pair.draftProgram;
  }

  async loadProgramForAthleteById(
    athleteId: string,
    programId: string,
  ): Promise<Program | null> {
    const authorizedProgram = await this.client
      .from("programs")
      .select("id")
      .eq("id", programId)
      .eq("athlete_id", athleteId)
      .eq("created_by_id", this.viewerId)
      .eq("source_type", "coach")
      .eq("is_current", true)
      .is("archived_at", null)
      .maybeSingle();
    if (authorizedProgram.error)
      fail("Could not load the athlete program", authorizedProgram.error);
    if (!authorizedProgram.data) return null;

    // This read path never creates a draft.
    const pair = await this.loadProgramPair(athleteId, programId);
    return pair.activeProgram ?? pair.draftProgram;
  }

  async loadProgramVersionForAthleteById(
    athleteId: string,
    programId: string,
    versionId: string,
  ): Promise<Program | null> {
    return this.cacheImmutable(
      this.programVersionCache,
      `${athleteId}:${programId}:${versionId}`,
      () =>
        this.loadProgramVersionForAthleteByIdUncached(
          athleteId,
          programId,
          versionId,
        ),
    );
  }

  private async loadProgramVersionForAthleteByIdUncached(
    athleteId: string,
    programId: string,
    versionId: string,
  ): Promise<Program | null> {
    const programResult = await this.client
      .from("programs")
      .select(
        "id, athlete_id, created_by_id, title, description, source_type, source_label, template_id, content_type",
      )
      .eq("id", programId)
      .eq("athlete_id", athleteId)
      .eq("created_by_id", this.viewerId)
      .eq("source_type", "coach")
      .eq("is_current", true)
      .is("archived_at", null)
      .maybeSingle();
    if (programResult.error)
      fail("Could not load the athlete program", programResult.error);
    if (!programResult.data) return null;
    const programRow = programResult.data as ProgramRow;

    const versionResult = await this.client
      .from("program_versions")
      .select(
        "id, program_id, version_number, status, effective_from, title, description",
      )
      .eq("id", versionId)
      .eq("program_id", programId)
      .in("status", ["published", "superseded"])
      .maybeSingle();
    if (versionResult.error)
      fail("Could not load the athlete program version", versionResult.error);
    if (!versionResult.data) return null;
    const version = versionResult.data as VersionRow;

    const profiles = await this.loadConnectedProfileSummaries();
    const ownerName =
      profiles.find((profile) => profile.id === programRow.athlete_id)
        ?.display_name ?? "Athlete";
    const createdByName =
      profiles.find((profile) => profile.id === programRow.created_by_id)
        ?.display_name ?? ownerName;

    // This exact-version path is read-only and intentionally supports history.
    return this.loadVersionTree(programRow, version, ownerName, createdByName);
  }

  private async loadProgramCatalog(athleteId: string): Promise<Program[]> {
    const programRows = await collectAllPages<ProgramRow>(
      "Could not load programs",
      (from, to) =>
        this.client
          .from("programs")
          .select(
            "id, athlete_id, created_by_id, title, description, source_type, source_label, template_id, content_type",
          )
          .eq("athlete_id", athleteId)
          .eq("is_current", true)
          .is("archived_at", null)
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, to),
    );
    if (!programRows.length) return [];

    // Startup only needs card metadata and workout ids for scheduling progress.
    // Full weeks, exercises, and prescriptions are fetched when a program opens.
    const programIds = programRows.map((program) => program.id);
    const versions = await collectAllBatches<VersionRow, string>(
      "Could not load program versions",
      programIds,
      (ids, from, to) =>
        this.client
          .from("program_versions")
          .select(
            "id, program_id, version_number, status, effective_from, title, description",
          )
          .in("program_id", [...ids])
          .order("version_number", { ascending: false })
          .order("id")
          .range(from, to),
    );
    const selectedVersions = programRows.flatMap((program) => {
      const programVersions = versions.filter((version) => version.program_id === program.id);
      const active = programVersions.find((version) => version.status === "published");
      const draft = programVersions.find((version) => version.status === "draft");
      return active ? [active] : draft ? [draft] : [];
    });
    if (!selectedVersions.length) return [];

    const selectedVersionIds = selectedVersions.map((version) => version.id);
    const profileIds = Array.from(
      new Set(
        programRows.flatMap((program) => [
          program.athlete_id,
          program.created_by_id,
        ]),
      ),
    );
    const [connectedProfiles, weeks] = await Promise.all([
      this.loadConnectedProfileSummaries(),
      collectAllBatches<
        Pick<WeekRow, "id" | "program_version_id" | "week_index" | "label">,
        string
      >(
        "Could not load program weeks",
        selectedVersionIds,
        (ids, from, to) =>
          this.client
            .from("program_weeks")
            .select("id, program_version_id, week_index, label")
            .in("program_version_id", [...ids])
            .order("week_index")
            .order("id")
            .range(from, to),
      ),
    ]);
    const weekIds = weeks.map((week) => week.id);
    const workouts = await collectAllBatches<
      Pick<WorkoutRow, "id" | "program_week_id">,
      string
    >("Could not load workouts", weekIds, (ids, from, to) =>
      this.client
        .from("workouts")
        .select("id, program_week_id")
        .in("program_week_id", [...ids])
        .order("id")
        .range(from, to),
    );

    const profiles = connectedProfiles.filter((profile) =>
      profileIds.includes(profile.id),
    );
    const programs = selectedVersions.map((version) => {
      const row = programRows.find((program) => program.id === version.program_id)!;
      const versionWeeks = weeks.filter((week) => week.program_version_id === version.id);
      const workoutIds = workouts
        .filter((workout) => versionWeeks.some((week) => week.id === workout.program_week_id))
        .map((workout) => workout.id);
      const ownerName =
        profiles.find((profile) => profile.id === row.athlete_id)?.display_name ?? "Athlete";
      const createdByName =
        profiles.find((profile) => profile.id === row.created_by_id)?.display_name ?? ownerName;
      return {
        id: row.id,
        athleteId: row.athlete_id,
        versionId: version.id,
        versionStatus: version.status,
        effectiveFrom: version.effective_from ?? undefined,
        title: version.title || row.title,
        description: version.description ?? row.description,
        phase: "Plan",
        activeWeek: activeWeekIndex(version, versionWeeks.length),
        weeks: [],
        ownerName,
        createdById: row.created_by_id,
        createdByName,
        sourceType: row.source_type,
        sourceLabel: row.source_label,
        templateId: row.template_id ?? undefined,
        contentType: row.content_type ?? "program",
        weekCount: versionWeeks.length,
        workoutCount: workoutIds.length,
        workoutIds,
        detailsLoaded: false,
      } satisfies Program;
    });
    return athleteId === this.viewerId
      ? programs.filter(
          (program) =>
            program.sourceType !== "coach" ||
            program.versionStatus === "published",
        )
      : programs;
  }

  private async listAvailableProgramIds() {
    const rows = await collectAllPages<{ program_id: string }>(
      "Could not load available programs",
      (from, to) =>
        this.client
          .from("program_availability")
          .select("program_id")
          .eq("athlete_id", this.viewerId)
          .order("program_id")
          .range(from, to),
    );
    return rows.map((row) => row.program_id);
  }

  async loadEditableProgram(athleteId: string, programId: string) {
    let pair = await this.loadProgramPair(athleteId, programId);
    if (pair.draftProgram) return pair.draftProgram;
    await this.createProgramDraft(programId);
    pair = await this.loadProgramPair(athleteId, programId);
    if (!pair.draftProgram)
      throw new Error("The editable program copy could not be loaded");
    return pair.draftProgram;
  }

  private async loadConnectedProfileSummaries(): Promise<
    ConnectedProfileSummaryRow[]
  > {
    const result = await this.client.rpc("list_connected_profile_summaries");
    if (result.error)
      fail("Could not load connected profile names", result.error);
    return jsonRecords(result.data).flatMap((row) => {
      const id = jsonString(row, "id");
      const displayName = jsonString(row, "display_name", "displayName");
      return id && displayName ? [{ id, display_name: displayName }] : [];
    });
  }

  private async loadOwnProfile(): Promise<LoadedOwnProfile> {
    const result = await this.client.rpc("get_own_profile");
    if (result.error)
      fail("Could not load your account", result.error);
    const row = firstJsonRecord(result.data);
    const id = row ? jsonString(row, "id") : undefined;
    const displayName = row
      ? jsonString(row, "display_name", "displayName")
      : undefined;
    const firstName = row
      ? jsonString(row, "first_name", "firstName")
      : undefined;
    const lastName = row
      ? jsonString(row, "last_name", "lastName")
      : undefined;
    const liftlogId = row
      ? jsonString(row, "liftlog_id", "liftlogId")
      : undefined;
    if (!row || !id || !displayName || firstName === undefined || lastName === undefined || !liftlogId)
      fail("Could not load your account", null);
    const weekStartsOnSunday = jsonField(
      row,
      "week_starts_on_sunday",
      "weekStartsOnSunday",
    );
    const weightUnit = jsonString(row, "weight_unit", "weightUnit");
    const distanceUnit = jsonString(row, "distance_unit", "distanceUnit");
    return {
      profile: {
        id,
        firstName,
        lastName,
        displayName,
        liftlogId,
        weekStartsOnSunday:
          typeof weekStartsOnSunday === "boolean" ? weekStartsOnSunday : false,
        weightUnit: weightUnit === "lb" ? "lb" : "kg",
        distanceUnit: distanceUnit === "mi" ? "mi" : "km",
      },
      timezone: jsonNullableString(row, "timezone"),
    };
  }

  private syncTimezoneIfChanged(savedTimezone: string | null) {
    const currentTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!currentTimezone || currentTimezone === savedTimezone) return;
    void this.client
      .from("profiles")
      .update({ timezone: currentTimezone })
      .eq("id", this.viewerId);
  }

  private async loadProgramPair(
    athleteId: string,
    programId?: string,
    options: { includeDraftWhenPublished?: boolean } = {},
  ): Promise<ProgramPair> {
    let programQuery = this.client
      .from("programs")
      .select(
        "id, athlete_id, created_by_id, title, description, source_type, source_label, template_id, content_type",
      )
      .eq("athlete_id", athleteId)
      .eq("is_current", true)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(1);
    if (programId) programQuery = programQuery.eq("id", programId);
    const programResult = await programQuery.maybeSingle();
    if (programResult.error)
      fail("Could not load the training program", programResult.error);
    if (!programResult.data) return { draftProgram: null, activeProgram: null };
    const programRow = programResult.data as ProgramRow;
    const loadedProgramId = programRow.id;

    const versionsResult = await this.client
      .from("program_versions")
      .select(
        "id, program_id, version_number, status, effective_from, title, description",
      )
      .eq("program_id", loadedProgramId)
      .order("version_number", { ascending: false });
    if (versionsResult.error)
      fail("Could not load program versions", versionsResult.error);
    const versions = versionsResult.data as VersionRow[];

    const draftVersion = versions.find((version) => version.status === "draft");
    const activeVersion = versions.find(
      (version) => version.status === "published",
    );

    const profiles = await this.loadConnectedProfileSummaries();
    const ownerName =
      profiles.find((profile) => profile.id === programRow.athlete_id)
        ?.display_name ?? "Athlete";
    const createdByName =
      profiles.find((profile) => profile.id === programRow.created_by_id)
        ?.display_name ?? ownerName;

    const draftProgram = draftVersion && (!activeVersion || options.includeDraftWhenPublished !== false)
      ? await this.loadVersionTree(
          programRow,
          draftVersion,
          ownerName,
          createdByName,
        )
      : null;
    const activeProgram = activeVersion
      ? await this.loadVersionTree(
          programRow,
          activeVersion,
          ownerName,
          createdByName,
        )
      : null;
    return { draftProgram, activeProgram };
  }

  private async loadVersionTree(
    programRow: ProgramRow,
    version: VersionRow,
    ownerName: string,
    createdByName: string,
  ): Promise<Program> {
    const [phases, weeks, schedules] = await Promise.all([
      collectAllPages<PhaseRow>("Could not load program phases", (from, to) =>
        this.client
          .from("program_phases")
          .select("id, program_version_id, name, position")
          .eq("program_version_id", version.id)
          .order("position")
          .order("id")
          .range(from, to),
      ),
      collectAllPages<WeekRow>("Could not load program weeks", (from, to) =>
        this.client
          .from("program_weeks")
          .select("id, program_version_id, phase_id, week_index, label")
          .eq("program_version_id", version.id)
          .order("week_index")
          .order("id")
          .range(from, to),
      ),
      collectAllPages<ScheduleRow>(
        "Could not load scheduled workouts",
        (from, to) =>
          this.client
            .from("scheduled_workouts")
            .select(
              "id, program_version_id, workout_id, planned_date, sequence_number, status",
            )
            .eq("program_version_id", version.id)
            .order("sequence_number")
            .order("id")
            .range(from, to),
      ),
    ]);

    const weekIds = weeks.map((week) => week.id);
    const workouts = await collectAllBatches<WorkoutRow, string>(
      "Could not load workouts",
      weekIds,
      (ids, from, to) =>
        this.client
          .from("workouts")
          .select(
            "id, program_week_id, title, day_of_week, schedule_label, position, estimated_minutes",
          )
          .in("program_week_id", [...ids])
          .order("position")
          .order("id")
          .range(from, to),
    );

    const workoutIds = workouts.map((workout) => workout.id);
    const sections = await collectAllBatches<SectionRow, string>(
      "Could not load workout sections",
      workoutIds,
      (ids, from, to) =>
        this.client
          .from("workout_sections")
          .select("id, workout_id, title, section_kind, notes, position")
          .in("workout_id", [...ids])
          .order("position")
          .order("id")
          .range(from, to),
    );

    const sectionIds = sections.map((section) => section.id);
    const items = await collectAllBatches<ItemRow, string>(
      "Could not load workout items",
      sectionIds,
      (ids, from, to) =>
        this.client
          .from("workout_items")
          .select(
            "id, section_id, source_exercise_id, snapshot_name, snapshot_cue, entry_mode, tracking_fields, position",
          )
          .in("section_id", [...ids])
          .order("position")
          .order("id")
          .range(from, to),
    );

    const itemIds = items.map((item) => item.id);
    const prescriptions = await collectAllBatches<PrescriptionRow, string>(
      "Could not load workout prescriptions",
      itemIds,
      (ids, from, to) =>
        this.client
          .from("prescribed_entries")
          .select("*")
          .in("workout_item_id", [...ids])
          .order("position")
          .order("id")
          .range(from, to),
    );

    const mappedWeeks = weeks.map((week) => ({
      id: week.id,
      index: week.week_index,
      label: week.label,
      workouts: workouts
        .filter((workout) => workout.program_week_id === week.id)
        .sort((left, right) => left.position - right.position)
        .map((workout): PlannedWorkout => {
          const schedule = schedules.find(
            (occurrence) => occurrence.workout_id === workout.id,
          );
          return {
            id: workout.id,
            programVersionId: version.id,
            scheduledWorkoutId: schedule?.id,
            plannedDate: schedule?.planned_date ?? undefined,
            title: workout.title,
            dayLabel: `Workout ${workout.position + 1}`,
            durationMinutes: workout.estimated_minutes ?? 45,
            sections: sections
              .filter((section) => section.workout_id === workout.id)
              .sort((left, right) => left.position - right.position)
              .map((section): WorkoutSection => ({
                id: section.id,
                title: section.title,
                kind: section.section_kind as WorkoutSection["kind"],
                items: items
                  .filter((item) => item.section_id === section.id)
                  .sort((left, right) => left.position - right.position)
                  .map((item): WorkoutItem => ({
                    id: item.id,
                    exerciseId: item.source_exercise_id ?? undefined,
                    title: item.snapshot_name,
                    cue: item.snapshot_cue,
                    mode: item.entry_mode,
                    fields: item.tracking_fields,
                    prescription: prescriptionFromRows(
                      item.entry_mode,
                      prescriptions.filter(
                        (entry) => entry.workout_item_id === item.id,
                      ),
                    ),
                  })),
              })),
          };
        }),
    }));

    const phase =
      phases.sort((left, right) => left.position - right.position)[0]?.name ??
      "Plan";
    return {
      id: programRow.id,
      athleteId: programRow.athlete_id,
      versionId: version.id,
      versionStatus: version.status,
      effectiveFrom: version.effective_from ?? undefined,
      title: version.title || programRow.title,
      description: version.description ?? programRow.description,
      phase,
      activeWeek: activeWeekIndex(version, mappedWeeks.length),
      weeks: mappedWeeks,
      ownerName,
      createdById: programRow.created_by_id,
      createdByName,
      sourceType: programRow.source_type,
      templateId: programRow.template_id ?? undefined,
      contentType: programRow.content_type ?? "program",
      sourceLabel:
        programRow.created_by_id === this.viewerId
          ? "Created by you"
          : programRow.source_type === "library"
            ? programRow.source_label
            : `Created by ${createdByName}`,
    };
  }

  private async listProgramTemplates(): Promise<ProgramTemplate[]> {
    const result = await this.client
      .from("program_templates")
      .select("id, title, description, week_count, source_label, workouts")
      .eq("is_active", true)
      .order("title");
    if (result.error) fail("Could not load the program library", result.error);
    return (result.data as TemplateRow[]).map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      weekCount: row.week_count,
      sessionsPerWeek: Array.isArray(row.workouts) ? row.workouts.length : 0,
      sourceLabel: row.source_label,
    }));
  }

  private async listScheduledWorkouts(athleteId: string) {
    return this.loadScheduledWorkoutSummaries(athleteId);
  }

  async loadScheduledWorkoutDetail(
    scheduleId: string,
    athleteId: string = this.viewerId,
  ): Promise<ScheduledWorkout | null> {
    const schedule = (await this.loadScheduledWorkoutSummaries(athleteId, scheduleId))[0];
    if (!schedule) return null;

    const sectionsResult = await this.client
      .from("workout_sections")
      .select("id, workout_id, title, section_kind, notes, position")
      .eq("workout_id", schedule.workoutId)
      .order("position");
    if (sectionsResult.error)
      fail("Could not load scheduled workout sections", sectionsResult.error);
    const sections = sectionsResult.data as SectionRow[];
    const sectionIds = sections.map((section) => section.id);
    const itemsResult = sectionIds.length
      ? await this.client
          .from("workout_items")
          .select(
            "id, section_id, source_exercise_id, snapshot_name, snapshot_cue, entry_mode, tracking_fields, position",
          )
          .in("section_id", sectionIds)
          .order("position")
      : { data: [], error: null };
    if (itemsResult.error)
      fail("Could not load scheduled workout items", itemsResult.error);
    const items = itemsResult.data as ItemRow[];
    const itemIds = items.map((item) => item.id);
    const prescriptionsResult = itemIds.length
      ? await this.client
          .from("prescribed_entries")
          .select("*")
          .in("workout_item_id", itemIds)
          .order("position")
      : { data: [], error: null };
    if (prescriptionsResult.error)
      fail(
        "Could not load scheduled workout prescriptions",
        prescriptionsResult.error,
      );
    const prescriptions = prescriptionsResult.data as PrescriptionRow[];

    return {
      ...schedule,
      detailsLoaded: true,
      workout: {
        ...schedule.workout,
        sections: sections
          .sort((left, right) => left.position - right.position)
          .map((section): WorkoutSection => ({
            id: section.id,
            title: section.title,
            kind: section.section_kind as WorkoutSection["kind"],
            items: items
              .filter((item) => item.section_id === section.id)
              .sort((left, right) => left.position - right.position)
              .map((item): WorkoutItem => ({
                id: item.id,
                exerciseId: item.source_exercise_id ?? undefined,
                title: item.snapshot_name,
                cue: item.snapshot_cue,
                mode: item.entry_mode,
                fields: item.tracking_fields,
                prescription: prescriptionFromRows(
                  item.entry_mode,
                  prescriptions.filter(
                    (entry) => entry.workout_item_id === item.id,
                  ),
                ),
              })),
          })),
      },
    };
  }

  private async loadScheduledWorkoutSummaries(
    athleteId: string,
    scheduleId?: string,
  ): Promise<ScheduledWorkout[]> {
    const schedules = await collectAllPages<ScheduleRow>(
      "Could not load scheduled workouts",
      (from, to) => {
        let query = this.client
          .from("scheduled_workouts")
          .select(
            "id, program_version_id, workout_id, planned_date, sequence_number, status",
          )
          .eq("athlete_id", athleteId)
          .order("sequence_number", { ascending: true })
          .order("id");
        if (scheduleId) query = query.eq("id", scheduleId);
        return query.range(from, to);
      },
    );
    if (!schedules.length) return [];
    const scheduledWorkoutIds = Array.from(
      new Set(schedules.map((schedule) => schedule.workout_id)),
    );
    const workouts = await collectAllBatches<WorkoutRow, string>(
      "Could not load scheduled workout names",
      scheduledWorkoutIds,
      (ids, from, to) =>
        this.client
          .from("workouts")
          .select(
            "id, program_week_id, title, day_of_week, schedule_label, position, estimated_minutes",
          )
          .in("id", [...ids])
          .order("id")
          .range(from, to),
    );
    const weekIds = Array.from(
      new Set(workouts.map((workout) => workout.program_week_id)),
    );
    const weeks = await collectAllBatches<WeekRow, string>(
      "Could not load scheduled workout weeks",
      weekIds,
      (ids, from, to) =>
        this.client
          .from("program_weeks")
          .select("id, program_version_id, phase_id, week_index, label")
          .in("id", [...ids])
          .order("id")
          .range(from, to),
    );
    const versionIds = Array.from(
      new Set(schedules.map((schedule) => schedule.program_version_id)),
    );
    const versions = await collectAllBatches<VersionRow, string>(
      "Could not load scheduled workout versions",
      versionIds,
      (ids, from, to) =>
        this.client
          .from("program_versions")
          .select(
            "id, program_id, version_number, status, effective_from, title, description",
          )
          .in("id", [...ids])
          .order("id")
          .range(from, to),
    );
    const programIds = Array.from(
      new Set(versions.map((version) => version.program_id)),
    );
    type ScheduledProgramRow = {
      id: string;
      created_by_id: string;
      source_type: ProgramRow["source_type"];
      source_label: string;
    };
    const programs = await collectAllBatches<ScheduledProgramRow, string>(
      "Could not load scheduled workout programs",
      programIds,
      (ids, from, to) =>
        this.client
          .from("programs")
          .select("id, created_by_id, source_type, source_label")
          .in("id", [...ids])
          .order("id")
          .range(from, to),
    );
    const creatorIds = Array.from(
      new Set(programs.map((program) => program.created_by_id)),
    );
    const creators = (await this.loadConnectedProfileSummaries()).filter(
      (profile) => creatorIds.includes(profile.id),
    );
    return schedules
      .map((schedule) => {
        const workout = workouts.find(
          (candidate) => candidate.id === schedule.workout_id,
        );
        const week = workout
          ? weeks.find((candidate) => candidate.id === workout.program_week_id)
          : undefined;
        const version = versions.find(
          (candidate) => candidate.id === schedule.program_version_id,
        );
        const scheduledProgram = programs.find(
          (candidate) => candidate.id === version?.program_id,
        );
        const programTitle = version?.title || "Program";
        const mappedWorkout: PlannedWorkout = workout
          ? {
              id: workout.id,
              programVersionId: schedule.program_version_id,
              scheduledWorkoutId: schedule.id,
              plannedDate: schedule.planned_date ?? undefined,
              title: workout.title,
              dayLabel: week
                ? `Week ${week.week_index} · Workout ${workout.position + 1}`
                : `Session ${schedule.sequence_number ?? 1}`,
              durationMinutes: workout.estimated_minutes ?? 45,
              sections: [],
            }
          : {
              id: schedule.workout_id,
              programVersionId: schedule.program_version_id,
              scheduledWorkoutId: schedule.id,
              plannedDate: schedule.planned_date ?? undefined,
              title: "Workout",
              dayLabel: `Session ${schedule.sequence_number ?? 1}`,
              durationMinutes: 45,
              sections: [],
            };
        return {
          id: schedule.id,
          programId: version?.program_id ?? "",
          programTitle,
          programVersionId: schedule.program_version_id,
          workoutId: schedule.workout_id,
          workoutTitle: workout?.title ?? "Workout",
          slotLabel: `${programTitle}${version ? ` · v${version.version_number}` : ""} · ${mappedWorkout.dayLabel}`,
          plannedDate: schedule.planned_date ?? undefined,
          sequenceNumber: schedule.sequence_number ?? 0,
          status: schedule.status,
          sourceType: scheduledProgram?.source_type,
          sourceLabel: scheduledProgram?.source_label,
          createdByName: scheduledProgram
            ? creators.find(
                (profile) => profile.id === scheduledProgram.created_by_id,
              )?.display_name
            : undefined,
          workout: mappedWorkout,
          detailsLoaded: false,
        };
      })
      .sort((left, right) => {
        const leftVersion = versions.find(
          (version) => version.id === left.programVersionId,
        );
        const rightVersion = versions.find(
          (version) => version.id === right.programVersionId,
        );
        const statusRank = (version?: VersionRow) =>
          version?.status === "published" ? 0 : 1;
        return (
          statusRank(leftVersion) - statusRank(rightVersion) ||
          (rightVersion?.version_number ?? 0) -
            (leftVersion?.version_number ?? 0) ||
          left.sequenceNumber - right.sequenceNumber
        );
      });
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
    return result.data as OwnProfile;
  }

  async createBlankProgram(athleteId: string, title: string) {
    const result = await this.client.rpc("create_blank_program", {
      target_athlete_id: athleteId,
      target_title: title,
    });
    if (result.error || !result.data)
      fail("Could not create the program", result.error);
    return String(result.data);
  }

  async createBlankQuickWorkout(title: string) {
    const result = await this.client.rpc("create_blank_quick_workout", {
      target_title: title,
    });
    if (result.error || !result.data)
      fail("Could not create the workout", result.error);
    return String(result.data);
  }

  async updateProgramDescription(programId: string, description: string) {
    const result = await this.client
      .from("programs")
      .update({ description })
      .eq("id", programId);
    if (result.error)
      fail("Could not save the program description", result.error);
  }

  async updateProgramTitle(programId: string, title: string) {
    const result = await this.client
      .from("programs")
      .update({ title })
      .eq("id", programId);
    if (result.error) fail("Could not save the program name", result.error);
  }

  async createProgramFromTemplate(templateId: string) {
    const result = await this.client.rpc("create_program_from_template", {
      target_template_id: templateId,
    });
    if (result.error || !result.data)
      fail("Could not start the library program", result.error);
    return String(result.data);
  }

  async setProgramAvailability(programId: string, available: boolean) {
    const result = await this.client.rpc("set_program_availability", {
      target_program_id: programId,
      make_available: available,
    });
    if (result.error)
      fail(
        available
          ? "Could not add the program to scheduling"
          : "Could not remove the program from scheduling",
        result.error,
      );
  }

  async deleteOwnProgram(programId: string) {
    const result = await this.client.rpc("delete_own_program", {
      target_program_id: programId,
    });
    if (result.error) fail("Could not delete the program", result.error);
  }

  async copyProgramToOwn(programId: string) {
    const result = await this.client.rpc("copy_program_to_own", {
      target_program_id: programId,
    });
    if (result.error || !result.data)
      fail("Could not copy the program", result.error);
    return String(result.data);
  }

  async assignOwnProgramToAthletes(
    programId: string,
    athleteIds: string[],
  ): Promise<ProgramAssignment[]> {
    const uniqueAthleteIds = Array.from(new Set(athleteIds));
    if (uniqueAthleteIds.length === 0) {
      throw new Error("Choose at least one athlete");
    }

    const result = await this.client.rpc("assign_own_program_to_athletes", {
      target_program_id: programId,
      target_athlete_ids: uniqueAthleteIds,
    });
    if (result.error)
      fail("Could not assign the program to your athletes", result.error);

    return (
      (result.data ?? []) as Array<{
        athlete_id: string;
        assigned_program_id: string;
        created: boolean;
      }>
    ).map((assignment) => ({
      athleteId: assignment.athlete_id,
      programId: assignment.assigned_program_id,
      created: assignment.created,
    }));
  }

  async assignQuickWorkoutToAthletes(
    programId: string,
    athleteIds: string[],
    plannedDate: string,
  ): Promise<ProgramAssignment[]> {
    const result = await this.client.rpc("assign_quick_workout_to_athletes", {
      target_program_id: programId,
      target_athlete_ids: Array.from(new Set(athleteIds)),
      target_planned_date: plannedDate,
    });
    if (result.error)
      fail("Could not assign and schedule the workout", result.error);
    return (result.data as Array<{
      athlete_id: string;
      assigned_program_id: string;
      created: boolean;
    }>).map((assignment) => ({
      athleteId: assignment.athlete_id,
      programId: assignment.assigned_program_id,
      created: assignment.created,
    }));
  }

  async addProgramWeek(versionId: string) {
    const result = await this.client.rpc("add_program_week", {
      target_version_id: versionId,
    });
    if (result.error || !result.data)
      fail("Could not add a program week", result.error);
    return String(result.data);
  }

  async deleteProgramWeek(weekId: string) {
    const result = await this.client.rpc("delete_program_week", {
      target_week_id: weekId,
    });
    if (result.error) fail("Could not delete the program week", result.error);
  }

  async deleteWorkout(workoutId: string) {
    const result = await this.client.rpc("delete_program_workout", {
      target_workout_id: workoutId,
    });
    if (result.error) fail("Could not delete the workout", result.error);
  }

  async addWorkoutSection(workoutId: string, title: string, kind: string) {
    const result = await this.client.rpc("add_workout_section", {
      target_workout_id: workoutId,
      target_title: title,
      target_kind: kind,
    });
    if (result.error || !result.data)
      fail("Could not add the workout section", result.error);
    return String(result.data);
  }

  async deleteWorkoutSection(sectionId: string, deleteItems: boolean) {
    const result = await this.client.rpc("delete_workout_section", {
      target_section_id: sectionId,
      delete_items: deleteItems,
    });
    if (result.error)
      fail("Could not delete the workout section", result.error);
  }

  async updateWorkoutSection(
    sectionId: string,
    title: string,
    kind: NonNullable<WorkoutSection["kind"]>,
  ) {
    const result = await this.client.rpc("update_workout_section", {
      target_section_id: sectionId,
      target_title: title,
      target_kind: kind,
    });
    if (result.error)
      fail("Could not update the workout section", result.error);
  }

  async reorderWorkoutSections(workoutId: string, sectionIds: string[]) {
    const result = await this.client.rpc("reorder_workout_sections", {
      target_workout_id: workoutId,
      ordered_ids: sectionIds,
    });
    if (result.error) fail("Could not reorder workout sections", result.error);
  }

  async reorderWorkouts(weekId: string, workoutIds: string[]) {
    const result = await this.client.rpc("reorder_week_workouts", {
      target_week_id: weekId,
      ordered_ids: workoutIds,
    });
    if (result.error) fail("Could not reorder workouts", result.error);
  }

  async reorderWorkoutItems(sectionId: string, itemIds: string[]) {
    const result = await this.client.rpc("reorder_section_items", {
      target_section_id: sectionId,
      ordered_ids: itemIds,
    });
    if (result.error) fail("Could not reorder exercises", result.error);
  }

  async moveWorkoutItem(
    itemId: string,
    destinationSectionId: string,
    destinationPosition: number,
  ) {
    const result = await this.client.rpc("move_workout_item", {
      target_item_id: itemId,
      destination_section_id: destinationSectionId,
      destination_position: destinationPosition,
    });
    if (result.error) fail("Could not move the exercise", result.error);
  }

  async createProgramDraft(programId: string) {
    const result = await this.client.rpc("create_program_draft", {
      target_program_id: programId,
    });
    if (result.error || !result.data)
      fail("Could not create an editable program copy", result.error);
    return String(result.data);
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
  }

  async prepareProgramSchedule(programVersionId: string) {
    const result = await this.client.rpc("prepare_program_schedule", {
      target_program_version_id: programVersionId,
    });
    if (result.error)
      fail("Could not prepare the program calendar", result.error);
  }

  async deactivateProgram(programId: string) {
    const result = await this.client.rpc("deactivate_current_program", {
      target_program_id: programId,
    });
    if (result.error)
      fail("Could not deactivate the current program", result.error);
  }

  async listExercises() {
    const rows = await collectAllPages<ExerciseRow>(
      "Could not load the exercise library",
      (from, to) =>
        this.client
          .from("exercises")
          .select(
            "id, scope, owner_id, name, category, discipline, tags, cue, default_entry_mode, default_tracking_fields",
          )
          .is("archived_at", null)
          .order("name")
          .order("id")
          .range(from, to),
    );
    return rows.map((row) =>
      mapExercise(row, this.viewerName),
    );
  }

  async createPersonalExercise(input: CreateExerciseInput) {
    const fields: TrackingField[] =
      input.mode === "sets"
        ? ["reps", "load", "rpe"]
        : input.mode === "result"
          ? ["duration", "distance", "rpe"]
          : input.mode === "intervals"
            ? ["rounds", "duration", "rpe"]
            : [];
    const result = await this.client
      .from("exercises")
      .insert({
        scope: "personal",
        owner_id: this.viewerId,
        name: input.name,
        category: input.category || "Custom",
        cue: input.cue,
        default_entry_mode: input.mode,
        default_tracking_fields: fields,
      })
      .select(
        "id, scope, owner_id, name, category, discipline, tags, cue, default_entry_mode, default_tracking_fields",
      )
      .single();
    if (result.error || !result.data)
      fail("Could not save the exercise", result.error);
    return mapExercise(result.data as ExerciseRow, this.viewerName);
  }

  async archivePersonalExercise(exerciseId: string) {
    const result = await this.client
      .from("exercises")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", exerciseId)
      .eq("scope", "personal")
      .eq("owner_id", this.viewerId)
      .select("id")
      .maybeSingle();
    if (result.error || !result.data)
      fail("Could not delete the exercise", result.error);
  }

  async addWorkout(
    program: Program,
    weekId: string,
    title: string,
  ): Promise<PlannedWorkout> {
    const week = program.weeks.find((item) => item.id === weekId);
    if (!week) fail("The selected week no longer exists", null);
    const workoutResult = await this.client
      .from("workouts")
      .insert({
        program_week_id: weekId,
        title,
        day_of_week: null,
        schedule_label: `Workout ${week.workouts.length + 1}`,
        position: week.workouts.length,
        estimated_minutes: 45,
      })
      .select("id")
      .single();
    if (workoutResult.error || !workoutResult.data)
      fail("Could not add the workout", workoutResult.error);
    const workoutId = String(workoutResult.data.id);
    const sectionResult = await this.client
      .from("workout_sections")
      .insert([
        {
          workout_id: workoutId,
          title: "Warm up",
          section_kind: "warmup",
          position: 0,
        },
        {
          workout_id: workoutId,
          title: "Main work",
          section_kind: "main",
          position: 1,
        },
        {
          workout_id: workoutId,
          title: "Cooldown",
          section_kind: "cooldown",
          position: 2,
        },
      ])
      .select("id, title, section_kind, position");
    if (sectionResult.error || !sectionResult.data || sectionResult.data.length !== 3)
      fail("Could not prepare the workout sections", sectionResult.error);
    return {
      id: workoutId,
      title,
      dayLabel: `Workout ${week.workouts.length + 1}`,
      durationMinutes: 45,
      sections: [
        ...sectionResult.data
          .sort((left, right) => left.position - right.position)
          .map((section) => ({
            id: String(section.id),
            title: String(section.title),
            kind: section.section_kind as WorkoutSection["kind"],
            items: [],
          })),
      ],
    };
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
  }

  async addWorkoutItem(
    section: WorkoutSection,
    exercise: Exercise,
  ): Promise<WorkoutItem> {
    const result = await this.client
      .from("workout_items")
      .insert({
        section_id: section.id,
        source_exercise_id: exercise.id,
        snapshot_name: exercise.name,
        snapshot_cue: exercise.cue,
        entry_mode: exercise.defaultMode,
        tracking_fields: exercise.defaultFields,
        position: section.items.length,
      })
      .select("id")
      .single();
    if (result.error || !result.data)
      fail("Could not add the exercise to the workout", result.error);
    const itemId = String(result.data.id);
    const prescription: Prescription =
      exercise.defaultMode === "sets"
        ? { sets: 3, reps: "8", targetRpe: "7–8" }
        : exercise.defaultMode === "intervals"
          ? { rounds: 5, workSeconds: 60, restSeconds: 60 }
          : exercise.defaultMode === "result"
            ? { durationMinutes: 20 }
            : {};

    const entries: PrescriptionInsert[] =
      exercise.defaultMode === "sets"
        ? Array.from({ length: 3 }, (_, position) => ({
            workout_item_id: itemId,
            position,
            reps_min: 8,
            reps_max: 8,
            target_rpe_min: 7,
            target_rpe_max: 8,
          }))
        : exercise.defaultMode === "intervals"
          ? [
              {
                workout_item_id: itemId,
                position: 0,
                rounds: 5,
                work_seconds: 60,
                rest_seconds: 60,
              },
            ]
          : exercise.defaultMode === "result"
            ? [{ workout_item_id: itemId, position: 0, duration_seconds: 1200 }]
            : [];
    if (entries.length) {
      const entriesResult = await this.client
        .from("prescribed_entries")
        .insert(entries);
      if (entriesResult.error)
        fail("Could not save the exercise prescription", entriesResult.error);
    }
    return {
      id: itemId,
      exerciseId: exercise.id,
      title: exercise.name,
      cue: exercise.cue,
      mode: exercise.defaultMode,
      fields: exercise.defaultFields,
      prescription,
    };
  }

  async removeWorkoutItem(itemId: string) {
    const result = await this.client.rpc("delete_workout_item", {
      target_item_id: itemId,
    });
    if (result.error) fail("Could not remove the workout item", result.error);
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
  }

  async duplicateWeek(sourceWeekId: string, targetWeekId: string) {
    const result = await this.client.rpc("duplicate_program_week", {
      source_week_id: sourceWeekId,
      target_week_id: targetWeekId,
    });
    if (result.error) fail("Could not copy the previous week", result.error);
  }

  async duplicateWeekTimes(sourceWeekId: string, copyCount: number) {
    const result = await this.client.rpc("duplicate_program_week_times", {
      source_week_id: sourceWeekId,
      copy_count: copyCount,
    });
    if (result.error) fail("Could not copy the week", result.error);
    return (result.data as Array<{ week_id: string }>).map(
      (row) => row.week_id,
    );
  }

  async publishProgram(versionId: string, effectiveOn = localDateOnly()) {
    const result = await this.client.rpc("publish_program_version", {
      target_version_id: versionId,
      effective_on: effectiveOn,
    });
    if (result.error) fail("Could not publish the program", result.error);
  }

  async startOrResumeSession(
    workout: PlannedWorkout,
    programVersionId: string,
  ) {
    const result = await this.client.rpc("start_or_resume_workout", {
      target_workout_id: workout.id,
      target_program_version_id: programVersionId,
      target_scheduled_workout_id: workout.scheduledWorkoutId ?? null,
    });
    if (result.error) fail("Could not start the workout", result.error);
    return this.loadActiveSession(String(result.data));
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
    const result = await this.client.rpc("save_workout_session_draft", {
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
    if (result.error) fail("Could not save workout changes", result.error);
    const record = jsonRecord(result.data);
    if (!record)
      throw new Error("Workout autosave returned an invalid response");
    const revision = jsonInteger(record, "revision");
    if (revision === undefined)
      throw new Error("Workout autosave did not confirm a revision");
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
    if (result.error) fail("Could not complete the workout", result.error);
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
    return this.cacheImmutable(
      this.completedSessionCache,
      `${athleteId}:${sessionId}`,
      () => this.loadCompletedSessionDetailUncached(sessionId, athleteId),
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

    const sessionResult = await this.client
      .from("workout_sessions")
      .select(
        "id, draft_revision, program_version_id, workout_id, scheduled_workout_id, workout_title, started_at, completed_at, completed_for_date, session_rpe",
      )
      .eq("id", sessionId)
      .eq("athlete_id", this.viewerId)
      .eq("status", "completed")
      .maybeSingle();
    if (sessionResult.error)
      fail("Could not load workout results", sessionResult.error);
    if (!sessionResult.data) return null;

    const session = sessionResult.data as SessionRow;
    const [itemsResult, notes] = await Promise.all([
      this.client
        .from("session_item_logs")
        .select(
          "id, workout_session_id, source_workout_item_id, snapshot_name, snapshot_cue, entry_mode, tracking_fields, position",
        )
        .eq("workout_session_id", session.id)
        .order("position"),
      this.loadOwnSessionNotes(session.id),
    ]);
    if (itemsResult.error)
      fail("Could not load completed workout items", itemsResult.error);
    const items = itemsResult.data as CompletedSessionItemRow[];
    const itemIds = items.map((item) => item.id);
    const entriesResult = itemIds.length
      ? await this.client
          .from("session_entries")
          .select(
            "id, session_item_log_id, position, reps, load_kg, duration_seconds, distance_metres, rounds, heart_rate, rpe",
          )
          .in("session_item_log_id", itemIds)
          .order("position")
      : { data: [], error: null };
    if (entriesResult.error)
      fail("Could not load completed workout entries", entriesResult.error);
    const entries = entriesResult.data as SessionEntryRow[];

    return {
      ...mapCompletedSession(session, notes.sessionNote),
      items: items.map((item) => ({
        id: item.id,
        title: item.snapshot_name,
        cue: item.snapshot_cue,
        mode: item.entry_mode,
        fields: item.tracking_fields,
        position: item.position,
        note: notes.itemNotes[item.id] || undefined,
        entries: entries
          .filter((entry) => entry.session_item_log_id === item.id)
          .sort((left, right) => left.position - right.position)
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

  private async listCompletedSessions(
    athleteId: string,
  ): Promise<CompletedSession[]> {
    const rows = await collectAllPages<SessionRow>(
      "Could not load training history",
      (from, to) =>
        this.client
          .from("workout_sessions")
          .select(
            "id, program_version_id, workout_id, scheduled_workout_id, workout_title, started_at, completed_at, completed_for_date, session_rpe",
          )
          .eq("athlete_id", athleteId)
          .eq("status", "completed")
          .order("started_at", { ascending: false })
          .order("id")
          .range(from, to),
    );
    return rows.map((session) => mapCompletedSession(session));
  }

  private async loadActiveSession(
    sessionId?: string,
  ): Promise<ActiveSession | null> {
    let query = this.client
      .from("workout_sessions")
      .select(
        "id, program_version_id, workout_id, scheduled_workout_id, workout_title, started_at, completed_at, completed_for_date, session_rpe",
      )
      .eq("athlete_id", this.viewerId)
      .eq("status", "in_progress")
      .order("started_at", { ascending: false })
      .limit(1);
    if (sessionId) query = query.eq("id", sessionId);
    const sessionResult = await query.maybeSingle();
    if (sessionResult.error)
      fail("Could not restore the active workout", sessionResult.error);
    if (!sessionResult.data) return null;
    const session = sessionResult.data as SessionRow;
    if (!session.workout_id || !session.program_version_id) return null;

    const [itemsResult, notes] = await Promise.all([
      this.client
        .from("session_item_logs")
        .select(
          "id, workout_session_id, source_workout_item_id, entry_mode, position",
        )
        .eq("workout_session_id", session.id)
        .order("position"),
      this.loadOwnSessionNotes(session.id),
    ]);
    if (itemsResult.error)
      fail("Could not restore workout items", itemsResult.error);
    const items = itemsResult.data as SessionItemRow[];
    const itemIds = items.map((item) => item.id);
    const entriesResult = itemIds.length
      ? await this.client
          .from("session_entries")
          .select(
            "id, session_item_log_id, position, reps, load_kg, duration_seconds, distance_metres, rounds, heart_rate, rpe",
          )
          .in("session_item_log_id", itemIds)
          .order("position")
      : { data: [], error: null };
    if (entriesResult.error)
      fail("Could not restore workout entries", entriesResult.error);
    const entries = entriesResult.data as SessionEntryRow[];

    const itemLogIds: Record<string, string> = {};
    const setLogs: Record<string, SessionSetValue[]> = {};
    const resultLogs: Record<string, Record<string, string>> = {};
    for (const item of items) {
      if (!item.source_workout_item_id) continue;
      itemLogIds[item.source_workout_item_id] = item.id;
      const values = entries
        .filter((entry) => entry.session_item_log_id === item.id)
        .sort((left, right) => left.position - right.position);
      if (item.entry_mode === "sets") {
        setLogs[item.source_workout_item_id] = values.map((entry) => ({
          reps: displayNumber(entry.reps),
          load: displayNumber(entry.load_kg),
          rpe: displayNumber(entry.rpe),
        }));
      } else if (item.entry_mode !== "none") {
        const entry = values[0];
        resultLogs[item.source_workout_item_id] = entry
          ? {
              rounds: displayNumber(entry.rounds),
              duration:
                entry.duration_seconds === null
                  ? ""
                  : String(entry.duration_seconds / 60),
              distance:
                numberValue(entry.distance_metres) === null
                  ? ""
                  : String(Number(entry.distance_metres) / 1000),
              heartRate: displayNumber(entry.heart_rate),
              rpe: displayNumber(entry.rpe),
            }
          : {};
      }
    }

    return {
      id: session.id,
      draftRevision: numberValue(session.draft_revision) ?? 0,
      workoutId: session.workout_id,
      programVersionId: session.program_version_id,
      scheduledWorkoutId: session.scheduled_workout_id ?? undefined,
      itemLogIds,
      setLogs,
      resultLogs,
      sessionRpe: displayNumber(session.session_rpe) || "7",
      sessionNote: notes.sessionNote,
    };
  }

  private async loadCoachConnections(): Promise<CoachConnection[]> {
    const relationshipResult = await this.client
      .from("coach_relationships")
      .select("id, athlete_id, coach_id, accepted_at")
      .eq("athlete_id", this.viewerId)
      .is("ended_at", null)
      .order("accepted_at", { ascending: true });
    if (relationshipResult.error)
      fail("Could not load coach access", relationshipResult.error);
    const relationships = relationshipResult.data as RelationshipRow[];
    if (!relationships.length) return [];
    const profiles = await this.loadConnectedProfileSummaries();
    return relationships.map((relationship) => {
      const profile = profiles.find(
        (item) => item.id === relationship.coach_id,
      );
      const name = profile?.display_name ?? "Coach";
      return {
        relationshipId: relationship.id,
        coachId: relationship.coach_id,
        name,
        initials: initials(name),
        connectedSince: relationship.accepted_at.slice(0, 10),
      };
    });
  }

  private async loadCoachedAthletes(): Promise<AthleteSummary[]> {
    const result = await this.client.rpc(
      "list_authored_coach_athlete_overviews",
      { target_limit: 250 },
    );
    if (result.error)
      fail("Could not load coached athletes", result.error);
    return parseCoachAthleteOverviews(result.data);
  }

  async loadCoachedAthleteDetail(
    athleteId: string,
  ): Promise<AthleteSummary | null> {
    const result = await this.client.rpc(
      "get_authored_coach_athlete_detail",
      {
        target_athlete_id: athleteId,
        target_program_limit: 250,
        target_upcoming_limit: 6,
        target_completed_limit: 6,
        target_progress_limit: 104,
      },
    );
    if (result.error)
      fail("Could not load the athlete overview", result.error);
    return parseCoachAthleteOverviews(result.data)[0] ?? null;
  }

  private async loadPendingCoachInvites(): Promise<PendingCoachInvite[]> {
    const result = await this.client.rpc("list_pending_coach_invites");
    if (result.error)
      fail("Could not load pending coaching invitations", result.error);

    return (
      (result.data ?? []) as Array<{
        id: string;
        athlete_id: string;
        athlete_name: string;
        created_at: string;
        expires_at: string;
      }>
    ).map((invite) => ({
      id: invite.id,
      athleteId: invite.athlete_id,
      athleteName: invite.athlete_name,
      athleteInitials: initials(invite.athlete_name),
      createdAt: invite.created_at,
      expiresAt: invite.expires_at,
    }));
  }

  private async loadOutgoingCoachInvites(): Promise<OutgoingCoachInvite[]> {
    const result = await this.client.rpc("list_outgoing_coach_invites");
    if (result.error)
      fail("Could not load pending coach requests", result.error);

    return (
      (result.data ?? []) as Array<{
        id: string;
        coach_id: string;
        coach_name: string;
        created_at: string;
        expires_at: string;
      }>
    ).map((invite) => ({
      id: invite.id,
      coachId: invite.coach_id,
      coachName: invite.coach_name,
      coachInitials: initials(invite.coach_name),
      createdAt: invite.created_at,
      expiresAt: invite.expires_at,
    }));
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
    return result.data as CoachInviteReceipt;
  }

  async cancelCoachInvite(inviteId: string): Promise<void> {
    const result = await this.client.rpc("cancel_coach_invite", {
      target_invite_id: inviteId,
    });
    if (result.error)
      fail("Could not cancel the coaching request", result.error);
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
  }
}
