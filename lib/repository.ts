import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ActiveSession,
  AthleteSummary,
  CoachConnection,
  CompletedSession,
  EntryMode,
  Exercise,
  PlannedWorkout,
  Prescription,
  Program,
  SessionSetValue,
  TrackingField,
  WorkoutItem,
  WorkoutSection,
  WorkspaceData,
} from "./domain";

type NumericValue = number | string | null;

interface ProfileRow {
  id: string;
  display_name: string;
}

interface ExerciseRow {
  id: string;
  scope: "global" | "personal";
  owner_id: string | null;
  name: string;
  category: string;
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
  planning_mode: "repeating_week" | "fixed_weeks";
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
  workout_id: string;
  planned_date: string | null;
}

interface SessionRow {
  id: string;
  workout_id: string | null;
  scheduled_workout_id: string | null;
  workout_title: string;
  started_at: string;
  completed_at: string | null;
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

interface RelationshipRow {
  id: string;
  athlete_id: string;
  coach_id: string;
  accepted_at: string;
}

interface ProgramPair {
  draftProgram: Program;
  activeProgram: Program;
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

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "LL";
}

function dayNumber(label: string) {
  const labels = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const index = labels.indexOf(label);
  return index === -1 ? null : index + 1;
}

function dateOnly(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function relativeTrainingLabel(isoDate: string | null) {
  if (!isoDate) return "No sessions yet";
  const trained = new Date(isoDate);
  const today = new Date();
  const diff = Math.max(0, Math.round((today.setHours(0, 0, 0, 0) - trained.setHours(0, 0, 0, 0)) / 86_400_000));
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return `${diff} days ago`;
}

function prescriptionFromRows(mode: EntryMode, rows: PrescriptionRow[]): Prescription {
  const ordered = [...rows].sort((left, right) => left.position - right.position);
  const first = ordered[0];
  if (!first) return {};
  const rpeLow = displayNumber(first.target_rpe_min);
  const rpeHigh = displayNumber(first.target_rpe_max);
  const targetRpe = rpeLow && rpeHigh && rpeLow !== rpeHigh ? `${rpeLow}–${rpeHigh}` : rpeLow || rpeHigh || undefined;

  if (mode === "sets") {
    const repsLow = displayNumber(first.reps_min);
    const repsHigh = displayNumber(first.reps_max);
    return {
      sets: ordered.length,
      reps: repsLow && repsHigh && repsLow !== repsHigh ? `${repsLow}–${repsHigh}` : repsLow || repsHigh || first.target_text || undefined,
      targetRpe,
    };
  }

  return {
    durationMinutes: first.duration_seconds ? first.duration_seconds / 60 : undefined,
    distance: numberValue(first.distance_metres) ? Number(numberValue(first.distance_metres)) / 1000 : undefined,
    distanceUnit: "km",
    rounds: first.rounds ?? undefined,
    workSeconds: first.work_seconds ?? undefined,
    restSeconds: first.rest_seconds ?? undefined,
    targetRpe,
  };
}

function activeWeekIndex(version: VersionRow, weekCount: number) {
  if (!version.effective_from || version.status === "draft") return 1;
  const effective = new Date(`${version.effective_from}T00:00:00`);
  const elapsed = Math.floor((Date.now() - effective.getTime()) / (7 * 86_400_000));
  return Math.min(Math.max(elapsed + 1, 1), Math.max(weekCount, 1));
}

function mapExercise(row: ExerciseRow, ownerName: string): Exercise {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    cue: row.cue,
    scope: row.scope,
    ownerName: row.scope === "personal" ? ownerName : undefined,
    defaultMode: row.default_entry_mode,
    defaultFields: row.default_tracking_fields,
  };
}

export class LiftLogRepository {
  constructor(
    private readonly client: SupabaseClient,
    private readonly viewerId: string,
    private readonly viewerName: string,
  ) {}

  async loadWorkspace(): Promise<WorkspaceData> {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timezone) {
      void this.client.from("profiles").update({ timezone }).eq("id", this.viewerId);
    }

    const [programs, exercises, completedSessions, coachConnection, coachedAthletes, activeSession] = await Promise.all([
      this.loadProgramPair(this.viewerId),
      this.listExercises(),
      this.listCompletedSessions(this.viewerId),
      this.loadCoachConnection(),
      this.loadCoachedAthletes(),
      this.loadActiveSession(),
    ]);

    return {
      ...programs,
      globalExercises: exercises.filter((exercise) => exercise.scope === "global"),
      personalExercises: exercises.filter((exercise) => exercise.scope === "personal"),
      completedSessions,
      coachConnection,
      coachedAthletes,
      activeSession,
    };
  }

  async loadProgramForAthlete(athleteId: string) {
    const programs = await this.loadProgramPair(athleteId);
    return programs.draftProgram;
  }

  private async loadProgramPair(athleteId: string): Promise<ProgramPair> {
    const ensure = await this.client.rpc("ensure_starter_program", { target_athlete_id: athleteId });
    if (ensure.error) fail("Could not prepare the training program", ensure.error);
    const programId = ensure.data as string;

    const programResult = await this.client.from("programs")
      .select("id, athlete_id, created_by_id, title, description, planning_mode")
      .eq("id", programId)
      .single();
    if (programResult.error || !programResult.data) fail("Could not load the training program", programResult.error);
    const programRow = programResult.data as ProgramRow;

    let versionsResult = await this.client.from("program_versions")
      .select("id, program_id, version_number, status, effective_from")
      .eq("program_id", programId)
      .order("version_number", { ascending: false });
    if (versionsResult.error) fail("Could not load program versions", versionsResult.error);
    let versions = versionsResult.data as VersionRow[];

    if (!versions.some((version) => version.status === "draft")) {
      const draft = await this.client.rpc("create_program_draft", { target_program_id: programId });
      if (draft.error) fail("Could not create an editable program draft", draft.error);
      versionsResult = await this.client.from("program_versions")
        .select("id, program_id, version_number, status, effective_from")
        .eq("program_id", programId)
        .order("version_number", { ascending: false });
      if (versionsResult.error) fail("Could not reload program versions", versionsResult.error);
      versions = versionsResult.data as VersionRow[];
    }

    const draftVersion = versions.find((version) => version.status === "draft");
    if (!draftVersion) fail("No editable program version is available", null);
    const activeVersion = versions.find((version) => version.status === "published") ?? draftVersion;

    const profileIds = Array.from(new Set([programRow.athlete_id, programRow.created_by_id]));
    const profilesResult = await this.client.from("profiles").select("id, display_name").in("id", profileIds);
    if (profilesResult.error) fail("Could not load program people", profilesResult.error);
    const profiles = profilesResult.data as ProfileRow[];
    const ownerName = profiles.find((profile) => profile.id === programRow.athlete_id)?.display_name ?? "Athlete";
    const createdByName = profiles.find((profile) => profile.id === programRow.created_by_id)?.display_name ?? ownerName;

    const draftProgram = await this.loadVersionTree(programRow, draftVersion, ownerName, createdByName);
    const activeProgram = activeVersion.id === draftVersion.id
      ? draftProgram
      : await this.loadVersionTree(programRow, activeVersion, ownerName, createdByName);
    return { draftProgram, activeProgram };
  }

  private async loadVersionTree(programRow: ProgramRow, version: VersionRow, ownerName: string, createdByName: string): Promise<Program> {
    const [phasesResult, weeksResult, schedulesResult] = await Promise.all([
      this.client.from("program_phases").select("id, program_version_id, name, position").eq("program_version_id", version.id),
      this.client.from("program_weeks").select("id, program_version_id, phase_id, week_index, label").eq("program_version_id", version.id).order("week_index"),
      this.client.from("scheduled_workouts").select("id, workout_id, planned_date").eq("program_version_id", version.id),
    ]);
    if (phasesResult.error) fail("Could not load program phases", phasesResult.error);
    if (weeksResult.error) fail("Could not load program weeks", weeksResult.error);
    if (schedulesResult.error) fail("Could not load scheduled workouts", schedulesResult.error);
    const phases = phasesResult.data as PhaseRow[];
    const weeks = weeksResult.data as WeekRow[];
    const schedules = schedulesResult.data as ScheduleRow[];

    const weekIds = weeks.map((week) => week.id);
    const workoutsResult = weekIds.length
      ? await this.client.from("workouts").select("id, program_week_id, title, day_of_week, schedule_label, position, estimated_minutes").in("program_week_id", weekIds).order("position")
      : { data: [], error: null };
    if (workoutsResult.error) fail("Could not load workouts", workoutsResult.error);
    const workouts = workoutsResult.data as WorkoutRow[];

    const workoutIds = workouts.map((workout) => workout.id);
    const sectionsResult = workoutIds.length
      ? await this.client.from("workout_sections").select("id, workout_id, title, section_kind, notes, position").in("workout_id", workoutIds).order("position")
      : { data: [], error: null };
    if (sectionsResult.error) fail("Could not load workout sections", sectionsResult.error);
    const sections = sectionsResult.data as SectionRow[];

    const sectionIds = sections.map((section) => section.id);
    const itemsResult = sectionIds.length
      ? await this.client.from("workout_items").select("id, section_id, source_exercise_id, snapshot_name, snapshot_cue, entry_mode, tracking_fields, position").in("section_id", sectionIds).order("position")
      : { data: [], error: null };
    if (itemsResult.error) fail("Could not load workout items", itemsResult.error);
    const items = itemsResult.data as ItemRow[];

    const itemIds = items.map((item) => item.id);
    const prescriptionsResult = itemIds.length
      ? await this.client.from("prescribed_entries").select("*").in("workout_item_id", itemIds).order("position")
      : { data: [], error: null };
    if (prescriptionsResult.error) fail("Could not load workout prescriptions", prescriptionsResult.error);
    const prescriptions = prescriptionsResult.data as PrescriptionRow[];

    const mappedWeeks = weeks.map((week) => ({
      id: week.id,
      index: week.week_index,
      label: week.label,
      workouts: workouts.filter((workout) => workout.program_week_id === week.id).sort((left, right) => left.position - right.position).map((workout): PlannedWorkout => {
        const schedule = schedules.find((occurrence) => occurrence.workout_id === workout.id);
        return {
          id: workout.id,
          scheduledWorkoutId: schedule?.id,
          plannedDate: schedule?.planned_date ?? undefined,
          title: workout.title,
          dayLabel: workout.schedule_label,
          durationMinutes: workout.estimated_minutes ?? 45,
          sections: sections.filter((section) => section.workout_id === workout.id).sort((left, right) => left.position - right.position).map((section): WorkoutSection => ({
            id: section.id,
            title: section.title,
            items: items.filter((item) => item.section_id === section.id).sort((left, right) => left.position - right.position).map((item): WorkoutItem => ({
              id: item.id,
              exerciseId: item.source_exercise_id ?? undefined,
              title: item.snapshot_name,
              cue: item.snapshot_cue,
              mode: item.entry_mode,
              fields: item.tracking_fields,
              prescription: prescriptionFromRows(item.entry_mode, prescriptions.filter((entry) => entry.workout_item_id === item.id)),
            })),
          })),
        };
      }),
    }));

    const phase = phases.sort((left, right) => left.position - right.position)[0]?.name ?? "Plan";
    return {
      id: programRow.id,
      athleteId: programRow.athlete_id,
      versionId: version.id,
      versionStatus: version.status,
      effectiveFrom: version.effective_from ?? undefined,
      title: programRow.title,
      description: programRow.description,
      mode: programRow.planning_mode === "fixed_weeks" ? "fixed" : "repeating",
      phase,
      activeWeek: activeWeekIndex(version, mappedWeeks.length),
      weeks: mappedWeeks,
      ownerName,
      createdByName,
    };
  }

  async listExercises() {
    const result = await this.client.from("exercises")
      .select("id, scope, owner_id, name, category, cue, default_entry_mode, default_tracking_fields")
      .is("archived_at", null)
      .order("name");
    if (result.error) fail("Could not load the exercise library", result.error);
    return (result.data as ExerciseRow[]).map((row) => mapExercise(row, this.viewerName));
  }

  async createPersonalExercise(input: CreateExerciseInput) {
    const fields: TrackingField[] = input.mode === "sets"
      ? ["reps", "load", "rpe"]
      : input.mode === "result"
        ? ["duration", "distance", "rpe"]
        : input.mode === "intervals"
          ? ["rounds", "duration", "rpe"]
          : [];
    const result = await this.client.from("exercises").insert({
      scope: "personal",
      owner_id: this.viewerId,
      name: input.name,
      category: input.category || "Custom",
      cue: input.cue,
      default_entry_mode: input.mode,
      default_tracking_fields: fields,
    }).select("id, scope, owner_id, name, category, cue, default_entry_mode, default_tracking_fields").single();
    if (result.error || !result.data) fail("Could not save the exercise", result.error);
    return mapExercise(result.data as ExerciseRow, this.viewerName);
  }

  async addWorkout(program: Program, weekId: string, title: string, dayLabel: string): Promise<PlannedWorkout> {
    const week = program.weeks.find((item) => item.id === weekId);
    if (!week) fail("The selected week no longer exists", null);
    const workoutResult = await this.client.from("workouts").insert({
      program_week_id: weekId,
      title,
      day_of_week: dayNumber(dayLabel),
      schedule_label: dayLabel,
      position: week.workouts.length,
      estimated_minutes: 45,
    }).select("id").single();
    if (workoutResult.error || !workoutResult.data) fail("Could not add the workout", workoutResult.error);
    const workoutId = String(workoutResult.data.id);
    const sectionResult = await this.client.from("workout_sections").insert({
      workout_id: workoutId,
      title: "Main work",
      section_kind: "main",
      position: 0,
    }).select("id").single();
    if (sectionResult.error || !sectionResult.data) fail("Could not prepare the workout section", sectionResult.error);
    return {
      id: workoutId,
      title,
      dayLabel,
      durationMinutes: 45,
      sections: [{ id: String(sectionResult.data.id), title: "Main work", items: [] }],
    };
  }

  async addWorkoutItem(section: WorkoutSection, exercise: Exercise): Promise<WorkoutItem> {
    const result = await this.client.from("workout_items").insert({
      section_id: section.id,
      source_exercise_id: exercise.id,
      snapshot_name: exercise.name,
      snapshot_cue: exercise.cue,
      entry_mode: exercise.defaultMode,
      tracking_fields: exercise.defaultFields,
      position: section.items.length,
    }).select("id").single();
    if (result.error || !result.data) fail("Could not add the exercise to the workout", result.error);
    const itemId = String(result.data.id);
    const prescription: Prescription = exercise.defaultMode === "sets"
      ? { sets: 3, reps: "8", targetRpe: "7–8" }
      : exercise.defaultMode === "intervals"
        ? { rounds: 5, workSeconds: 60, restSeconds: 60 }
        : exercise.defaultMode === "result"
          ? { durationMinutes: 20 }
          : {};

    const entries: PrescriptionInsert[] = exercise.defaultMode === "sets"
      ? Array.from({ length: 3 }, (_, position) => ({ workout_item_id: itemId, position, reps_min: 8, reps_max: 8, target_rpe_min: 7, target_rpe_max: 8 }))
      : exercise.defaultMode === "intervals"
        ? [{ workout_item_id: itemId, position: 0, rounds: 5, work_seconds: 60, rest_seconds: 60 }]
        : exercise.defaultMode === "result"
          ? [{ workout_item_id: itemId, position: 0, duration_seconds: 1200 }]
          : [];
    if (entries.length) {
      const entriesResult = await this.client.from("prescribed_entries").insert(entries);
      if (entriesResult.error) fail("Could not save the exercise prescription", entriesResult.error);
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
    const result = await this.client.from("workout_items").delete().eq("id", itemId);
    if (result.error) fail("Could not remove the workout item", result.error);
  }

  async duplicateWeek(sourceWeekId: string, targetWeekId: string) {
    const result = await this.client.rpc("duplicate_program_week", {
      source_week_id: sourceWeekId,
      target_week_id: targetWeekId,
    });
    if (result.error) fail("Could not copy the previous week", result.error);
  }

  async publishProgram(versionId: string, effectiveOn = dateOnly(new Date())) {
    const result = await this.client.rpc("publish_program_version", {
      target_version_id: versionId,
      effective_on: effectiveOn,
    });
    if (result.error) fail("Could not publish the program", result.error);
  }

  async startOrResumeSession(workout: PlannedWorkout, programVersionId: string) {
    const result = await this.client.rpc("start_or_resume_workout", {
      target_workout_id: workout.id,
      target_program_version_id: programVersionId,
      target_scheduled_workout_id: workout.scheduledWorkoutId ?? null,
    });
    if (result.error) fail("Could not start the workout", result.error);
    return this.loadActiveSession(String(result.data));
  }

  async saveSessionDraft(session: ActiveSession, setLogs: Record<string, SessionSetValue[]>, resultLogs: Record<string, Record<string, string>>) {
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
        const upsert = await this.client.from("session_entries").upsert(rows, { onConflict: "session_item_log_id,position" });
        if (upsert.error) fail("Could not save workout sets", upsert.error);
        const remove = await this.client.from("session_entries").delete().eq("session_item_log_id", itemLogId).gte("position", rows.length);
        if (remove.error) fail("Could not reconcile removed sets", remove.error);
        continue;
      }

      const resultValue = resultLogs[itemId];
      if (resultValue) {
        const upsert = await this.client.from("session_entries").upsert({
          session_item_log_id: itemLogId,
          position: 0,
          duration_seconds: numberValue(resultValue.duration) === null ? null : Math.round(Number(resultValue.duration) * 60),
          distance_metres: numberValue(resultValue.distance) === null ? null : Number(resultValue.distance) * 1000,
          rounds: numberValue(resultValue.rounds),
          heart_rate: numberValue(resultValue.heartRate),
          rpe: numberValue(resultValue.rpe),
        }, { onConflict: "session_item_log_id,position" });
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

  private async listCompletedSessions(athleteId: string): Promise<CompletedSession[]> {
    const result = await this.client.from("workout_sessions")
      .select("id, workout_id, scheduled_workout_id, workout_title, started_at, completed_at, session_rpe, athlete_note")
      .eq("athlete_id", athleteId)
      .eq("status", "completed")
      .order("started_at", { ascending: false });
    if (result.error) fail("Could not load training history", result.error);
    return (result.data as SessionRow[]).map((session) => {
      const start = new Date(session.started_at);
      const end = session.completed_at ? new Date(session.completed_at) : start;
      return {
        id: session.id,
        workoutId: session.workout_id ?? undefined,
        workoutTitle: session.workout_title,
        date: dateOnly(start),
        durationMinutes: Math.max(1, Math.round((end.getTime() - start.getTime()) / 60_000)),
        rpe: numberValue(session.session_rpe) ?? 0,
        note: session.athlete_note || undefined,
      };
    });
  }

  private async loadActiveSession(sessionId?: string): Promise<ActiveSession | null> {
    let query = this.client.from("workout_sessions")
      .select("id, workout_id, scheduled_workout_id, workout_title, started_at, completed_at, session_rpe, athlete_note")
      .eq("athlete_id", this.viewerId)
      .eq("status", "in_progress")
      .order("started_at", { ascending: false })
      .limit(1);
    if (sessionId) query = query.eq("id", sessionId);
    const sessionResult = await query.maybeSingle();
    if (sessionResult.error) fail("Could not restore the active workout", sessionResult.error);
    if (!sessionResult.data) return null;
    const session = sessionResult.data as SessionRow;
    if (!session.workout_id) return null;

    const itemsResult = await this.client.from("session_item_logs")
      .select("id, workout_session_id, source_workout_item_id, entry_mode, position")
      .eq("workout_session_id", session.id)
      .order("position");
    if (itemsResult.error) fail("Could not restore workout items", itemsResult.error);
    const items = itemsResult.data as SessionItemRow[];
    const itemIds = items.map((item) => item.id);
    const entriesResult = itemIds.length
      ? await this.client.from("session_entries").select("*").in("session_item_log_id", itemIds).order("position")
      : { data: [], error: null };
    if (entriesResult.error) fail("Could not restore workout entries", entriesResult.error);
    const entries = entriesResult.data as SessionEntryRow[];

    const itemLogIds: Record<string, string> = {};
    const setLogs: Record<string, SessionSetValue[]> = {};
    const resultLogs: Record<string, Record<string, string>> = {};
    for (const item of items) {
      if (!item.source_workout_item_id) continue;
      itemLogIds[item.source_workout_item_id] = item.id;
      const values = entries.filter((entry) => entry.session_item_log_id === item.id).sort((left, right) => left.position - right.position);
      if (item.entry_mode === "sets") {
        setLogs[item.source_workout_item_id] = values.map((entry) => ({
          reps: displayNumber(entry.reps),
          load: displayNumber(entry.load_kg),
          rpe: displayNumber(entry.rpe),
        }));
      } else if (item.entry_mode !== "none") {
        const entry = values[0];
        resultLogs[item.source_workout_item_id] = entry ? {
          rounds: displayNumber(entry.rounds),
          duration: entry.duration_seconds === null ? "" : String(entry.duration_seconds / 60),
          distance: numberValue(entry.distance_metres) === null ? "" : String(Number(entry.distance_metres) / 1000),
          heartRate: displayNumber(entry.heart_rate),
          rpe: displayNumber(entry.rpe),
        } : {};
      }
    }

    return {
      id: session.id,
      workoutId: session.workout_id,
      scheduledWorkoutId: session.scheduled_workout_id ?? undefined,
      itemLogIds,
      setLogs,
      resultLogs,
      sessionRpe: displayNumber(session.session_rpe) || "7",
      sessionNote: session.athlete_note,
    };
  }

  private async loadCoachConnection(): Promise<CoachConnection | null> {
    const relationshipResult = await this.client.from("coach_relationships")
      .select("id, athlete_id, coach_id, accepted_at")
      .eq("athlete_id", this.viewerId)
      .is("ended_at", null)
      .limit(1)
      .maybeSingle();
    if (relationshipResult.error) fail("Could not load coach access", relationshipResult.error);
    if (!relationshipResult.data) return null;
    const relationship = relationshipResult.data as RelationshipRow;
    const profileResult = await this.client.from("profiles").select("id, display_name").eq("id", relationship.coach_id).single();
    if (profileResult.error || !profileResult.data) fail("Could not load the coach profile", profileResult.error);
    const profile = profileResult.data as ProfileRow;
    return {
      relationshipId: relationship.id,
      coachId: relationship.coach_id,
      name: profile.display_name,
      initials: initials(profile.display_name),
      connectedSince: relationship.accepted_at.slice(0, 10),
    };
  }

  private async loadCoachedAthletes(): Promise<AthleteSummary[]> {
    const relationshipsResult = await this.client.from("coach_relationships")
      .select("id, athlete_id, coach_id, accepted_at")
      .eq("coach_id", this.viewerId)
      .is("ended_at", null);
    if (relationshipsResult.error) fail("Could not load coached athletes", relationshipsResult.error);
    const relationships = relationshipsResult.data as RelationshipRow[];
    if (!relationships.length) return [];

    const athleteIds = relationships.map((relationship) => relationship.athlete_id);
    const [profilesResult, programsResult, sessionsResult, schedulesResult] = await Promise.all([
      this.client.from("profiles").select("id, display_name").in("id", athleteIds),
      this.client.from("programs").select("id, athlete_id, title").in("athlete_id", athleteIds).eq("is_current", true).is("archived_at", null),
      this.client.from("workout_sessions").select("athlete_id, started_at, session_rpe").in("athlete_id", athleteIds).eq("status", "completed").order("started_at", { ascending: false }),
      this.client.from("scheduled_workouts").select("athlete_id, planned_date, status").in("athlete_id", athleteIds),
    ]);
    if (profilesResult.error) fail("Could not load athlete profiles", profilesResult.error);
    if (programsResult.error) fail("Could not load athlete programs", programsResult.error);
    if (sessionsResult.error) fail("Could not load athlete sessions", sessionsResult.error);
    if (schedulesResult.error) fail("Could not load athlete schedules", schedulesResult.error);

    const profiles = profilesResult.data as ProfileRow[];
    const programs = programsResult.data as Array<{ athlete_id: string; title: string }>;
    const sessions = sessionsResult.data as Array<{ athlete_id: string; started_at: string; session_rpe: NumericValue }>;
    const schedules = schedulesResult.data as Array<{ athlete_id: string; planned_date: string | null; status: string }>;
    const now = new Date();
    const day = now.getDay() || 7;
    const weekStart = new Date(now);
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(now.getDate() - day + 1);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);

    return relationships.map((relationship) => {
      const profile = profiles.find((item) => item.id === relationship.athlete_id);
      const athleteSessions = sessions.filter((session) => session.athlete_id === relationship.athlete_id);
      const completedThisWeek = athleteSessions.filter((session) => {
        const date = new Date(session.started_at);
        return date >= weekStart && date < weekEnd;
      }).length;
      const plannedThisWeek = schedules.filter((schedule) => schedule.athlete_id === relationship.athlete_id && schedule.planned_date && new Date(`${schedule.planned_date}T12:00:00`) >= weekStart && new Date(`${schedule.planned_date}T12:00:00`) < weekEnd).length;
      const latest = athleteSessions[0];
      const latestRpe = numberValue(latest?.session_rpe);
      return {
        id: relationship.athlete_id,
        relationshipId: relationship.id,
        name: profile?.display_name ?? "Athlete",
        initials: initials(profile?.display_name ?? "Athlete"),
        programTitle: programs.find((program) => program.athlete_id === relationship.athlete_id)?.title ?? "No active program",
        completedThisWeek,
        plannedThisWeek,
        latestRpe,
        lastTrainingLabel: relativeTrainingLabel(latest?.started_at ?? null),
        trend: latestRpe !== null && latestRpe >= 9 ? "watch" : plannedThisWeek > 0 && completedThisWeek >= plannedThisWeek ? "strong" : "steady",
      };
    });
  }

  async createCoachInvite(email: string) {
    const result = await this.client.rpc("create_coach_invite", { target_email: email });
    if (result.error || !result.data) fail("Could not create the coach invitation", result.error);
    const payload = result.data as { token: string };
    const invitationUrl = new URL(window.location.origin);
    invitationUrl.searchParams.set("coach_invite", payload.token);
    return invitationUrl.toString();
  }

  async acceptCoachInvite(token: string) {
    const result = await this.client.rpc("accept_coach_invite", { invite_token: token });
    if (result.error) fail("Could not accept the coach invitation", result.error);
  }

  async endCoachRelationship(relationshipId: string) {
    const result = await this.client.from("coach_relationships")
      .update({ ended_at: new Date().toISOString() })
      .eq("id", relationshipId)
      .is("ended_at", null);
    if (result.error) fail("Could not remove coach access", result.error);
  }
}
