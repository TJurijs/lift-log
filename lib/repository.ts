import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ActiveSession,
  AthleteSummary,
  CoachAgendaEntry,
  CoachAssignedProgramStatus,
  CoachAssignedProgramSummary,
  CoachConnection,
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
  WorkoutSection,
  WorkspaceData,
} from "./domain";
import { recordClientPerformance } from "./performance";

type NumericValue = number | string | null;

interface ProfileRow {
  id: string;
  display_name: string;
  first_name: string;
  last_name: string;
  liftlog_id: string;
  week_starts_on_sunday?: boolean;
  weight_unit?: "kg" | "lb";
  distance_unit?: "km" | "mi";
  timezone?: string | null;
}

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
  program_version_id: string | null;
  workout_id: string | null;
  scheduled_workout_id: string | null;
  workout_title: string;
  started_at: string;
  completed_at: string | null;
  completed_for_date: string | null;
  session_rpe: NumericValue;
  athlete_note: string;
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
  athlete_note: string;
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
  note: string;
}

interface RelationshipRow {
  id: string;
  athlete_id: string;
  coach_id: string;
  accepted_at: string;
}

interface CoachProgramRow {
  id: string;
  athlete_id: string;
  created_by_id: string;
  title: string;
  created_at: string;
  source_type: "coach";
  assigned_from_program_id: string | null;
}

interface CoachScheduleRow extends ScheduleRow {
  athlete_id: string;
}

interface CoachSessionRow extends SessionRow {
  athlete_id: string;
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

function dateOnly(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function mapCompletedSession(session: SessionRow): CompletedSession {
  const start = new Date(session.started_at);
  const end = session.completed_at ? new Date(session.completed_at) : start;
  return {
    id: session.id,
    programVersionId: session.program_version_id ?? undefined,
    workoutId: session.workout_id ?? undefined,
    workoutTitle: session.workout_title,
    date: session.completed_for_date ?? dateOnly(start),
    durationMinutes: Math.max(
      1,
      Math.round((end.getTime() - start.getTime()) / 60_000),
    ),
    rpe: numberValue(session.session_rpe) ?? 0,
    note: session.athlete_note || undefined,
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
  const effective = new Date(`${version.effective_from}T00:00:00`);
  const elapsed = Math.floor(
    (Date.now() - effective.getTime()) / (7 * 86_400_000),
  );
  return Math.min(Math.max(elapsed + 1, 1), Math.max(weekCount, 1));
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

export class LiftLogRepository {
  private workspaceLoadPromise: Promise<WorkspaceData> | null = null;

  constructor(
    private readonly client: SupabaseClient,
    private readonly viewerId: string,
    private readonly viewerName: string,
  ) {}

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
      coachConnections,
      coachedAthletes,
      pendingCoachInvites,
      outgoingCoachInvites,
      activeSession,
    ] = await Promise.all([
      this.loadOwnProfile(),
      this.loadProgramCatalog(this.viewerId),
      this.listAvailableProgramIds(),
      this.listProgramTemplates(),
      this.listScheduledWorkouts(this.viewerId),
      this.listExercises(),
      this.listCompletedSessions(this.viewerId),
      this.loadCoachConnections(),
      this.loadCoachedAthletes(),
      this.loadPendingCoachInvites(),
      this.loadOutgoingCoachInvites(),
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
      coachConnections,
      coachedAthletes,
      pendingCoachInvites,
      outgoingCoachInvites,
      activeSession,
    };
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
      .select("id, program_id, version_number, status, effective_from")
      .eq("id", versionId)
      .eq("program_id", programId)
      .in("status", ["published", "superseded"])
      .maybeSingle();
    if (versionResult.error)
      fail("Could not load the athlete program version", versionResult.error);
    if (!versionResult.data) return null;
    const version = versionResult.data as VersionRow;

    const profilesResult = await this.client
      .from("profiles")
      .select("id, display_name")
      .in("id", [programRow.athlete_id, programRow.created_by_id]);
    if (profilesResult.error)
      fail("Could not load program people", profilesResult.error);
    const profiles = profilesResult.data as ProfileRow[];
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
    const programsResult = await this.client
      .from("programs")
      .select(
        "id, athlete_id, created_by_id, title, description, source_type, source_label, template_id, content_type",
      )
      .eq("athlete_id", athleteId)
      .eq("is_current", true)
      .is("archived_at", null)
      .order("created_at", { ascending: false });
    if (programsResult.error) fail("Could not load programs", programsResult.error);
    const programRows = programsResult.data as ProgramRow[];
    if (!programRows.length) return [];

    // Startup only needs card metadata and workout ids for scheduling progress.
    // Full weeks, exercises, and prescriptions are fetched when a program opens.
    const programIds = programRows.map((program) => program.id);
    const versionsResult = await this.client
      .from("program_versions")
      .select("id, program_id, version_number, status, effective_from")
      .in("program_id", programIds)
      .order("version_number", { ascending: false });
    if (versionsResult.error) fail("Could not load program versions", versionsResult.error);
    const versions = versionsResult.data as VersionRow[];
    const selectedVersions = programRows.flatMap((program) => {
      const programVersions = versions.filter((version) => version.program_id === program.id);
      const active = programVersions.find((version) => version.status === "published");
      const draft = programVersions.find((version) => version.status === "draft");
      return active ? [active] : draft ? [draft] : [];
    });
    if (!selectedVersions.length) return [];

    const selectedVersionIds = selectedVersions.map((version) => version.id);
    const [profilesResult, weeksResult] = await Promise.all([
      this.client
        .from("profiles")
        .select("id, display_name")
        .in(
          "id",
          Array.from(
            new Set(
              programRows.flatMap((program) => [
                program.athlete_id,
                program.created_by_id,
              ]),
            ),
          ),
        ),
      this.client
        .from("program_weeks")
        .select("id, program_version_id, week_index, label")
        .in("program_version_id", selectedVersionIds)
        .order("week_index"),
    ]);
    if (profilesResult.error) fail("Could not load program people", profilesResult.error);
    if (weeksResult.error) fail("Could not load program weeks", weeksResult.error);
    const profiles = profilesResult.data as ProfileRow[];
    const weeks = weeksResult.data as WeekRow[];
    const weekIds = weeks.map((week) => week.id);
    const workoutsResult = weekIds.length
      ? await this.client
          .from("workouts")
          .select("id, program_week_id")
          .in("program_week_id", weekIds)
      : { data: [], error: null };
    if (workoutsResult.error) fail("Could not load workouts", workoutsResult.error);
    const workouts = workoutsResult.data as Array<Pick<WorkoutRow, "id" | "program_week_id">>;

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
        title: row.title,
        description: row.description,
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
    const result = await this.client
      .from("program_availability")
      .select("program_id")
      .eq("athlete_id", this.viewerId);
    if (result.error) fail("Could not load available programs", result.error);
    return (result.data as Array<{ program_id: string }>).map(
      (row) => row.program_id,
    );
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

  private async loadOwnProfile(): Promise<LoadedOwnProfile> {
    const result = await this.client
      .from("profiles")
      .select(
        "id, display_name, first_name, last_name, liftlog_id, week_starts_on_sunday, weight_unit, distance_unit, timezone",
      )
      .eq("id", this.viewerId)
      .single();
    if (result.error || !result.data)
      fail("Could not load your account", result.error);
    const row = result.data as ProfileRow;
    return {
      profile: {
        id: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
        displayName: row.display_name,
        liftlogId: row.liftlog_id,
        weekStartsOnSunday: row.week_starts_on_sunday ?? false,
        weightUnit: row.weight_unit ?? "kg",
        distanceUnit: row.distance_unit ?? "km",
      },
      timezone: row.timezone ?? null,
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
      .select("id, program_id, version_number, status, effective_from")
      .eq("program_id", loadedProgramId)
      .order("version_number", { ascending: false });
    if (versionsResult.error)
      fail("Could not load program versions", versionsResult.error);
    const versions = versionsResult.data as VersionRow[];

    const draftVersion = versions.find((version) => version.status === "draft");
    const activeVersion = versions.find(
      (version) => version.status === "published",
    );

    const profileIds = Array.from(
      new Set([programRow.athlete_id, programRow.created_by_id]),
    );
    const profilesResult = await this.client
      .from("profiles")
      .select("id, display_name")
      .in("id", profileIds);
    if (profilesResult.error)
      fail("Could not load program people", profilesResult.error);
    const profiles = profilesResult.data as ProfileRow[];
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
    const [phasesResult, weeksResult, schedulesResult] = await Promise.all([
      this.client
        .from("program_phases")
        .select("id, program_version_id, name, position")
        .eq("program_version_id", version.id),
      this.client
        .from("program_weeks")
        .select("id, program_version_id, phase_id, week_index, label")
        .eq("program_version_id", version.id)
        .order("week_index"),
      this.client
        .from("scheduled_workouts")
        .select(
          "id, program_version_id, workout_id, planned_date, sequence_number, status",
        )
        .eq("program_version_id", version.id),
    ]);
    if (phasesResult.error)
      fail("Could not load program phases", phasesResult.error);
    if (weeksResult.error)
      fail("Could not load program weeks", weeksResult.error);
    if (schedulesResult.error)
      fail("Could not load scheduled workouts", schedulesResult.error);
    const phases = phasesResult.data as PhaseRow[];
    const weeks = weeksResult.data as WeekRow[];
    const schedules = schedulesResult.data as ScheduleRow[];

    const weekIds = weeks.map((week) => week.id);
    const workoutsResult = weekIds.length
      ? await this.client
          .from("workouts")
          .select(
            "id, program_week_id, title, day_of_week, schedule_label, position, estimated_minutes",
          )
          .in("program_week_id", weekIds)
          .order("position")
      : { data: [], error: null };
    if (workoutsResult.error)
      fail("Could not load workouts", workoutsResult.error);
    const workouts = workoutsResult.data as WorkoutRow[];

    const workoutIds = workouts.map((workout) => workout.id);
    const sectionsResult = workoutIds.length
      ? await this.client
          .from("workout_sections")
          .select("id, workout_id, title, section_kind, notes, position")
          .in("workout_id", workoutIds)
          .order("position")
      : { data: [], error: null };
    if (sectionsResult.error)
      fail("Could not load workout sections", sectionsResult.error);
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
      fail("Could not load workout items", itemsResult.error);
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
      fail("Could not load workout prescriptions", prescriptionsResult.error);
    const prescriptions = prescriptionsResult.data as PrescriptionRow[];

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
      title: programRow.title,
      description: programRow.description,
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
    let schedulesQuery = this.client
      .from("scheduled_workouts")
      .select(
        "id, program_version_id, workout_id, planned_date, sequence_number, status",
      )
      .eq("athlete_id", athleteId)
      .order("sequence_number", { ascending: true });
    if (scheduleId) schedulesQuery = schedulesQuery.eq("id", scheduleId);
    const schedulesResult = await schedulesQuery;
    if (schedulesResult.error)
      fail("Could not load scheduled workouts", schedulesResult.error);
    const schedules = schedulesResult.data as ScheduleRow[];
    if (!schedules.length) return [];
    const workoutsResult = await this.client
      .from("workouts")
      .select(
        "id, program_week_id, title, day_of_week, schedule_label, position, estimated_minutes",
      )
      .in(
        "id",
        schedules.map((schedule) => schedule.workout_id),
      );
    if (workoutsResult.error)
      fail("Could not load scheduled workout names", workoutsResult.error);
    const workouts = workoutsResult.data as WorkoutRow[];
    const weekIds = Array.from(
      new Set(workouts.map((workout) => workout.program_week_id)),
    );
    const weeksResult = weekIds.length
      ? await this.client
          .from("program_weeks")
          .select("id, program_version_id, phase_id, week_index, label")
          .in("id", weekIds)
      : { data: [], error: null };
    if (weeksResult.error)
      fail("Could not load scheduled workout weeks", weeksResult.error);
    const weeks = weeksResult.data as WeekRow[];
    const versionIds = Array.from(
      new Set(schedules.map((schedule) => schedule.program_version_id)),
    );
    const versionsResult = await this.client
      .from("program_versions")
      .select("id, program_id, version_number, status, effective_from")
      .in("id", versionIds);
    if (versionsResult.error)
      fail("Could not load scheduled workout versions", versionsResult.error);
    const versions = versionsResult.data as VersionRow[];
    const programIds = Array.from(
      new Set(versions.map((version) => version.program_id)),
    );
    const programsResult = programIds.length
      ? await this.client
          .from("programs")
          .select("id, title, created_by_id, source_type, source_label")
          .in("id", programIds)
      : { data: [], error: null };
    if (programsResult.error)
      fail("Could not load scheduled workout programs", programsResult.error);
    const programs = programsResult.data as Array<{
      id: string;
      title: string;
      created_by_id: string;
      source_type: ProgramRow["source_type"];
      source_label: string;
    }>;
    const creatorIds = Array.from(
      new Set(programs.map((program) => program.created_by_id)),
    );
    const creatorsResult = creatorIds.length
      ? await this.client
          .from("profiles")
          .select("id, display_name")
          .in("id", creatorIds)
      : { data: [], error: null };
    if (creatorsResult.error)
      fail("Could not load scheduled workout creators", creatorsResult.error);
    const creators = creatorsResult.data as Array<{
      id: string;
      display_name: string;
    }>;
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
          programTitle: scheduledProgram?.title ?? "Program",
          programVersionId: schedule.program_version_id,
          workoutId: schedule.workout_id,
          workoutTitle: workout?.title ?? "Workout",
          slotLabel: `${scheduledProgram?.title ?? "Program"}${version ? ` · v${version.version_number}` : ""} · ${mappedWorkout.dayLabel}`,
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
    const result = await this.client
      .from("exercises")
      .select(
        "id, scope, owner_id, name, category, discipline, tags, cue, default_entry_mode, default_tracking_fields",
      )
      .is("archived_at", null)
      .order("name");
    if (result.error) fail("Could not load the exercise library", result.error);
    return (result.data as ExerciseRow[]).map((row) =>
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

  async publishProgram(versionId: string, effectiveOn = dateOnly(new Date())) {
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
  ) {
    for (const [itemId, itemLogId] of Object.entries(session.itemLogIds)) {
      const sets = setLogs[itemId];
      if (sets) {
        const rows = sets.map((set, position) => ({
          session_item_log_id: itemLogId,
          position,
          reps: numberValue(set.reps),
          load_kg: numberValue(set.load),
          rpe: numberValue(set.rpe),
        }));
        const upsert = await this.client
          .from("session_entries")
          .upsert(rows, { onConflict: "session_item_log_id,position" });
        if (upsert.error) fail("Could not save workout sets", upsert.error);
        const remove = await this.client
          .from("session_entries")
          .delete()
          .eq("session_item_log_id", itemLogId)
          .gte("position", rows.length);
        if (remove.error)
          fail("Could not reconcile removed sets", remove.error);
        continue;
      }

      const resultValue = resultLogs[itemId];
      if (resultValue) {
        const upsert = await this.client.from("session_entries").upsert(
          {
            session_item_log_id: itemLogId,
            position: 0,
            duration_seconds:
              numberValue(resultValue.duration) === null
                ? null
                : Math.round(Number(resultValue.duration) * 60),
            distance_metres:
              numberValue(resultValue.distance) === null
                ? null
                : Number(resultValue.distance) * 1000,
            rounds: numberValue(resultValue.rounds),
            heart_rate: numberValue(resultValue.heartRate),
            rpe: numberValue(resultValue.rpe),
          },
          { onConflict: "session_item_log_id,position" },
        );
        if (upsert.error) fail("Could not save workout result", upsert.error);
      }
    }
  }

  async completeSession(sessionId: string, rpe: string, note: string) {
    const result = await this.client.rpc("complete_workout_session", {
      target_session_id: sessionId,
      final_rpe: numberValue(rpe),
      final_note: note,
    });
    if (result.error) fail("Could not complete the workout", result.error);
  }

  async loadCompletedSessionDetail(
    sessionId: string,
    athleteId: string = this.viewerId,
  ): Promise<CompletedSessionDetail | null> {
    const sessionResult = await this.client
      .from("workout_sessions")
      .select(
        "id, program_version_id, workout_id, scheduled_workout_id, workout_title, started_at, completed_at, completed_for_date, session_rpe, athlete_note",
      )
      .eq("id", sessionId)
      .eq("athlete_id", athleteId)
      .eq("status", "completed")
      .maybeSingle();
    if (sessionResult.error)
      fail("Could not load workout results", sessionResult.error);
    if (!sessionResult.data) return null;

    const session = sessionResult.data as SessionRow;
    const itemsResult = await this.client
      .from("session_item_logs")
      .select(
        "id, workout_session_id, source_workout_item_id, snapshot_name, snapshot_cue, entry_mode, tracking_fields, position, athlete_note",
      )
      .eq("workout_session_id", session.id)
      .order("position");
    if (itemsResult.error)
      fail("Could not load completed workout items", itemsResult.error);
    const items = itemsResult.data as CompletedSessionItemRow[];
    const itemIds = items.map((item) => item.id);
    const entriesResult = itemIds.length
      ? await this.client
          .from("session_entries")
          .select("*")
          .in("session_item_log_id", itemIds)
          .order("position")
      : { data: [], error: null };
    if (entriesResult.error)
      fail("Could not load completed workout entries", entriesResult.error);
    const entries = entriesResult.data as SessionEntryRow[];

    return {
      ...mapCompletedSession(session),
      items: items.map((item) => ({
        id: item.id,
        title: item.snapshot_name,
        cue: item.snapshot_cue,
        mode: item.entry_mode,
        fields: item.tracking_fields,
        position: item.position,
        note: item.athlete_note || undefined,
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
            note: entry.note || undefined,
          })),
      })),
    };
  }

  private async listCompletedSessions(
    athleteId: string,
  ): Promise<CompletedSession[]> {
    const result = await this.client
      .from("workout_sessions")
      .select(
        "id, program_version_id, workout_id, scheduled_workout_id, workout_title, started_at, completed_at, completed_for_date, session_rpe, athlete_note",
      )
      .eq("athlete_id", athleteId)
      .eq("status", "completed")
      .order("started_at", { ascending: false });
    if (result.error) fail("Could not load training history", result.error);
    return (result.data as SessionRow[]).map(mapCompletedSession);
  }

  private async loadActiveSession(
    sessionId?: string,
  ): Promise<ActiveSession | null> {
    let query = this.client
      .from("workout_sessions")
      .select(
        "id, program_version_id, workout_id, scheduled_workout_id, workout_title, started_at, completed_at, completed_for_date, session_rpe, athlete_note",
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

    const itemsResult = await this.client
      .from("session_item_logs")
      .select(
        "id, workout_session_id, source_workout_item_id, entry_mode, position",
      )
      .eq("workout_session_id", session.id)
      .order("position");
    if (itemsResult.error)
      fail("Could not restore workout items", itemsResult.error);
    const items = itemsResult.data as SessionItemRow[];
    const itemIds = items.map((item) => item.id);
    const entriesResult = itemIds.length
      ? await this.client
          .from("session_entries")
          .select("*")
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
      workoutId: session.workout_id,
      programVersionId: session.program_version_id,
      scheduledWorkoutId: session.scheduled_workout_id ?? undefined,
      itemLogIds,
      setLogs,
      resultLogs,
      sessionRpe: displayNumber(session.session_rpe) || "7",
      sessionNote: session.athlete_note,
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
    const profileResult = await this.client
      .from("profiles")
      .select("id, display_name")
      .in(
        "id",
        relationships.map((relationship) => relationship.coach_id),
      );
    if (profileResult.error)
      fail("Could not load coach profiles", profileResult.error);
    const profiles = profileResult.data as ProfileRow[];
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
    const relationshipsResult = await this.client
      .from("coach_relationships")
      .select("id, athlete_id, coach_id, accepted_at")
      .eq("coach_id", this.viewerId)
      .is("ended_at", null);
    if (relationshipsResult.error)
      fail("Could not load coached athletes", relationshipsResult.error);
    const relationships = relationshipsResult.data as RelationshipRow[];
    if (!relationships.length) return [];

    const athleteIds = relationships.map(
      (relationship) => relationship.athlete_id,
    );
    const [profilesResult, programsResult] = await Promise.all([
      this.client
        .from("profiles")
        .select("id, display_name")
        .in("id", athleteIds),
      this.client
        .from("programs")
        .select(
          "id, athlete_id, created_by_id, title, created_at, source_type, assigned_from_program_id",
        )
        .in("athlete_id", athleteIds)
        .eq("created_by_id", this.viewerId)
        .eq("source_type", "coach")
        .eq("is_current", true)
        .is("archived_at", null)
        .order("created_at", { ascending: false }),
    ]);
    if (profilesResult.error)
      fail("Could not load athlete profiles", profilesResult.error);
    if (programsResult.error)
      fail("Could not load athlete programs", programsResult.error);

    const profiles = profilesResult.data as ProfileRow[];
    const programs = programsResult.data as CoachProgramRow[];
    const programIds = programs.map((program) => program.id);
    const versionsResult = programIds.length
      ? await this.client
          .from("program_versions")
          .select("id, program_id, version_number, status, effective_from")
          .in("program_id", programIds)
          .in("status", ["published", "superseded"])
          .order("version_number", { ascending: false })
      : { data: [], error: null };
    if (versionsResult.error)
      fail("Could not load athlete program versions", versionsResult.error);
    const versions = versionsResult.data as VersionRow[];
    const versionIds = versions.map((version) => version.id);

    const weeksResult = versionIds.length
      ? await this.client
          .from("program_weeks")
          .select("id, program_version_id, phase_id, week_index, label")
          .in("program_version_id", versionIds)
      : { data: [], error: null };
    if (weeksResult.error)
      fail("Could not load athlete program weeks", weeksResult.error);
    const weeks = weeksResult.data as WeekRow[];
    const weekIds = weeks.map((week) => week.id);

    const [workoutsResult, schedulesResult, sessionsResult] = await Promise.all(
      [
        weekIds.length
          ? this.client
              .from("workouts")
              .select(
                "id, program_week_id, title, day_of_week, schedule_label, position, estimated_minutes",
              )
              .in("program_week_id", weekIds)
          : Promise.resolve({ data: [], error: null }),
        versionIds.length
          ? this.client
              .from("scheduled_workouts")
              .select(
                "id, athlete_id, program_version_id, workout_id, planned_date, sequence_number, status",
              )
              .in("athlete_id", athleteIds)
              .in("program_version_id", versionIds)
          : Promise.resolve({ data: [], error: null }),
        versionIds.length
          ? this.client
              .from("workout_sessions")
              .select(
                "id, athlete_id, program_version_id, workout_id, scheduled_workout_id, workout_title, started_at, completed_at, completed_for_date, session_rpe, athlete_note",
              )
              .in("athlete_id", athleteIds)
              .in("program_version_id", versionIds)
              .eq("status", "completed")
          : Promise.resolve({ data: [], error: null }),
      ],
    );
    if (workoutsResult.error)
      fail("Could not load athlete program workouts", workoutsResult.error);
    if (schedulesResult.error)
      fail("Could not load athlete schedules", schedulesResult.error);
    if (sessionsResult.error)
      fail("Could not load athlete sessions", sessionsResult.error);

    const workouts = workoutsResult.data as WorkoutRow[];
    const schedules = schedulesResult.data as CoachScheduleRow[];
    const sessions = sessionsResult.data as CoachSessionRow[];
    const today = dateOnly(new Date());

    const versionProgram = new Map(
      versions.map((version) => [version.id, version.program_id]),
    );
    const programById = new Map(
      programs.map((program) => [program.id, program]),
    );
    const workoutById = new Map(
      workouts.map((workout) => [workout.id, workout]),
    );

    const workoutsForVersion = (versionId: string) => {
      const versionWeekIds = new Set(
        weeks
          .filter((week) => week.program_version_id === versionId)
          .map((week) => week.id),
      );
      return workouts.filter((workout) =>
        versionWeekIds.has(workout.program_week_id),
      );
    };

    const latestCycle = (
      versionSchedules: CoachScheduleRow[],
      totalWorkouts: number,
    ) => {
      if (!versionSchedules.length || totalWorkouts <= 0) return [];
      const numbered = versionSchedules.filter(
        (schedule) =>
          schedule.sequence_number !== null && schedule.sequence_number > 0,
      );
      if (!numbered.length) return versionSchedules;
      const maximumSequence = Math.max(
        ...numbered.map((schedule) => schedule.sequence_number ?? 0),
      );
      const cycleStart =
        Math.floor((maximumSequence - 1) / totalWorkouts) * totalWorkouts;
      return numbered.filter(
        (schedule) =>
          (schedule.sequence_number ?? 0) > cycleStart &&
          (schedule.sequence_number ?? 0) <= cycleStart + totalWorkouts,
      );
    };

    const assignedProgramsForAthlete = (
      athleteId: string,
    ): CoachAssignedProgramSummary[] =>
      programs
        .filter((program) => program.athlete_id === athleteId)
        .flatMap((program) => {
          const version = versions.find(
            (candidate) =>
              candidate.program_id === program.id &&
              candidate.status === "published",
          );
          if (!version) return [];
          const versionWorkouts = workoutsForVersion(version.id).sort(
            (left, right) =>
              (weeks.find((week) => week.id === left.program_week_id)
                ?.week_index ?? 0) -
                (weeks.find((week) => week.id === right.program_week_id)
                  ?.week_index ?? 0) ||
              left.position - right.position,
          );
          const totalWorkouts = versionWorkouts.length;
          const cycle = latestCycle(
            schedules.filter(
              (schedule) =>
                schedule.athlete_id === athleteId &&
                schedule.program_version_id === version.id,
            ),
            totalWorkouts,
          );
          const completedWorkouts = cycle.filter(
            (schedule) => schedule.status === "completed",
          ).length;
          const scheduledWorkouts = cycle.filter(
            (schedule) => schedule.planned_date !== null,
          ).length;
          const allTerminal =
            totalWorkouts > 0 &&
            cycle.length >= totalWorkouts &&
            cycle.every(
              (schedule) =>
                schedule.status === "completed" ||
                schedule.status === "skipped",
            );
          const hasStarted = cycle.some(
            (schedule) =>
              schedule.status === "in_progress" ||
              schedule.status === "completed" ||
              schedule.status === "skipped",
          );
          const hasScheduledDate = cycle.some(
            (schedule) =>
              schedule.status === "planned" && schedule.planned_date !== null,
          );
          const status: CoachAssignedProgramStatus = allTerminal
            ? "completed"
            : hasStarted
              ? "in_progress"
              : hasScheduledDate
                ? "scheduled"
                : "awaiting_schedule";
          const nextSchedule = cycle
            .filter(
              (schedule) =>
                schedule.status === "planned" &&
                schedule.planned_date !== null &&
                schedule.planned_date >= today,
            )
            .sort((left, right) =>
              String(left.planned_date).localeCompare(
                String(right.planned_date),
              ),
            )[0];
          const latestScheduleByWorkout = new Map<string, CoachScheduleRow>();
          cycle.forEach((schedule) => {
            const current = latestScheduleByWorkout.get(schedule.workout_id);
            if (
              !current ||
              (schedule.sequence_number ?? 0) >
                (current.sequence_number ?? 0)
            ) {
              latestScheduleByWorkout.set(schedule.workout_id, schedule);
            }
          });
          const workoutProgress = versionWorkouts.map((workout) => {
            const schedule = latestScheduleByWorkout.get(workout.id);
            if (!schedule || !schedule.planned_date || schedule.status === "skipped")
              return "unscheduled" as const;
            return schedule.status === "completed"
              ? ("completed" as const)
              : ("scheduled" as const);
          });

          return [
            {
              id: program.id,
              versionId: version.id,
              title: program.title,
              assignedAt: program.created_at.slice(0, 10),
              status,
              totalWorkouts,
              scheduledWorkouts,
              scheduledPercent:
                totalWorkouts > 0
                  ? Math.min(
                      100,
                      Math.round((scheduledWorkouts / totalWorkouts) * 100),
                    )
                  : 0,
              completedWorkouts,
              completionPercent:
                totalWorkouts > 0
                  ? Math.min(
                      100,
                      Math.round((completedWorkouts / totalWorkouts) * 100),
                    )
                  : 0,
              workoutProgress,
              nextWorkout: nextSchedule
                ? {
                    id: nextSchedule.id,
                    title:
                      workoutById.get(nextSchedule.workout_id)?.title ??
                      "Workout",
                    date: String(nextSchedule.planned_date),
                  }
                : undefined,
            },
          ];
        })
        .sort((left, right) => right.assignedAt.localeCompare(left.assignedAt));

    const agendaForAthlete = (athleteId: string): CoachAgendaEntry[] => {
      const upcoming: CoachAgendaEntry[] = schedules
        .filter(
          (schedule) =>
            schedule.athlete_id === athleteId &&
            (schedule.status === "planned" ||
              schedule.status === "in_progress") &&
            schedule.planned_date !== null,
        )
        .flatMap((schedule) => {
          const programId = versionProgram.get(schedule.program_version_id);
          const program = programId ? programById.get(programId) : undefined;
          if (!programId || !program) return [];
          return [
            {
              id: `schedule:${schedule.id}`,
              kind: "upcoming" as const,
              status:
                schedule.status === "in_progress"
                  ? ("in_progress" as const)
                  : String(schedule.planned_date) < today
                    ? ("overdue" as const)
                    : ("planned" as const),
              programId,
              programVersionId: schedule.program_version_id,
              programTitle: program.title,
              workoutId: schedule.workout_id,
              workoutTitle:
                workoutById.get(schedule.workout_id)?.title ?? "Workout",
              date: String(schedule.planned_date),
              scheduleId: schedule.id,
            },
          ];
        });
      const completed: CoachAgendaEntry[] = sessions
        .filter((session) => session.athlete_id === athleteId)
        .flatMap((session) => {
          if (!session.program_version_id) return [];
          const programId = versionProgram.get(session.program_version_id);
          const program = programId ? programById.get(programId) : undefined;
          if (!programId || !program) return [];
          return [
            {
              id: `session:${session.id}`,
              kind: "completed" as const,
              status: "completed" as const,
              programId,
              programVersionId: session.program_version_id,
              programTitle: program.title,
              workoutId: session.workout_id ?? undefined,
              workoutTitle: session.workout_title,
              date: dateOnly(
                new Date(session.completed_at ?? session.started_at),
              ),
              rpe: numberValue(session.session_rpe) ?? undefined,
              scheduleId: session.scheduled_workout_id ?? undefined,
              sessionId: session.id,
            },
          ];
        });
      return [...upcoming, ...completed].sort(
        (left, right) =>
          left.date.localeCompare(right.date) ||
          left.id.localeCompare(right.id),
      );
    };

    return relationships.map((relationship) => {
      const profile = profiles.find(
        (item) => item.id === relationship.athlete_id,
      );
      return {
        id: relationship.athlete_id,
        relationshipId: relationship.id,
        name: profile?.display_name ?? "Athlete",
        initials: initials(profile?.display_name ?? "Athlete"),
        assignedPrograms: assignedProgramsForAthlete(relationship.athlete_id),
        agenda: agendaForAthlete(relationship.athlete_id),
      };
    });
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
