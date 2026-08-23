import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Copy,
  Dumbbell,
  FlaskConical,
  Gauge,
  LayoutDashboard,
  Layers3,
  ListPlus,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  MessageSquareText,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Timer,
  Trash2,
  TrendingUp,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useRef, useState } from "react";
import type {
  ActiveSession,
  AthleteSummary,
  CoachAgendaEntry,
  CoachAssignedProgramSummary,
  CoachConnection,
  CoachInviteReceipt,
  CoachInviteTarget,
  CompletedSession,
  CompletedSessionDetail,
  EntryMode,
  Exercise,
  ExerciseDiscipline,
  OwnProfile,
  OutgoingCoachInvite,
  PendingCoachInvite,
  PlannedWorkout,
  PrescriptionEntry,
  Program,
  ProgramAssignment,
  ProgramTemplate,
  ScheduledWorkout,
  SessionSetValue,
  TrackingField,
  ViewName,
  WorkoutItem,
  WorkoutSection,
  WorkspaceData,
} from "../lib/domain";
import type { AppViewer } from "../lib/auth";
import type { LiftLogRepository } from "../lib/repository";
import {
  cn,
  formatDuration,
  formatWorkoutCount,
  getInitials,
  sourceFromExercise,
  sourceFromProgram,
  sourceFromScheduledWorkout,
} from "../lib/presentation";
import {
  listUpcomingWorkouts,
  selectNextWorkoutFocus,
} from "../lib/workout-focus";
import {
  AsyncButton,
  PersonAvatar,
  SegmentedTabs,
  SourceTag,
  StatusBadge,
  WorkoutSectionHeading,
} from "./ui-primitives";

const navItems: Array<{
  id: ViewName;
  label: string;
  shortLabel: string;
  icon: typeof Activity;
}> = [
  { id: "today", label: "Next workouts", shortLabel: "Next", icon: LayoutDashboard },
  { id: "program", label: "Programs", shortLabel: "Programs", icon: Dumbbell },
  { id: "calendar", label: "Calendar", shortLabel: "Calendar", icon: CalendarDays },
  { id: "exercises", label: "Exercises", shortLabel: "Exercises", icon: BookOpen },
  { id: "coaching", label: "Coaching", shortLabel: "Coaching", icon: Users },
];

type ModalName =
  | "exercise"
  | "workout"
  | "workout-settings"
  | "prescription"
  | "section"
  | "delete-section"
  | "delete-exercise"
  | "invite"
  | "assign-program"
  | "program"
  | "quick-workout"
  | "deactivate-program"
  | "schedule"
  | "account"
  | null;
type SetLog = SessionSetValue;
type ProgramSourceTab = "library" | "own" | "coach";
type ProgramAction = {
  id: string;
  kind: "availability" | "copy" | "delete" | "publish" | "edit" | "open" | "week";
} | null;
type CompletedWorkoutViewState = {
  session: CompletedSession;
  detail: CompletedSessionDetail | null;
  loading: boolean;
  error: string;
  returnView: "calendar" | "coaching";
};

function orderByIds<T extends { id: string }>(items: T[], ids: string[]) {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  return ids
    .map((id) => itemsById.get(id))
    .filter((item): item is T => Boolean(item));
}

function programWeekCount(program: Program) {
  return program.detailsLoaded === false
    ? program.weekCount ?? 0
    : program.weeks.length;
}

function programWorkoutCount(program: Program) {
  return program.detailsLoaded === false
    ? program.workoutCount ?? 0
    : program.weeks.reduce(
        (total, week) => total + week.workouts.length,
        0,
      );
}

function programWorkoutIds(program: Program) {
  return program.detailsLoaded === false
    ? program.workoutIds ?? []
    : program.weeks.flatMap((week) => week.workouts.map((workout) => workout.id));
}

function reorderProgramWorkouts(
  source: Program,
  weekId: string,
  workoutIds: string[],
) {
  return {
    ...source,
    weeks: source.weeks.map((week) =>
      week.id === weekId
        ? { ...week, workouts: orderByIds(week.workouts, workoutIds) }
        : week,
    ),
  };
}

function reorderProgramSections(
  source: Program,
  workoutId: string,
  sectionIds: string[],
) {
  return {
    ...source,
    weeks: source.weeks.map((week) => ({
      ...week,
      workouts: week.workouts.map((workout) =>
        workout.id === workoutId
          ? { ...workout, sections: orderByIds(workout.sections, sectionIds) }
          : workout,
      ),
    })),
  };
}

function moveProgramExercise(
  source: Program,
  workoutId: string,
  itemId: string,
  destinationSectionId: string,
  destinationPosition: number,
) {
  const workout = source.weeks
    .flatMap((week) => week.workouts)
    .find((candidate) => candidate.id === workoutId);
  const movingItem = workout?.sections
    .flatMap((section) => section.items)
    .find((item) => item.id === itemId);
  if (!movingItem) return source;

  return {
    ...source,
    weeks: source.weeks.map((week) => ({
      ...week,
      workouts: week.workouts.map((candidate) => {
        if (candidate.id !== workoutId) return candidate;
        const withoutMovingItem = candidate.sections.map((section) => ({
          ...section,
          items: section.items.filter((item) => item.id !== itemId),
        }));
        return {
          ...candidate,
          sections: withoutMovingItem.map((section) => {
            if (section.id !== destinationSectionId) return section;
            const nextItems = [...section.items];
            const insertionIndex = Math.max(
              0,
              Math.min(destinationPosition, nextItems.length),
            );
            nextItems.splice(insertionIndex, 0, movingItem);
            return { ...section, items: nextItems };
          }),
        };
      }),
    })),
  };
}

const KG_PER_LB = 0.45359237;

function formatWeight(valueKg: number, weightUnit: OwnProfile["weightUnit"]) {
  const displayValue = weightUnit === "lb" ? valueKg / KG_PER_LB : valueKg;
  return Number(displayValue.toFixed(weightUnit === "lb" ? 1 : 2)).toString();
}

function weightInputValue(valueKg: string, weightUnit: OwnProfile["weightUnit"]) {
  const parsed = Number(valueKg);
  return valueKg.trim() && Number.isFinite(parsed)
    ? formatWeight(parsed, weightUnit)
    : valueKg;
}

function weightKgValue(value: string, weightUnit: OwnProfile["weightUnit"]) {
  const parsed = Number(value);
  if (!value.trim() || !Number.isFinite(parsed)) return value;
  const kilograms = weightUnit === "lb" ? parsed * KG_PER_LB : parsed;
  return Number(kilograms.toFixed(3)).toString();
}

function prescriptionEntries(item: WorkoutItem) {
  return item.prescription.entries?.length
    ? item.prescription.entries
    : [item.prescription];
}

function prescriptionEntryVaries(
  item: WorkoutItem,
  field: keyof PrescriptionEntry,
) {
  const values = prescriptionEntries(item).map((entry) => entry[field]);
  return values.some((value) => value !== values[0]);
}

function prescriptionLabel(
  item: WorkoutItem,
  weightUnit: OwnProfile["weightUnit"] = "kg",
) {
  const target = item.prescription;
  const parts: string[] = [];
  if (item.mode === "sets") {
    const variedReps = prescriptionEntryVaries(item, "reps");
    const variedLoad = prescriptionEntryVaries(item, "loadKg");
    parts.push(
      variedReps
        ? `${target.sets ?? 1} sets`
        : `${target.sets ?? 1} × ${target.reps ?? "open"}`,
    );
    if (variedLoad) parts.push("varied load");
    else if (target.loadKg !== undefined)
      parts.push(`${formatWeight(target.loadKg, weightUnit)} ${weightUnit}`);
  } else if (item.mode === "intervals") {
    parts.push(`${target.rounds ?? 1} rounds`);
    if (target.workSeconds !== undefined)
      parts.push(`${target.workSeconds}s work`);
    if (target.restSeconds !== undefined)
      parts.push(`${target.restSeconds}s rest`);
  } else {
    if (target.durationMinutes !== undefined)
      parts.push(`${target.durationMinutes} min`);
    if (target.distance !== undefined)
      parts.push(`${target.distance} ${target.distanceUnit ?? "m"}`);
  }
  return parts.join(" · ") || (item.mode === "none" ? "Instructions" : "Open");
}

function modeLabel(mode: EntryMode) {
  return {
    none: "Instructions",
    sets: "Sets",
    result: "Single result",
    intervals: "Intervals",
  }[mode];
}

function starterSetLogs(
  workout: PlannedWorkout,
  activeSession: ActiveSession | null,
) {
  if (activeSession?.workoutId === workout.id) return activeSession.setLogs;
  const logs: Record<string, SetLog[]> = {};
  workout.sections
    .flatMap((section) => section.items)
    .forEach((item) => {
      if (item.mode === "sets") {
        const entries = item.prescription.entries?.length
          ? item.prescription.entries
          : Array.from({ length: item.prescription.sets ?? 1 }, () => item.prescription);
        logs[item.id] = entries.map((entry) => ({
            reps: entry.reps?.split("–")[0] ?? item.prescription.reps?.split("–")[0] ?? "",
            load: "",
            rpe: "",
          }));
      }
    });
  return logs;
}

function localDateOnly(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function copyText(value: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
    const input = document.createElement("textarea");
    input.value = value;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    return copied;
  } catch {
    return false;
  }
}

export default function LiftLogApp({
  viewer,
  onSignOut,
  onOpenTestPersonas,
  initialWorkspace,
  repository,
}: {
  viewer: AppViewer;
  onSignOut: () => void;
  onOpenTestPersonas?: () => void;
  initialWorkspace: WorkspaceData;
  repository: LiftLogRepository | null;
}) {
  const [activeView, setActiveView] = useState<ViewName>("today");
  const [workspace, setWorkspace] = useState<WorkspaceData>(initialWorkspace);
  const [program, setProgram] = useState<Program | null>(null);
  const [selectedWeek, setSelectedWeek] = useState(1);
  const [selectedWorkoutId, setSelectedWorkoutId] = useState("");
  const [selectedSectionId, setSelectedSectionId] = useState("");
  const [prescriptionItem, setPrescriptionItem] = useState<WorkoutItem | null>(
    null,
  );
  const [newPrescriptionItemId, setNewPrescriptionItemId] = useState<
    string | null
  >(null);
  const [sectionEditing, setSectionEditing] = useState<WorkoutSection | null>(
    null,
  );
  const [sectionDeleteTarget, setSectionDeleteTarget] =
    useState<WorkoutSection | null>(null);
  const [personalExercises, setPersonalExercises] = useState<Exercise[]>(
    initialWorkspace.personalExercises,
  );
  const [exerciseDeleteTarget, setExerciseDeleteTarget] =
    useState<Exercise | null>(null);
  const [exerciseScope, setExerciseScope] = useState<"global" | "personal">(
    "global",
  );
  const [exerciseQuery, setExerciseQuery] = useState("");
  const [modal, setModal] = useState<ModalName>(null);
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(
    initialWorkspace.activeSession,
  );
  const [workoutStarted, setWorkoutStarted] = useState(
    Boolean(initialWorkspace.activeSession),
  );
  const [workoutComplete, setWorkoutComplete] = useState(false);
  const workoutActionRef = useRef<"starting" | "finishing" | null>(null);
  const [workoutAction, setWorkoutAction] = useState<
    "starting" | "finishing" | null
  >(null);
  const [startingScheduleId, setStartingScheduleId] = useState<string | null>(
    null,
  );
  const [scheduleStatusAction, setScheduleStatusAction] = useState<
    { id: string; status: "planned" | "skipped" } | null
  >(null);
  const [workoutPreviewSchedule, setWorkoutPreviewSchedule] =
    useState<ScheduledWorkout | null>(null);
  const [workoutPreviewReturnView, setWorkoutPreviewReturnView] =
    useState<"today" | "calendar">("today");
  const [completedWorkoutView, setCompletedWorkoutView] =
    useState<CompletedWorkoutViewState | null>(null);
  const [sessionRpe, setSessionRpe] = useState(
    initialWorkspace.activeSession?.sessionRpe ?? "7",
  );
  const [sessionNote, setSessionNote] = useState(
    initialWorkspace.activeSession?.sessionNote ?? "",
  );
  const [toast, setToast] = useState("");
  const [coachMode, setCoachMode] = useState<"athlete" | "coach">("athlete");
  const coachingRefreshRef = useRef(false);
  const [coachingRefreshing, setCoachingRefreshing] = useState(false);
  const [selectedAthlete, setSelectedAthlete] = useState<AthleteSummary | null>(
    initialWorkspace.coachedAthletes[0] ?? null,
  );
  const [openingCoachProgramId, setOpeningCoachProgramId] = useState<
    string | null
  >(null);
  const [programTarget, setProgramTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [assignmentSeed, setAssignmentSeed] = useState<{
    programId?: string;
    athleteIds?: string[];
  }>({});
  const [respondingInvite, setRespondingInvite] = useState<{
    id: string;
    response: "accepted" | "declined";
  } | null>(null);
  const [cancellingCoachInviteId, setCancellingCoachInviteId] = useState<
    string | null
  >(null);
  const [scheduleEditingId, setScheduleEditingId] = useState<string | null>(
    null,
  );
  const [scheduleInitialDate, setScheduleInitialDate] = useState<string | null>(
    null,
  );
  const scheduleOpeningRef = useRef(false);
  const [scheduleOpening, setScheduleOpening] = useState(false);
  const completedWorkoutRequestRef = useRef(0);
  const [programOwnerId, setProgramOwnerId] = useState(viewer.id);
  const [programSource, setProgramSource] =
    useState<ProgramSourceTab>("library");
  const [activatingTemplateId, setActivatingTemplateId] = useState<
    string | null
  >(null);
  const [programAction, setProgramAction] = useState<ProgramAction>(null);
  const weekMutationRef = useRef(false);
  const builderMutationPendingRef = useRef(false);
  const [builderMutationPending, setBuilderMutationPending] = useState(false);

  const availablePrograms =
    workspace.availablePrograms ??
    [workspace.draftProgram ?? workspace.activeProgram].filter(
      (candidate): candidate is Program => Boolean(candidate),
    );
  const outgoingCoachInvites = workspace.outgoingCoachInvites ?? [];
  const hasCoach = workspace.coachConnections.length > 0;
  const hasAthleteWorkspace =
    workspace.coachedAthletes.length > 0 ||
    workspace.pendingCoachInvites.length > 0;
  const programCatalog = workspace.programCatalog ?? availablePrograms;
  const assignableOwnPrograms = programCatalog.filter(
    (candidate) =>
      candidate.athleteId === viewer.id &&
      candidate.createdById === viewer.id &&
      candidate.sourceType === "self" &&
      candidate.versionStatus === "published",
  );
  const currentWeek = program?.weeks[selectedWeek - 1] ?? program?.weeks[0];
  const workoutFocus = selectNextWorkoutFocus(
    programCatalog,
    activeSession,
    workspace.scheduledWorkouts,
  );
  const upcomingWorkouts = listUpcomingWorkouts(workspace.scheduledWorkouts);
  const todaySchedule = workoutFocus?.schedule ?? undefined;
  const todayWorkout = workoutFocus?.workout;
  const todayProgram =
    programCatalog.find(
      (candidate) => candidate.versionId === todayWorkout?.programVersionId,
    ) ??
    programCatalog.find(
      (candidate) => candidate.id === todaySchedule?.programId,
    ) ??
    programCatalog.find((candidate) =>
      candidate.weeks.some((week) =>
        week.workouts.some((workout) => workout.id === todayWorkout?.id),
      ),
    );
  const previewProgram =
    programCatalog.find(
      (candidate) =>
        candidate.versionId === workoutPreviewSchedule?.programVersionId,
    ) ??
    programCatalog.find(
      (candidate) => candidate.id === workoutPreviewSchedule?.programId,
    );
  const selectedWorkout =
    currentWeek?.workouts.find((workout) => workout.id === selectedWorkoutId) ??
    currentWeek?.workouts[0];

  const [setLogs, setSetLogs] = useState<Record<string, SetLog[]>>(() =>
    todayWorkout ? starterSetLogs(todayWorkout, activeSession) : {},
  );
  const [resultLogs, setResultLogs] = useState<
    Record<string, Record<string, string>>
  >(initialWorkspace.activeSession?.resultLogs ?? {});

  useEffect(() => {
    if (!repository || !activeSession || !workoutStarted) return;
    const saveTimer = window.setTimeout(() => {
      void repository
        .saveSessionDraft(activeSession, setLogs, resultLogs)
        .catch(() => {
          notify("Autosave paused — check your connection");
        });
    }, 650);
    return () => window.clearTimeout(saveTimer);
  }, [activeSession, repository, resultLogs, setLogs, workoutStarted]);

  useEffect(() => {
    if (!hasAthleteWorkspace) {
      setCoachMode("athlete");
    }
  }, [hasAthleteWorkspace]);

  useEffect(() => {
    if (programSource === "coach" && !hasCoach) {
      setProgramSource("library");
    }
  }, [hasCoach, programSource]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  function selectProgram(
    nextProgram: Program,
    preferred?: { weekIndex?: number; workoutId?: string; sectionId?: string },
  ) {
    const requestedWeek = Math.min(
      preferred?.weekIndex ?? nextProgram.activeWeek,
      nextProgram.weeks.at(-1)?.index ?? 1,
    );
    const nextWeek =
      nextProgram.weeks.find((week) => week.index === requestedWeek) ??
      nextProgram.weeks[nextProgram.activeWeek - 1] ??
      nextProgram.weeks[0];
    const nextWorkout =
      nextWeek?.workouts.find(
        (workout) => workout.id === preferred?.workoutId,
      ) ?? nextWeek?.workouts[0];
    const nextSection =
      nextWorkout?.sections.find(
        (section) => section.id === preferred?.sectionId,
      ) ?? nextWorkout?.sections[0];
    setProgram(nextProgram);
    setSelectedWeek(nextWeek?.index ?? 1);
    setSelectedWorkoutId(nextWorkout?.id ?? "");
    setSelectedSectionId(nextSection?.id ?? "");
    setProgramOwnerId(nextProgram.athleteId);
  }

  async function openProgram(targetProgram: Program) {
    if (!repository || targetProgram.detailsLoaded !== false) {
      selectProgram(targetProgram);
      setActiveView("program");
      return;
    }
    if (programAction) return;
    setProgramAction({ id: targetProgram.id, kind: "open" });
    try {
      const detail = await repository.loadProgramDetail(
        targetProgram.athleteId,
        targetProgram.id,
      );
      if (!detail) throw new Error("This program is no longer available.");
      selectProgram(detail);
      setActiveView("program");
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "The program could not be opened",
      );
    } finally {
      setProgramAction(null);
    }
  }

  function applyWorkspace(nextWorkspace: WorkspaceData) {
    const nextWorkout = selectNextWorkoutFocus(
      nextWorkspace.programCatalog,
      nextWorkspace.activeSession,
      nextWorkspace.scheduledWorkouts,
    )?.workout;
    const preserveActiveDraft = Boolean(
      activeSession &&
      nextWorkspace.activeSession?.id === activeSession.id &&
      workoutStarted,
    );
    setWorkspace(nextWorkspace);
    setPersonalExercises(nextWorkspace.personalExercises);
    setActiveSession(nextWorkspace.activeSession);
    if (!preserveActiveDraft) {
      setSetLogs(
        nextWorkout
          ? starterSetLogs(nextWorkout, nextWorkspace.activeSession)
          : {},
      );
      setResultLogs(nextWorkspace.activeSession?.resultLogs ?? {});
      setSessionRpe(nextWorkspace.activeSession?.sessionRpe ?? "7");
      setSessionNote(nextWorkspace.activeSession?.sessionNote ?? "");
    }
    setWorkoutStarted(Boolean(nextWorkspace.activeSession));
    setSelectedAthlete(
      (previous) =>
        nextWorkspace.coachedAthletes.find(
          (athlete) => athlete.id === previous?.id,
        ) ??
        nextWorkspace.coachedAthletes[0] ??
        null,
    );
    if (program?.athleteId === viewer.id) {
      const refreshedProgram = nextWorkspace.programCatalog.find(
        (candidate) => candidate.id === program.id,
      );
      if (!refreshedProgram) setProgram(null);
    }
  }

  function replaceProgramEverywhere(nextProgram: Program) {
    const replaceMatchingVersion = (candidate: Program) =>
      candidate.versionId === nextProgram.versionId ? nextProgram : candidate;
    setProgram(nextProgram);
    setWorkspace((previous) => ({
      ...previous,
      programCatalog: previous.programCatalog.map(replaceMatchingVersion),
      availablePrograms: previous.availablePrograms.map(replaceMatchingVersion),
      draftProgram:
        previous.draftProgram?.versionId === nextProgram.versionId
          ? nextProgram
          : previous.draftProgram,
      activeProgram:
        previous.activeProgram?.versionId === nextProgram.versionId
          ? nextProgram
          : previous.activeProgram,
    }));
  }

  async function restoreProgramAfterBuilderFailure(
    fallback: Program,
    selection: { weekIndex: number; workoutId: string; sectionId: string },
  ) {
    replaceProgramEverywhere(fallback);
    setSelectedWeek(selection.weekIndex);
    setSelectedWorkoutId(selection.workoutId);
    setSelectedSectionId(selection.sectionId);
    if (!repository) return;
    try {
      const authoritative = await repository.loadEditableProgram(
        fallback.athleteId,
        fallback.id,
      );
      replaceProgramEverywhere(authoritative);
    } catch {
      // Keep the known-good snapshot when the recovery fetch is also offline.
    }
  }

  async function reloadCurrentProgram() {
    if (!repository) return;
    const preferred = {
      weekIndex: selectedWeek,
      workoutId: selectedWorkoutId,
      sectionId: selectedSectionId,
    };
    if (program?.versionStatus === "draft") {
      selectProgram(
        await repository.loadEditableProgram(program.athleteId, program.id),
        preferred,
      );
      return;
    }
    if (!program) {
      return;
    }
    const nextProgram = await repository.loadProgramDetail(
      program.athleteId,
      program.id,
    );
    if (nextProgram) selectProgram(nextProgram, preferred);
    else setProgram(null);
  }

  function navigate(view: ViewName) {
    if (view === "program" && programOwnerId !== viewer.id) {
      setProgram(null);
      setProgramOwnerId(viewer.id);
    }
    setActiveView(view);
    if (view === "coaching") void refreshCoachWorkspace();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function refreshCoachWorkspace() {
    if (!repository || coachingRefreshRef.current) return;
    coachingRefreshRef.current = true;
    setCoachingRefreshing(true);
    try {
      applyWorkspace(await repository.loadWorkspace());
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "The coach workspace could not be refreshed",
      );
    } finally {
      coachingRefreshRef.current = false;
      setCoachingRefreshing(false);
    }
  }

  async function changeCoachMode(nextMode: "athlete" | "coach") {
    setCoachMode(nextMode);
    if (nextMode === "coach") await refreshCoachWorkspace();
  }

  function updateSet(
    itemId: string,
    index: number,
    field: keyof SetLog,
    value: string,
  ) {
    setSetLogs((previous) => ({
      ...previous,
      [itemId]: previous[itemId].map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: value } : row,
      ),
    }));
  }

  function addSet(itemId: string) {
    setSetLogs((previous) => ({
      ...previous,
      [itemId]: [...(previous[itemId] ?? []), { reps: "", load: "", rpe: "" }],
    }));
  }

  function removeSet(itemId: string, index: number) {
    setSetLogs((previous) => ({
      ...previous,
      [itemId]: previous[itemId].filter((_, rowIndex) => rowIndex !== index),
    }));
  }

  function updateResult(itemId: string, field: string, value: string) {
    setResultLogs((previous) => ({
      ...previous,
      [itemId]: { ...(previous[itemId] ?? {}), [field]: value },
    }));
  }

  async function ensureScheduledWorkoutDetails(schedule: ScheduledWorkout) {
    if (!repository || schedule.detailsLoaded !== false) return schedule;
    const detail = await repository.loadScheduledWorkoutDetail(schedule.id);
    if (!detail) throw new Error("This scheduled workout is no longer available.");
    setWorkspace((previous) => ({
      ...previous,
      scheduledWorkouts: previous.scheduledWorkouts.map((candidate) =>
        candidate.id === detail.id ? detail : candidate,
      ),
    }));
    return detail;
  }

  async function startWorkout(schedule: ScheduledWorkout) {
    if (workoutActionRef.current) return;
    workoutActionRef.current = "starting";
    setWorkoutAction("starting");
    setStartingScheduleId(schedule.id);
    try {
      const detailedSchedule = await ensureScheduledWorkoutDetails(schedule);
      const workout = detailedSchedule.workout;
      if (!repository) {
        setWorkoutStarted(true);
        return;
      }
      const versionId =
        workout.programVersionId ?? schedule.programVersionId;
      if (!versionId)
        throw new Error(
          "This scheduled workout is missing its program version.",
        );
      const session = await repository.startOrResumeSession(
        workout,
        versionId,
      );
      if (!session) throw new Error("The workout session was not created.");
      setActiveSession(session);
      setSetLogs(starterSetLogs(workout, session));
      setResultLogs(session.resultLogs);
      setSessionRpe(session.sessionRpe);
      setSessionNote(session.sessionNote);
      setWorkoutStarted(true);
      setWorkoutPreviewSchedule(null);
      notify("Workout started · changes save automatically");
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "The workout could not be started",
      );
    } finally {
      workoutActionRef.current = null;
      setWorkoutAction(null);
      setStartingScheduleId(null);
    }
  }

  async function openWorkoutPreview(
    schedule: ScheduledWorkout,
    returnView: "today" | "calendar" = "today",
  ) {
    try {
      const detailedSchedule = await ensureScheduledWorkoutDetails(schedule);
      setCompletedWorkoutView(null);
      setWorkoutPreviewReturnView(returnView);
      setWorkoutPreviewSchedule(detailedSchedule);
      setSetLogs(starterSetLogs(detailedSchedule.workout, null));
      setResultLogs({});
      setSessionRpe("7");
      setSessionNote("");
      setWorkoutComplete(false);
      return true;
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "The workout could not be opened",
      );
      return false;
    }
  }

  async function finishWorkout() {
    if (workoutActionRef.current) return;
    workoutActionRef.current = "finishing";
    setWorkoutAction("finishing");
    try {
      if (repository && activeSession) {
        await repository.saveSessionDraft(activeSession, setLogs, resultLogs);
        await repository.completeSession(
          activeSession.id,
          sessionRpe,
          sessionNote,
        );
        const nextWorkspace = await repository.loadWorkspace();
        applyWorkspace(nextWorkspace);
        setActiveSession(null);
        setWorkoutComplete(false);
        setWorkoutStarted(false);
        notify("Session saved · next workout is ready when you are");
        return;
      }

      setActiveSession(null);
      setWorkoutComplete(true);
      setWorkoutStarted(false);
      notify("Session saved to your training history");
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "The session could not be completed",
      );
    } finally {
      workoutActionRef.current = null;
      setWorkoutAction(null);
    }
  }

  async function addWorkout(title: string) {
    if (!currentWeek || !program) return;
    let workout: PlannedWorkout;
    if (repository) {
      try {
        workout = await repository.addWorkout(program, currentWeek.id, title);
      } catch (error) {
        notify(
          error instanceof Error
            ? error.message
            : "The workout could not be added",
        );
        return;
      }
    } else {
      workout = {
        id: `workout-${Date.now()}`,
        title,
        dayLabel: `Workout ${currentWeek.workouts.length + 1}`,
        durationMinutes: 45,
        sections: [
          {
            id: `section-warmup-${Date.now()}`,
            title: "Warm up",
            kind: "warmup",
            items: [],
          },
          {
            id: `section-main-${Date.now()}`,
            title: "Main work",
            kind: "main",
            items: [],
          },
          {
            id: `section-cooldown-${Date.now()}`,
            title: "Cooldown",
            kind: "cooldown",
            items: [],
          },
        ],
      };
    }
    setProgram((previous) =>
      previous
        ? {
            ...previous,
            weeks: previous.weeks.map((week) =>
              week.index === selectedWeek
                ? { ...week, workouts: [...week.workouts, workout] }
                : week,
            ),
          }
        : previous,
    );
    setSelectedWorkoutId(workout.id);
    setSelectedSectionId(workout.sections[0]?.id ?? "");
    setModal(null);
    notify("Workout added to this week");
  }

  async function updateWorkoutSettings(title: string, durationMinutes: number) {
    if (!selectedWorkout) return;
    const syncQuickWorkoutTitle = program?.contentType === "quick_workout";
    if (repository) {
      await repository.updateWorkout(
        selectedWorkout.id,
        title,
        durationMinutes,
      );
      if (syncQuickWorkoutTitle)
        await repository.updateProgramTitle(program.id, title);
    }
    setProgram((previous) =>
      previous
        ? {
            ...previous,
            title:
              previous.contentType === "quick_workout" ? title : previous.title,
            weeks: previous.weeks.map((week) => ({
              ...week,
              workouts: week.workouts.map((workout) =>
                workout.id === selectedWorkout.id
                  ? { ...workout, title, durationMinutes }
                  : workout,
              ),
            })),
          }
        : previous,
    );
    setModal(null);
    notify("Workout details updated");
  }

  async function updateProgramTitle(title: string) {
    if (!program) return;
    const nextTitle = title.trim();
    if (!nextTitle || nextTitle === program.title) return;
    if (repository) await repository.updateProgramTitle(program.id, nextTitle);
    setProgram((previous) =>
      previous ? { ...previous, title: nextTitle } : previous,
    );
    notify("Program name updated");
  }

  async function addExerciseToWorkout(
    exercise: Exercise,
    destinationSectionId?: string,
  ) {
    if (!selectedWorkout) return;
    const targetSection =
      selectedWorkout.sections.find(
        (section) => section.id === (destinationSectionId ?? selectedSectionId),
      ) ?? selectedWorkout.sections.at(-1);
    if (!targetSection) return;
    setSelectedSectionId(targetSection.id);
    let item: WorkoutItem;
    if (repository) {
      try {
        item = await repository.addWorkoutItem(targetSection, exercise);
      } catch (error) {
        notify(
          error instanceof Error
            ? error.message
            : "The exercise could not be added",
        );
        return;
      }
    } else {
      item = {
        id: `item-${Date.now()}`,
        exerciseId: exercise.id,
        title: exercise.name,
        cue: exercise.cue,
        mode: exercise.defaultMode,
        fields: exercise.defaultFields,
        prescription:
          exercise.defaultMode === "sets"
            ? { sets: 3, reps: "8", targetRpe: "7–8" }
            : exercise.defaultMode === "intervals"
              ? { rounds: 5, workSeconds: 60, restSeconds: 60 }
              : exercise.defaultMode === "result"
                ? { durationMinutes: 20 }
                : {},
      };
    }
    setProgram((previous) =>
      previous
        ? {
            ...previous,
            weeks: previous.weeks.map((week) =>
              week.index !== selectedWeek
                ? week
                : {
                    ...week,
                    workouts: week.workouts.map((workout) =>
                      workout.id !== selectedWorkout.id
                        ? workout
                        : {
                            ...workout,
                            sections: workout.sections.length
                              ? workout.sections.map((section) =>
                                  section.id === targetSection.id
                                    ? {
                                        ...section,
                                        items: [...section.items, item],
                                      }
                                    : section,
                                )
                              : [
                                  {
                                    id: `section-${Date.now()}`,
                                    title: "Main work",
                                    kind: "main",
                                    items: [item],
                                  },
                                ],
                          },
                    ),
                  },
            ),
          }
        : previous,
    );
    setPrescriptionItem(item);
    setNewPrescriptionItemId(item.id);
    setModal("prescription");
  }

  async function savePrescription(nextItem: WorkoutItem) {
    if (repository) await repository.updateWorkoutItemPrescription(nextItem);
    setProgram((previous) =>
      previous
        ? {
            ...previous,
            weeks: previous.weeks.map((week) => ({
              ...week,
              workouts: week.workouts.map((workout) => ({
                ...workout,
                sections: workout.sections.map((section) => ({
                  ...section,
                  items: section.items.map((item) =>
                    item.id === nextItem.id ? nextItem : item,
                  ),
                })),
              })),
            })),
          }
        : previous,
    );
    setPrescriptionItem(null);
    setNewPrescriptionItemId(null);
    setModal(null);
    notify(`${nextItem.title} prescription saved`);
  }

  async function addBlankWeek() {
    if (!program || !repository || programAction || weekMutationRef.current)
      return false;
    if (program.weeks.length >= 52) {
      notify("A program can contain up to 52 weeks");
      return false;
    }
    weekMutationRef.current = true;
    setProgramAction({ id: program.id, kind: "week" });
    try {
      await repository.addProgramWeek(program.versionId);
      const refreshed = await repository.loadEditableProgram(
        program.athleteId,
        program.id,
      );
      const lastWeek = refreshed.weeks.at(-1);
      selectProgram(refreshed, { weekIndex: lastWeek?.index });
      notify("Blank week added");
      return true;
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "The week could not be added",
      );
      return false;
    } finally {
      weekMutationRef.current = false;
      setProgramAction(null);
    }
  }

  async function copyCurrentWeek(count: number) {
    if (
      !program ||
      !currentWeek ||
      !repository ||
      programAction ||
      weekMutationRef.current
    )
      return false;
    const availableSlots = Math.max(0, 52 - program.weeks.length);
    const copyCount = Math.min(Math.max(Math.trunc(count), 1), availableSlots);
    if (!copyCount) {
      notify("A program can contain up to 52 weeks");
      return false;
    }
    weekMutationRef.current = true;
    setProgramAction({ id: program.id, kind: "week" });
    try {
      await repository.duplicateWeekTimes(currentWeek.id, copyCount);
      const refreshed = await repository.loadEditableProgram(
        program.athleteId,
        program.id,
      );
      const lastWeek = refreshed.weeks.at(-1);
      selectProgram(refreshed, { weekIndex: lastWeek?.index });
      notify(
        copyCount === 1
          ? `${currentWeek.label} copied`
          : `${currentWeek.label} copied ${copyCount} times`,
      );
      return true;
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "The week could not be copied",
      );
      return false;
    } finally {
      weekMutationRef.current = false;
      setProgramAction(null);
    }
  }

  async function deleteWeek() {
    if (!currentWeek || !repository) return;
    if (
      !window.confirm(
        `Delete ${currentWeek.label || `week ${currentWeek.index}`} and all of its workouts?`,
      )
    )
      return;
    try {
      await repository.deleteProgramWeek(currentWeek.id);
      await reloadCurrentProgram();
      notify("Week deleted");
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "The week could not be deleted",
      );
    }
  }

  async function deleteSelectedWorkout() {
    if (!selectedWorkout || !repository) return;
    if (!window.confirm(`Delete “${selectedWorkout.title}” from this week?`))
      return;
    try {
      await repository.deleteWorkout(selectedWorkout.id);
      await reloadCurrentProgram();
      notify("Workout deleted");
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "The workout could not be deleted",
      );
    }
  }

  async function addSection(title: string, kind: WorkoutSection["kind"]) {
    if (!selectedWorkout || !repository) return;
    try {
      const sectionId = await repository.addWorkoutSection(
        selectedWorkout.id,
        title,
        kind ?? "custom",
      );
      await reloadCurrentProgram();
      setSelectedSectionId(sectionId);
      setSectionEditing(null);
      setModal(null);
      notify(`${title} section added`);
    } catch (error) {
      throw error instanceof Error
        ? error
        : new Error("The section could not be added");
    }
  }

  async function updateSection(title: string, kind: WorkoutSection["kind"]) {
    if (!sectionEditing || !repository) return;
    try {
      await repository.updateWorkoutSection(
        sectionEditing.id,
        title,
        kind ?? "custom",
      );
      await reloadCurrentProgram();
      setSectionEditing(null);
      setModal(null);
      notify("Section updated");
    } catch (error) {
      throw error instanceof Error
        ? error
        : new Error("The section could not be updated");
    }
  }

  async function deleteSection(sectionId: string, deleteItems: boolean) {
    const section = selectedWorkout?.sections.find(
      (candidate) => candidate.id === sectionId,
    );
    if (!section || section.kind === "main") {
      throw new Error("Main work must remain in every workout");
    }
    const mainSection = selectedWorkout?.sections.find(
      (candidate) => candidate.kind === "main",
    );
    if (!mainSection) throw new Error("This workout needs a Main work section");
    try {
      if (repository) {
        await repository.deleteWorkoutSection(sectionId, deleteItems);
        await reloadCurrentProgram();
      } else if (selectedWorkout) {
        setProgram((previous) =>
          previous
            ? {
                ...previous,
                weeks: previous.weeks.map((week) => ({
                  ...week,
                  workouts: week.workouts.map((workout) =>
                    workout.id !== selectedWorkout.id
                      ? workout
                      : {
                          ...workout,
                          sections: workout.sections
                            .filter((candidate) => candidate.id !== sectionId)
                            .map((candidate) =>
                              candidate.id === mainSection.id && !deleteItems
                                ? {
                                    ...candidate,
                                    items: [...candidate.items, ...section.items],
                                  }
                                : candidate,
                            ),
                        },
                  ),
                })),
              }
            : previous,
        );
      }
      setSelectedSectionId(mainSection.id);
      setSectionDeleteTarget(null);
      setModal(null);
      notify(
        deleteItems
          ? "Section and its exercises deleted"
          : "Section deleted · exercises moved to Main work",
      );
    } catch (error) {
      if (
        repository &&
        program &&
        error instanceof Error &&
        error.message.includes("Published program content is immutable")
      ) {
        selectProgram(
          await repository.loadEditableProgram(program.athleteId, program.id),
          { weekIndex: selectedWeek },
        );
        setSectionDeleteTarget(null);
        setModal(null);
        notify("Opened the editable program copy. Delete the section there.");
        return;
      }
      throw error instanceof Error
        ? error
        : new Error("The section could not be deleted");
    }
  }

  async function reorderWorkouts(workoutIds: string[]) {
    if (
      !program ||
      !currentWeek ||
      !repository ||
      builderMutationPendingRef.current
    )
      return;
    const snapshot = program;
    const selection = {
      weekIndex: selectedWeek,
      workoutId: selectedWorkoutId,
      sectionId: selectedSectionId,
    };
    const optimisticProgram = reorderProgramWorkouts(
      snapshot,
      currentWeek.id,
      workoutIds,
    );
    builderMutationPendingRef.current = true;
    setBuilderMutationPending(true);
    replaceProgramEverywhere(optimisticProgram);
    try {
      await repository.reorderWorkouts(currentWeek.id, workoutIds);
    } catch (error) {
      await restoreProgramAfterBuilderFailure(snapshot, selection);
      notify(
        error instanceof Error
          ? error.message
          : "Workouts could not be reordered",
      );
    } finally {
      builderMutationPendingRef.current = false;
      setBuilderMutationPending(false);
    }
  }

  async function moveItem(
    itemId: string,
    destinationSectionId: string,
    destinationPosition: number,
  ) {
    if (
      !program ||
      !selectedWorkout ||
      !repository ||
      builderMutationPendingRef.current
    )
      return;
    const snapshot = program;
    const selection = {
      weekIndex: selectedWeek,
      workoutId: selectedWorkoutId,
      sectionId: selectedSectionId,
    };
    const optimisticProgram = moveProgramExercise(
      snapshot,
      selectedWorkout.id,
      itemId,
      destinationSectionId,
      destinationPosition,
    );
    builderMutationPendingRef.current = true;
    setBuilderMutationPending(true);
    setSelectedSectionId(destinationSectionId);
    replaceProgramEverywhere(optimisticProgram);
    try {
      await repository.moveWorkoutItem(
        itemId,
        destinationSectionId,
        destinationPosition,
      );
    } catch (error) {
      await restoreProgramAfterBuilderFailure(snapshot, selection);
      notify(
        error instanceof Error
          ? error.message
          : "The exercise could not be moved",
      );
    } finally {
      builderMutationPendingRef.current = false;
      setBuilderMutationPending(false);
    }
  }

  async function reorderSections(sectionIds: string[]) {
    if (
      !program ||
      !selectedWorkout ||
      !repository ||
      builderMutationPendingRef.current
    )
      return;
    const snapshot = program;
    const selection = {
      weekIndex: selectedWeek,
      workoutId: selectedWorkoutId,
      sectionId: selectedSectionId,
    };
    const optimisticProgram = reorderProgramSections(
      snapshot,
      selectedWorkout.id,
      sectionIds,
    );
    builderMutationPendingRef.current = true;
    setBuilderMutationPending(true);
    replaceProgramEverywhere(optimisticProgram);
    try {
      await repository.reorderWorkoutSections(selectedWorkout.id, sectionIds);
    } catch (error) {
      await restoreProgramAfterBuilderFailure(snapshot, selection);
      notify(
        error instanceof Error
          ? error.message
          : "Sections could not be reordered",
      );
    } finally {
      builderMutationPendingRef.current = false;
      setBuilderMutationPending(false);
    }
  }

  function removeItemFromProgram(itemId: string) {
    if (!selectedWorkout) return;
    setProgram((previous) =>
      previous
        ? {
            ...previous,
            weeks: previous.weeks.map((week) =>
              week.index !== selectedWeek
                ? week
                : {
                    ...week,
                    workouts: week.workouts.map((workout) =>
                      workout.id !== selectedWorkout.id
                        ? workout
                        : {
                            ...workout,
                            sections: workout.sections.map((section) => ({
                              ...section,
                              items: section.items.filter(
                                (item) => item.id !== itemId,
                              ),
                            })),
                          },
                    ),
                  },
            ),
          }
        : previous,
    );
  }

  async function removeWorkoutItem(itemId: string) {
    if (!selectedWorkout) return;
    const item = selectedWorkout.sections
      .flatMap((section) => section.items)
      .find((candidate) => candidate.id === itemId);
    if (!window.confirm(`Remove “${item?.title ?? "this exercise"}”?`)) return;
    if (repository) {
      try {
        await repository.removeWorkoutItem(itemId);
      } catch (error) {
        notify(
          error instanceof Error
            ? error.message
            : "The item could not be removed",
        );
        return;
      }
    }
    removeItemFromProgram(itemId);
  }

  async function cancelPrescription() {
    if (prescriptionItem && newPrescriptionItemId === prescriptionItem.id) {
      try {
        if (repository) await repository.removeWorkoutItem(prescriptionItem.id);
        removeItemFromProgram(prescriptionItem.id);
      } catch (error) {
        notify(
          error instanceof Error
            ? error.message
            : "The new exercise could not be cancelled",
        );
        return;
      }
    }
    setPrescriptionItem(null);
    setNewPrescriptionItemId(null);
    setModal(null);
  }

  async function addPersonalExercise(
    name: string,
    category: string,
    mode: EntryMode,
    cue: string,
  ) {
    let exercise: Exercise;
    if (repository) {
      try {
        exercise = await repository.createPersonalExercise({
          name,
          category,
          mode,
          cue,
        });
      } catch (error) {
        notify(
          error instanceof Error
            ? error.message
            : "The exercise could not be saved",
        );
        return;
      }
    } else {
      const fields: TrackingField[] =
        mode === "sets"
          ? ["reps", "load", "rpe"]
          : mode === "result"
            ? ["duration", "distance", "rpe"]
            : mode === "intervals"
              ? ["rounds", "duration", "rpe"]
              : [];
      exercise = {
        id: `personal-${Date.now()}`,
        name,
        category: category || "Custom",
        cue,
        scope: "personal",
        ownerName: viewer.name,
        defaultMode: mode,
        defaultFields: fields,
      };
    }
    setPersonalExercises((previous) => [...previous, exercise]);
    setExerciseScope("personal");
    setModal(null);
    notify(`${name} saved to your library`);
  }

  async function deletePersonalExercise(exercise: Exercise) {
    if (exercise.scope !== "personal") {
      throw new Error("Only exercises in My exercises can be deleted.");
    }
    if (repository) await repository.archivePersonalExercise(exercise.id);
    setPersonalExercises((previous) =>
      previous.filter((candidate) => candidate.id !== exercise.id),
    );
    setExerciseDeleteTarget(null);
    setModal(null);
    notify(`${exercise.name} removed from your library`);
  }

  async function publishProgram(description: string) {
    if (!program || programAction) return;
    if (!repository) {
      notify("Program saved for the local demo");
      return;
    }
    setProgramAction({ id: program.id, kind: "publish" });
    try {
      const nextDescription = description.trim();
      if (nextDescription !== program.description) {
        await repository.updateProgramDescription(program.id, nextDescription);
      }
      await repository.publishProgram(program.versionId);
      if (program.contentType === "quick_workout") {
        await repository.setProgramAvailability(program.id, true);
      }
      applyWorkspace(await repository.loadWorkspace());
      setProgram(null);
      setProgramOwnerId(viewer.id);
      notify(
        program.contentType === "quick_workout"
          ? "Workout saved. It is ready to schedule or assign."
          : program.sourceType === "coach"
          ? "Coach program finished · the athlete can add it to scheduling"
          : "Program saved. Add it to scheduling when you are ready.",
      );
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "The program could not be updated",
      );
    } finally {
      setProgramAction(null);
    }
  }

  async function createEditableDraft() {
    if (!program || !repository || programAction) return;
    setProgramAction({ id: program.id, kind: "edit" });
    try {
      selectProgram(
        await repository.loadEditableProgram(program.athleteId, program.id),
      );
      notify("Editable future plan created");
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "An editable plan could not be created",
      );
    } finally {
      setProgramAction(null);
    }
  }

  async function editProgram(targetProgram: Program) {
    if (!repository) {
      selectProgram(targetProgram);
      return;
    }
    if (programAction) return;
    setProgramAction({ id: targetProgram.id, kind: "edit" });
    try {
      selectProgram(
        await repository.loadEditableProgram(
          targetProgram.athleteId,
          targetProgram.id,
        ),
      );
      setActiveView("program");
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "The program could not be opened for editing",
      );
    } finally {
      setProgramAction(null);
    }
  }

  async function deactivateProgram() {
    if (!program || program.athleteId !== viewer.id) return;
    try {
      if (repository) {
        await repository.deactivateProgram(program.id);
        applyWorkspace(await repository.loadWorkspace());
      } else {
        setWorkspace((previous) => ({
          ...previous,
          availablePrograms: previous.availablePrograms.filter(
            (candidate) => candidate.id !== program.id,
          ),
          draftProgram:
            previous.draftProgram?.id === program.id
              ? null
              : previous.draftProgram,
          activeProgram:
            previous.activeProgram?.id === program.id
              ? null
              : previous.activeProgram,
          scheduledWorkouts: previous.scheduledWorkouts.filter(
            (schedule) => schedule.programVersionId !== program.versionId,
          ),
        }));
      }
      setProgram(null);
      setProgramOwnerId(viewer.id);
      setModal(null);
      notify("Program deactivated · choose another whenever you are ready");
    } catch (error) {
      throw error instanceof Error
        ? error
        : new Error("The program could not be deactivated");
    }
  }

  async function removeCoachAccess(connection: CoachConnection) {
    if (repository) {
      try {
        await repository.endCoachRelationship(connection.relationshipId);
        applyWorkspace(await repository.loadWorkspace());
      } catch (error) {
        notify(
          error instanceof Error
            ? error.message
            : "Coach access could not be removed",
        );
        return;
      }
    } else {
      setWorkspace((previous) => ({
        ...previous,
        coachConnections: previous.coachConnections.filter(
          (item) => item.relationshipId !== connection.relationshipId,
        ),
      }));
    }
    notify("Coach access removed");
  }

  async function createCoachInvite(
    identifier: string,
  ): Promise<CoachInviteReceipt> {
    const receipt = repository
      ? await repository.createCoachInvite(identifier)
      : {
          id: `invite-${Date.now()}`,
          targetProfileId: `demo-coach-${Date.now()}`,
          targetName: "Demo Coach",
          expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        };
    const outgoingInvite: OutgoingCoachInvite = {
      id: receipt.id,
      coachId: receipt.targetProfileId,
      coachName: receipt.targetName,
      coachInitials: receipt.targetName
        .split(/\s+/)
        .map((part) => part[0])
        .slice(0, 2)
        .join(""),
      createdAt: new Date().toISOString(),
      expiresAt: receipt.expiresAt,
    };
    setWorkspace((previous) => ({
      ...previous,
      outgoingCoachInvites: [
        outgoingInvite,
        ...(previous.outgoingCoachInvites ?? []).filter(
          (candidate) => candidate.id !== receipt.id,
        ),
      ],
    }));
    if (repository) {
      try {
        applyWorkspace(await repository.loadWorkspace());
      } catch {
        // The request succeeded; the optimistic row remains visible.
      }
    }
    return receipt;
  }

  async function cancelCoachInvite(invitation: OutgoingCoachInvite) {
    if (cancellingCoachInviteId) return;
    setCancellingCoachInviteId(invitation.id);
    try {
      if (repository) await repository.cancelCoachInvite(invitation.id);
      setWorkspace((previous) => ({
        ...previous,
        outgoingCoachInvites: (previous.outgoingCoachInvites ?? []).filter(
          (candidate) => candidate.id !== invitation.id,
        ),
      }));
      if (repository) {
        try {
          applyWorkspace(await repository.loadWorkspace());
        } catch {
          // Cancellation succeeded; keep the local removal and allow refresh.
        }
      }
      notify(`Request to ${invitation.coachName} cancelled`);
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "The coaching request could not be cancelled",
      );
    } finally {
      setCancellingCoachInviteId(null);
    }
  }

  async function resolveCoachInvite(
    identifier: string,
  ): Promise<CoachInviteTarget> {
    if (repository) return repository.resolveCoachInviteTarget(identifier);
    return {
      registered: true,
      identifierType: identifier.includes("@") ? "email" : "id",
      displayName: "Demo Coach",
      liftlogId: "LL-DEMOCOACH000001",
    };
  }

  async function respondToCoachInvite(
    invitation: PendingCoachInvite,
    response: "accepted" | "declined",
  ) {
    if (respondingInvite) return;
    setRespondingInvite({ id: invitation.id, response });
    try {
      if (repository)
        await repository.respondToCoachInvite(invitation.id, response);

      setWorkspace((previous) => ({
        ...previous,
        pendingCoachInvites: previous.pendingCoachInvites.filter(
          (candidate) => candidate.id !== invitation.id,
        ),
        coachedAthletes:
          response === "accepted" &&
          !previous.coachedAthletes.some(
            (athlete) => athlete.id === invitation.athleteId,
          )
            ? [
                ...previous.coachedAthletes,
                {
                  id: invitation.athleteId,
                  relationshipId: `pending-refresh-${invitation.id}`,
                  name: invitation.athleteName,
                  initials: invitation.athleteInitials,
                  assignedPrograms: [],
                  agenda: [],
                },
              ]
            : previous.coachedAthletes,
      }));

      let refreshFailed = false;
      if (repository) {
        try {
          applyWorkspace(await repository.loadWorkspace());
        } catch {
          refreshFailed = true;
        }
      }
      notify(
        response === "accepted"
          ? `${invitation.athleteName} added to your athletes${refreshFailed ? " · refresh to sync details" : ""}`
          : `Request from ${invitation.athleteName} declined${refreshFailed ? " · refresh to sync" : ""}`,
      );
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "The coaching request could not be updated",
      );
    } finally {
      setRespondingInvite(null);
    }
  }

  async function assignProgramToAthletes(
    programId: string,
    athleteIds: string[],
  ): Promise<ProgramAssignment[]> {
    const sourceProgram = assignableOwnPrograms.find(
      (candidate) => candidate.id === programId,
    );
    if (!sourceProgram) throw new Error("Choose a finished Own program.");
    if (!athleteIds.length) throw new Error("Choose at least one athlete.");
    const assignments = repository
      ? await repository.assignOwnProgramToAthletes(programId, athleteIds)
      : athleteIds.map((athleteId) => ({
          athleteId,
          programId: `assigned-${programId}-${athleteId}`,
          created: true,
        }));
    const selectedIds = new Set(athleteIds);
    const assignedAt = new Date().toISOString();
    const workoutCount = programWorkoutCount(sourceProgram);
    const withOptimisticAssignment = (athlete: AthleteSummary) => {
      if (!selectedIds.has(athlete.id)) return athlete;
      const assignment = assignments.find(
        (candidate) => candidate.athleteId === athlete.id,
      );
      if (
        !assignment?.created ||
        athlete.assignedPrograms.some(
          (candidate) => candidate.id === assignment.programId,
        )
      )
        return athlete;
      return {
        ...athlete,
        assignedPrograms: [
          {
            id: assignment.programId,
            versionId: sourceProgram.versionId,
            title: sourceProgram.title,
            assignedAt,
                  status: "awaiting_schedule" as const,
                  totalWorkouts: workoutCount,
                  scheduledWorkouts: 0,
                  scheduledPercent: 0,
                  completedWorkouts: 0,
                  completionPercent: 0,
                  workoutProgress: Array.from(
                    { length: workoutCount },
                    () => "unscheduled" as const,
                  ),
          },
          ...athlete.assignedPrograms,
        ],
      };
    };
    setWorkspace((previous) => ({
      ...previous,
      coachedAthletes: previous.coachedAthletes.map(withOptimisticAssignment),
    }));
    setSelectedAthlete((previous) =>
      previous ? withOptimisticAssignment(previous) : previous,
    );
    setAssignmentSeed({});
    setModal(null);

    let refreshFailed = false;
    if (repository) {
      try {
        applyWorkspace(await repository.loadWorkspace());
      } catch {
        refreshFailed = true;
      }
    }
    const createdCount = assignments.filter(
      (assignment) => assignment.created,
    ).length;
    notify(
      createdCount
        ? `${sourceProgram.title} assigned to ${createdCount} ${createdCount === 1 ? "athlete" : "athletes"}${refreshFailed ? " · refresh to sync details" : ""}`
        : `${sourceProgram.title} was already assigned to the selected athletes${refreshFailed ? " · refresh to sync details" : ""}`,
    );
    return assignments;
  }

  async function assignQuickWorkoutToAthletes(
    programId: string,
    athleteIds: string[],
    plannedDate: string,
  ): Promise<ProgramAssignment[]> {
    const workout = assignableOwnPrograms.find(
      (candidate) => candidate.id === programId,
    );
    if (!workout || workout.contentType !== "quick_workout")
      throw new Error("Choose a finished quick workout.");
    if (!athleteIds.length) throw new Error("Choose at least one athlete.");
    const assignments = repository
      ? await repository.assignQuickWorkoutToAthletes(
          programId,
          athleteIds,
          plannedDate,
        )
      : athleteIds.map((athleteId) => ({
          athleteId,
          programId: `assigned-${programId}-${athleteId}`,
          created: true,
        }));
    if (repository) applyWorkspace(await repository.loadWorkspace());
    setAssignmentSeed({});
    setModal(null);
    notify(
      `${workout.title} scheduled for ${athleteIds.length} ${athleteIds.length === 1 ? "athlete" : "athletes"}`,
    );
    return assignments;
  }

  async function saveProfile(
    firstName: string,
    lastName: string,
    weekStartsOnSunday: boolean,
    weightUnit: OwnProfile["weightUnit"],
    distanceUnit: OwnProfile["distanceUnit"],
  ) {
    try {
      const profile = repository
        ? await repository.updateOwnProfile(
            firstName,
            lastName,
            weekStartsOnSunday,
            weightUnit,
            distanceUnit,
          )
        : {
            ...workspace.profile,
            firstName,
            lastName,
            displayName: `${firstName} ${lastName}`.trim(),
            weekStartsOnSunday,
            weightUnit,
            distanceUnit,
          };
      setWorkspace((previous) => ({ ...previous, profile }));
      setModal(null);
      notify("Account details updated");
    } catch (error) {
      throw error instanceof Error
        ? error
        : new Error("Your account could not be updated");
    }
  }

  async function createProgram(title: string) {
    const target = programTarget ?? {
      id: viewer.id,
      name: workspace.profile.displayName,
    };
    try {
      if (repository) {
        const programId = await repository.createBlankProgram(target.id, title);
        if (target.id === viewer.id)
          applyWorkspace(await repository.loadWorkspace());
        selectProgram(
          await repository.loadEditableProgram(target.id, programId),
        );
      } else {
        const emptyProgram: Program = {
          id: `program-${Date.now()}`,
          athleteId: target.id,
          versionId: `version-${Date.now()}`,
          versionStatus: "draft",
          title,
          description: "",
          phase: "Plan",
          activeWeek: 1,
          weeks: [
            {
              id: `week-${Date.now()}`,
              index: 1,
              label: "Week 1",
              workouts: [],
            },
          ],
          ownerName: target.name,
          createdById: viewer.id,
          createdByName: workspace.profile.displayName,
          sourceType: target.id === viewer.id ? "self" : "coach",
          sourceLabel:
            target.id === viewer.id
              ? "Created by you"
              : `Created by ${workspace.profile.displayName}`,
        };
        setWorkspace((previous) =>
          target.id === viewer.id
            ? { ...previous, draftProgram: emptyProgram }
            : previous,
        );
        selectProgram(emptyProgram);
      }
      setProgramTarget(null);
      setModal(null);
      setActiveView("program");
      if (target.id === viewer.id) setProgramSource("own");
      notify(
        `Program created for ${target.id === viewer.id ? "you" : target.name}`,
      );
    } catch (error) {
      throw error instanceof Error
        ? error
        : new Error("The program could not be created");
    }
  }

  async function createQuickWorkout(title: string) {
    try {
      if (repository) {
        const workoutId = await repository.createBlankQuickWorkout(title);
        applyWorkspace(await repository.loadWorkspace());
        selectProgram(await repository.loadEditableProgram(viewer.id, workoutId));
      } else {
        const now = Date.now();
        selectProgram({
          id: `quick-workout-${now}`,
          athleteId: viewer.id,
          versionId: `version-${now}`,
          versionStatus: "draft",
          title,
          description: "",
          phase: "Workout",
          activeWeek: 1,
          weeks: [{
            id: `week-${now}`,
            index: 1,
            label: "Workout",
            workouts: [{
              id: `workout-${now}`,
              title,
              dayLabel: "Workout",
              durationMinutes: 45,
              sections: [
                { id: `warmup-${now}`, title: "Warm up", kind: "warmup", items: [] },
                { id: `main-${now}`, title: "Main work", kind: "main", items: [] },
                { id: `cooldown-${now}`, title: "Cooldown", kind: "cooldown", items: [] },
              ],
            }],
          }],
          ownerName: workspace.profile.displayName,
          createdById: viewer.id,
          createdByName: workspace.profile.displayName,
          sourceType: "self",
          sourceLabel: "Created by you",
          contentType: "quick_workout",
        });
      }
      setModal(null);
      setActiveView("program");
      setProgramSource("own");
      notify("Quick workout created");
    } catch (error) {
      throw error instanceof Error
        ? error
        : new Error("The workout could not be created");
    }
  }

  async function handleTemplateAction(
    template: ProgramTemplate,
    intent: "open" | "copy" | "schedule",
  ) {
    if (activatingTemplateId) return;
    setActivatingTemplateId(template.id);
    try {
      if (repository) {
        const libraryProgramId = await repository.createProgramFromTemplate(
          template.id,
        );
        const targetProgramId =
          intent === "copy"
            ? await repository.copyProgramToOwn(libraryProgramId)
            : libraryProgramId;
        if (intent === "schedule") {
          await repository.setProgramAvailability(targetProgramId, true);
        }
        const nextWorkspace = await repository.loadWorkspace();
        applyWorkspace(nextWorkspace);
        const targetProgram = nextWorkspace.programCatalog.find(
          (candidate) => candidate.id === targetProgramId,
        );
        if (targetProgram) {
          if (intent === "schedule") {
            await repository.prepareProgramSchedule(targetProgram.versionId);
            const preparedWorkspace = await repository.loadWorkspace();
            applyWorkspace(preparedWorkspace);
            const firstWorkout = preparedWorkspace.scheduledWorkouts.find(
              (schedule) =>
                schedule.programId === targetProgram.id &&
                schedule.status === "planned" &&
                !schedule.plannedDate,
            );
            setScheduleEditingId(firstWorkout?.id ?? null);
            setScheduleInitialDate(null);
            setModal("schedule");
          } else {
            const detail = await repository.loadProgramDetail(
              targetProgram.athleteId,
              targetProgram.id,
            );
            if (detail) selectProgram(detail);
          }
        }
      }
      setProgramSource(intent === "copy" ? "own" : "library");
      setProgramOwnerId(viewer.id);
      setActiveView("program");
      notify(
        intent === "copy"
          ? `${template.title} copied to Own`
          : intent === "schedule"
            ? `${template.title} added to scheduling`
            : `${template.title} opened`,
      );
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "The library program could not be started",
      );
    } finally {
      setActivatingTemplateId(null);
    }
  }

  async function scheduleLibraryProgram(targetProgram: Program) {
    if (!repository || programAction) return;
    setProgramAction({ id: targetProgram.id, kind: "availability" });
    try {
      await repository.setProgramAvailability(targetProgram.id, true);
      await repository.prepareProgramSchedule(targetProgram.versionId);
      const nextWorkspace = await repository.loadWorkspace();
      applyWorkspace(nextWorkspace);
      const firstWorkout = nextWorkspace.scheduledWorkouts.find(
        (schedule) =>
          schedule.programId === targetProgram.id &&
          schedule.status === "planned" &&
          !schedule.plannedDate,
      );
      setScheduleEditingId(firstWorkout?.id ?? null);
      setScheduleInitialDate(null);
      setModal("schedule");
      notify(`${targetProgram.title} added to scheduling`);
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "The library program could not be added to scheduling",
      );
    } finally {
      setProgramAction(null);
    }
  }

  async function setProgramAvailable(
    targetProgram: Program,
    available: boolean,
  ) {
    if (!repository || programAction) return;
    setProgramAction({ id: targetProgram.id, kind: "availability" });
    try {
      await repository.setProgramAvailability(targetProgram.id, available);
      applyWorkspace(await repository.loadWorkspace());
      notify(
        available
          ? `${targetProgram.title} added to scheduling`
          : `${targetProgram.title} removed from scheduling`,
      );
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Program availability could not be changed",
      );
    } finally {
      setProgramAction(null);
    }
  }

  async function copyProgram(targetProgram: Program) {
    if (!repository || programAction) return;
    setProgramAction({ id: targetProgram.id, kind: "copy" });
    try {
      const copiedId = await repository.copyProgramToOwn(targetProgram.id);
      const nextWorkspace = await repository.loadWorkspace();
      applyWorkspace(nextWorkspace);
      const copied = nextWorkspace.programCatalog.find(
        (candidate) => candidate.id === copiedId,
      );
      if (copied) {
        setProgramSource("own");
        const detail = await repository.loadProgramDetail(
          copied.athleteId,
          copied.id,
        );
        if (detail) selectProgram(detail);
      }
      notify(`${targetProgram.title} copied to Own`);
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "The program could not be copied",
      );
    } finally {
      setProgramAction(null);
    }
  }

  async function deleteOwnProgram(targetProgram: Program) {
    if (programAction) return;
    if (
      !window.confirm(
        `Delete “${targetProgram.title}”? It will disappear from Own and In schedule, and unstarted planned workouts will be removed. Completed training history will stay.`,
      )
    )
      return;
    setProgramAction({ id: targetProgram.id, kind: "delete" });
    try {
      if (repository) {
        await repository.deleteOwnProgram(targetProgram.id);
        applyWorkspace(await repository.loadWorkspace());
      } else {
        setWorkspace((previous) => ({
          ...previous,
          programCatalog: previous.programCatalog.filter(
            (candidate) => candidate.id !== targetProgram.id,
          ),
          availableProgramIds: previous.availableProgramIds.filter(
            (id) => id !== targetProgram.id,
          ),
          availablePrograms: previous.availablePrograms.filter(
            (candidate) => candidate.id !== targetProgram.id,
          ),
          draftProgram:
            previous.draftProgram?.id === targetProgram.id
              ? null
              : previous.draftProgram,
          activeProgram:
            previous.activeProgram?.id === targetProgram.id
              ? null
              : previous.activeProgram,
          scheduledWorkouts: previous.scheduledWorkouts.filter(
            (schedule) => schedule.programId !== targetProgram.id,
          ),
        }));
      }
      if (program?.id === targetProgram.id) setProgram(null);
      notify(`${targetProgram.title} deleted · training history preserved`);
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "The program could not be deleted",
      );
    } finally {
      setProgramAction(null);
    }
  }

  async function openSchedule(scheduleId?: string, initialDate?: string) {
    if (scheduleOpeningRef.current) return;
    setScheduleEditingId(scheduleId ?? null);
    setScheduleInitialDate(initialDate ?? null);
    setModal("schedule");
    if (!repository || scheduleId) return;

    scheduleOpeningRef.current = true;
    setScheduleOpening(true);
    if (repository) {
      try {
        const schedulable = availablePrograms.filter(
          (candidate) => candidate.versionStatus === "published",
        );
        if (schedulable.length) {
          await Promise.all(
            schedulable.map((candidate) =>
              repository.prepareProgramSchedule(candidate.versionId),
            ),
          );
          applyWorkspace(await repository.loadWorkspace());
        }
      } catch (error) {
        setModal(null);
        setScheduleEditingId(null);
        notify(
          error instanceof Error
            ? error.message
            : "The program calendar could not be prepared",
        );
      } finally {
        scheduleOpeningRef.current = false;
        setScheduleOpening(false);
      }
    }
  }

  async function saveSchedule(scheduleId: string, date: string | null) {
    const previousDate = workspace.scheduledWorkouts.find(
      (schedule) => schedule.id === scheduleId,
    )?.plannedDate;
    try {
      if (repository) {
        await repository.scheduleWorkout(scheduleId, date);
      }
      setWorkspace((previous) => ({
        ...previous,
        scheduledWorkouts: previous.scheduledWorkouts.map((schedule) =>
          schedule.id === scheduleId
            ? {
                ...schedule,
                plannedDate: date ?? undefined,
                workout: {
                  ...schedule.workout,
                  plannedDate: date ?? undefined,
                },
              }
            : schedule,
        ),
      }));
      setModal(null);
      setScheduleEditingId(null);
      notify(
        !date
          ? "Workout removed from the calendar"
          : previousDate
            ? "Workout rescheduled"
            : "Workout added to your calendar",
      );
    } catch (error) {
      throw error instanceof Error
        ? error
        : new Error("The workout date could not be updated");
    }
  }

  async function setScheduledWorkoutStatus(
    scheduleId: string,
    status: "planned" | "skipped",
  ) {
    if (scheduleStatusAction) return;
    setScheduleStatusAction({ id: scheduleId, status });
    try {
      if (repository) {
        await repository.setScheduledWorkoutStatus(scheduleId, status);
        applyWorkspace(await repository.loadWorkspace());
      } else {
        setWorkspace((previous) => ({
          ...previous,
          scheduledWorkouts: previous.scheduledWorkouts.map((schedule) =>
            schedule.id === scheduleId ? { ...schedule, status } : schedule,
          ),
        }));
        if (status === "planned") {
          setActiveSession(null);
          setWorkoutStarted(false);
        }
      }
      setWorkoutPreviewSchedule(null);
      notify(
        status === "planned"
          ? "Workout set back to planned"
          : "Workout skipped",
      );
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "The scheduled workout could not be updated",
      );
    } finally {
      setScheduleStatusAction(null);
    }
  }

  async function openCalendarPlan(schedule: ScheduledWorkout) {
    if (await openWorkoutPreview(schedule, "calendar")) navigate("today");
  }

  async function openCalendarResults(
    session: CompletedSession,
    athleteId?: string,
    returnView: "calendar" | "coaching" = "calendar",
  ) {
    const requestId = completedWorkoutRequestRef.current + 1;
    completedWorkoutRequestRef.current = requestId;
    setWorkoutPreviewSchedule(null);
    setCompletedWorkoutView({
      session,
      detail: repository ? null : { ...session, items: [] },
      loading: Boolean(repository),
      error: "",
      returnView,
    });
    navigate("today");
    if (!repository) return;
    try {
      const detail = await repository.loadCompletedSessionDetail(
        session.id,
        athleteId,
      );
      if (completedWorkoutRequestRef.current !== requestId) return;
      setCompletedWorkoutView({
        session: detail ?? session,
        detail,
        loading: false,
        error: detail ? "" : "These workout results are no longer available.",
        returnView,
      });
    } catch (error) {
      if (completedWorkoutRequestRef.current !== requestId) return;
      setCompletedWorkoutView({
        session,
        detail: null,
        loading: false,
        error:
          error instanceof Error
            ? error.message
            : "The workout results could not be loaded.",
        returnView,
      });
    }
  }

  async function openAthleteProgram(
    athlete: AthleteSummary,
    assignedProgram: CoachAssignedProgramSummary,
    workoutId?: string,
    programVersionId?: string,
  ) {
    if (openingCoachProgramId) return;
    setOpeningCoachProgramId(assignedProgram.id);
    try {
      setProgramOwnerId(athlete.id);
      if (!repository) {
        navigate("program");
        return;
      }
      const nextProgram = programVersionId
        ? await repository.loadProgramVersionForAthleteById(
            athlete.id,
            assignedProgram.id,
            programVersionId,
          )
        : await repository.loadProgramForAthleteById(
            athlete.id,
            assignedProgram.id,
          );
      if (nextProgram) {
        const workoutWeek = workoutId
          ? nextProgram.weeks.find((week) =>
              week.workouts.some((workout) => workout.id === workoutId),
            )
          : undefined;
        selectProgram(nextProgram, {
          weekIndex: workoutWeek?.index,
          workoutId,
        });
      }
      else setProgram(null);
      setActiveView("program");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "The athlete program could not be opened",
      );
    } finally {
      setOpeningCoachProgramId(null);
    }
  }

  function openCoachAgendaEntry(
    athlete: AthleteSummary,
    entry: CoachAgendaEntry,
  ) {
    if (entry.kind === "completed" && entry.sessionId) {
      void openCalendarResults(
        {
          id: entry.sessionId,
          programVersionId: entry.programVersionId,
          workoutId: entry.workoutId,
          workoutTitle: entry.workoutTitle,
          date: entry.date,
          durationMinutes: 0,
          rpe: entry.rpe ?? 0,
        },
        athlete.id,
        "coaching",
      );
      return;
    }
    const assignedProgram = athlete.assignedPrograms.find(
      (candidate) => candidate.id === entry.programId,
    );
    if (assignedProgram)
      void openAthleteProgram(
        athlete,
        assignedProgram,
        entry.workoutId,
        entry.programVersionId,
      );
  }

  return (
    <main className="app-shell">
      <Sidebar
        activeView={activeView}
        onNavigate={navigate}
        viewer={viewer}
        profile={workspace.profile}
        onAccount={() => setModal("account")}
        onSignOut={onSignOut}
        onOpenTestPersonas={onOpenTestPersonas}
        coachingRequestCount={workspace.pendingCoachInvites.length}
      />

      <section className="app-content">
        {viewer.isTest && (
          <div className="test-data-banner">
            <FlaskConical size={15} />
            <span>
              <strong>Test account</strong> Fictional development data can be
              reset at any time.
            </span>
            {onOpenTestPersonas && (
              <button onClick={onOpenTestPersonas}>Switch persona</button>
            )}
          </div>
        )}
        <div className="mobile-topbar">
          <button className="brand-mark" onClick={() => navigate("today")}>
            LL
          </button>
          <strong>Lift Log</strong>
          <button
            className="avatar mobile-avatar"
            aria-label="Open my account"
            title="My account"
            onClick={() => setModal("account")}
          >
            {getInitials(workspace.profile.displayName)}
          </button>
        </div>

        {activeView === "today" && completedWorkoutView && (
          <CompletedWorkoutView
            state={completedWorkoutView}
            weightUnit={workspace.profile.weightUnit}
            program={
              programCatalog.find(
                (candidate) =>
                  candidate.versionId === completedWorkoutView.session.programVersionId,
              )
            }
            onBack={() => {
              completedWorkoutRequestRef.current += 1;
              const returnView = completedWorkoutView.returnView;
              setCompletedWorkoutView(null);
              navigate(returnView);
            }}
          />
        )}
        {activeView === "today" &&
          !completedWorkoutView &&
          ((activeSession && todayWorkout && workoutFocus) ||
            (!activeSession && workoutPreviewSchedule)) && (
          <TodayView
            program={activeSession ? todayProgram : previewProgram}
            workout={activeSession ? todayWorkout! : workoutPreviewSchedule!.workout}
            weightUnit={workspace.profile.weightUnit}
            timing={activeSession ? workoutFocus!.timing : "future"}
            plannedDate={
              activeSession
                ? workoutFocus!.plannedDate
                : workoutPreviewSchedule!.plannedDate
            }
            workoutStarted={Boolean(activeSession) && workoutStarted}
            workoutComplete={workoutComplete}
            workoutAction={workoutAction}
            setLogs={setLogs}
            resultLogs={resultLogs}
            sessionRpe={sessionRpe}
            sessionNote={sessionNote}
            onStart={() =>
              void startWorkout(
                activeSession ? todaySchedule! : workoutPreviewSchedule!,
              )
            }
            onFinish={finishWorkout}
            onReset={() => {
              setWorkoutComplete(false);
              setWorkoutStarted(false);
            }}
            onUpdateSet={updateSet}
            onAddSet={addSet}
            onRemoveSet={removeSet}
            onUpdateResult={updateResult}
            onSessionRpe={setSessionRpe}
            onSessionNote={setSessionNote}
            onSetPlanned={
              activeSession && todaySchedule
                ? () => void setScheduledWorkoutStatus(todaySchedule.id, "planned")
                : undefined
            }
            onSkip={
              (activeSession ? todaySchedule : workoutPreviewSchedule)
                ? () =>
                    void setScheduledWorkoutStatus(
                      (activeSession ? todaySchedule : workoutPreviewSchedule)!
                        .id,
                      "skipped",
                    )
                : undefined
            }
            statusAction={
              scheduleStatusAction?.id ===
              (activeSession ? todaySchedule : workoutPreviewSchedule)?.id
                ? (scheduleStatusAction?.status ?? null)
                : null
            }
            viewMode={!activeSession}
            onBack={
              !activeSession
                ? () => {
                    const returnView = workoutPreviewReturnView;
                    setWorkoutPreviewSchedule(null);
                    navigate(returnView);
                  }
                : undefined
            }
            backLabel={
              workoutPreviewReturnView === "calendar"
                ? "Calendar"
                : "Next workouts"
            }
            onReschedule={
              workoutPreviewReturnView === "calendar" && workoutPreviewSchedule
                ? () => {
                    const scheduleId = workoutPreviewSchedule.id;
                    setWorkoutPreviewSchedule(null);
                    navigate("calendar");
                    void openSchedule(scheduleId);
                  }
                : undefined
            }
            onRemoveFromCalendar={
              workoutPreviewReturnView === "calendar" && workoutPreviewSchedule
                ? () => {
                    const scheduleId = workoutPreviewSchedule.id;
                    setWorkoutPreviewSchedule(null);
                    navigate("calendar");
                    void saveSchedule(scheduleId, null);
                  }
                : undefined
            }
            onNavigate={navigate}
          />
        )}
        {activeView === "today" &&
          !completedWorkoutView &&
          !activeSession &&
          !workoutPreviewSchedule && (
          <NextWorkoutsView
            schedules={upcomingWorkouts}
            hasProgram={availablePrograms.length > 0}
            hasPublishedProgram={availablePrograms.some(
              (candidate) => candidate.versionStatus === "published",
            )}
            startingScheduleId={startingScheduleId}
            onNavigate={navigate}
            onSchedule={() => openSchedule()}
            onStart={(schedule) => void startWorkout(schedule)}
            onOpen={openWorkoutPreview}
            onSetStatus={(scheduleId, status) => {
              void setScheduledWorkoutStatus(scheduleId, status);
            }}
            statusAction={scheduleStatusAction}
          />
        )}
        {activeView === "program" && program && currentWeek && (
          <ProgramView
            key={`${program.id}:${program.versionId}`}
            program={program}
            action={
              programAction?.id === program.id ? programAction.kind : null
            }
            mutationPending={builderMutationPending}
            viewerId={viewer.id}
            weightUnit={workspace.profile.weightUnit}
            isAvailable={(workspace.availableProgramIds ?? []).includes(
              program.id,
            )}
            currentWeek={currentWeek}
            selectedWeek={selectedWeek}
            selectedWorkout={selectedWorkout}
            selectedSectionId={selectedSectionId}
            exercises={[...workspace.globalExercises, ...personalExercises]}
            onSelectWeek={(week) => {
              setSelectedWeek(week);
              setSelectedWorkoutId(
                program.weeks[week - 1].workouts[0]?.id ?? "",
              );
              setSelectedSectionId(
                program.weeks[week - 1].workouts[0]?.sections[0]?.id ?? "",
              );
            }}
            onSelectWorkout={(id) => {
              setSelectedWorkoutId(id);
              const workout = currentWeek.workouts.find(
                (item) => item.id === id,
              );
              setSelectedSectionId(workout?.sections[0]?.id ?? "");
            }}
            onSelectSection={setSelectedSectionId}
            onAddBlankWeek={addBlankWeek}
            onCopyWeek={copyCurrentWeek}
            onDeleteWeek={deleteWeek}
            onAddWorkout={() => setModal("workout")}
            onDeleteWorkout={deleteSelectedWorkout}
            onReorderWorkouts={reorderWorkouts}
            onAddSection={() => {
              setSectionEditing(null);
              setModal("section");
            }}
            onEditSection={(section) => {
              setSectionEditing(section);
              setModal("section");
            }}
            onDeleteSection={(section) => {
              setSectionDeleteTarget(section);
              setModal("delete-section");
            }}
            onReorderSections={reorderSections}
            onAddExercise={addExerciseToWorkout}
            onEditItem={(item) => {
              setPrescriptionItem(item);
              setNewPrescriptionItemId(null);
              setModal("prescription");
            }}
            onRemoveItem={removeWorkoutItem}
            onMoveItem={moveItem}
            onSave={(description) => void publishProgram(description)}
            onCreateDraft={createEditableDraft}
            onBack={() => {
              setProgram(null);
              if (program.athleteId !== viewer.id) {
                setCoachMode("coach");
                setActiveView("coaching");
              }
            }}
            onAssignProgram={
              workspace.coachedAthletes.length > 0 &&
              program.athleteId === viewer.id &&
              program.createdById === viewer.id &&
              program.sourceType === "self" &&
              program.versionStatus === "published"
                ? () => {
                    setAssignmentSeed({ programId: program.id });
                    setModal("assign-program");
                  }
                : undefined
            }
            onRenameProgram={updateProgramTitle}
            onEditWorkout={() => setModal("workout-settings")}
            onSchedule={
              program.athleteId === viewer.id &&
              program.versionStatus === "published" &&
              (workspace.availableProgramIds ?? []).includes(program.id)
                ? () => openSchedule()
                : undefined
            }
          />
        )}
        {activeView === "program" &&
          !program &&
          (programOwnerId !== viewer.id &&
          selectedAthlete &&
          selectedAthlete.id === programOwnerId ? (
            <CoachProgramEmpty
              athlete={selectedAthlete}
              onCreate={() => {
                setProgramTarget({
                  id: selectedAthlete.id,
                  name: selectedAthlete.name,
                });
                setModal("program");
              }}
            />
          ) : (
            <ProgramsHome
              programs={programCatalog}
              schedules={workspace.scheduledWorkouts}
              availableIds={
                workspace.availableProgramIds ??
                availablePrograms.map((candidate) => candidate.id)
              }
              templates={workspace.programTemplates}
              source={programSource}
              hasCoach={hasCoach}
              activatingTemplateId={activatingTemplateId}
              action={programAction}
              onOpen={(targetProgram) => void openProgram(targetProgram)}
              onEdit={editProgram}
              onCopy={copyProgram}
              onDelete={deleteOwnProgram}
              onAvailability={setProgramAvailable}
              onSource={setProgramSource}
              onCreate={() => {
                setProgramTarget({
                  id: viewer.id,
                  name: workspace.profile.displayName,
                });
                setModal("program");
              }}
              onCreateWorkout={() => setModal("quick-workout")}
              onOpenTemplate={(template) =>
                handleTemplateAction(template, "open")
              }
              onCopyTemplate={(template) =>
                handleTemplateAction(template, "copy")
              }
              onScheduleTemplate={(template) =>
                void handleTemplateAction(template, "schedule")
              }
              onScheduleLibraryProgram={(targetProgram) => {
                void scheduleLibraryProgram(targetProgram);
              }}
              onSchedule={() => openSchedule()}
            />
          ))}
        {activeView === "calendar" && (
          <CalendarView
            sessions={workspace.completedSessions}
            schedules={workspace.scheduledWorkouts}
            weekStartsOnSunday={workspace.profile.weekStartsOnSunday}
            canSchedule={availablePrograms.some(
              (candidate) => candidate.versionStatus === "published",
            )}
            onNavigate={navigate}
            onSchedule={() => openSchedule()}
            onOpenPlan={openCalendarPlan}
            onOpenResults={openCalendarResults}
            onScheduleDay={(date) => openSchedule(undefined, date)}
            onMoveSchedule={(scheduleId, date) => {
              void saveSchedule(scheduleId, date);
            }}
            onDeleteSchedule={(scheduleId) => {
              void saveSchedule(scheduleId, null);
            }}
          />
        )}
        {activeView === "exercises" && (
          <ExercisesView
            scope={exerciseScope}
            query={exerciseQuery}
            global={workspace.globalExercises}
            personal={personalExercises}
            onScope={setExerciseScope}
            onQuery={setExerciseQuery}
            onAdd={() => setModal("exercise")}
            onDelete={(exercise) => {
              setExerciseDeleteTarget(exercise);
              setModal("delete-exercise");
            }}
          />
        )}
        {activeView === "coaching" && (
          <CoachingView
            mode={coachMode}
            coachConnections={workspace.coachConnections}
            pendingInvites={workspace.pendingCoachInvites}
            outgoingInvites={outgoingCoachInvites}
            athletes={workspace.coachedAthletes}
            selectedAthlete={selectedAthlete}
            openingProgramId={openingCoachProgramId}
            onMode={(nextMode) => void changeCoachMode(nextMode)}
            refreshing={coachingRefreshing}
            onRefresh={() => void refreshCoachWorkspace()}
            onInvite={() => setModal("invite")}
            respondingInvite={respondingInvite}
            cancellingInviteId={cancellingCoachInviteId}
            onRespondInvite={(invitation, response) =>
              void respondToCoachInvite(invitation, response)
            }
            onDisconnect={removeCoachAccess}
            onCancelInvite={(invitation) => void cancelCoachInvite(invitation)}
            onSelectAthlete={setSelectedAthlete}
            onOpenAssignedProgram={(athlete, assignedProgram, workoutId) =>
              void openAthleteProgram(athlete, assignedProgram, workoutId)
            }
            onOpenAgendaEntry={openCoachAgendaEntry}
            onAssignAthlete={(athlete) => {
              setAssignmentSeed({ athleteIds: [athlete.id] });
              setModal("assign-program");
            }}
          />
        )}
      </section>

      {modal === "exercise" && (
        <ExerciseModal
          onClose={() => setModal(null)}
          onSave={addPersonalExercise}
        />
      )}
      {modal === "delete-exercise" && exerciseDeleteTarget && (
        <DeleteExerciseModal
          exercise={exerciseDeleteTarget}
          onClose={() => {
            setExerciseDeleteTarget(null);
            setModal(null);
          }}
          onDelete={() => deletePersonalExercise(exerciseDeleteTarget)}
        />
      )}
      {modal === "workout" && (
        <WorkoutModal onClose={() => setModal(null)} onSave={addWorkout} />
      )}
      {modal === "workout-settings" && selectedWorkout && (
        <WorkoutSettingsModal
          workout={selectedWorkout}
          onClose={() => setModal(null)}
          onSave={updateWorkoutSettings}
        />
      )}
      {modal === "prescription" && prescriptionItem && (
        <PrescriptionModal
          item={prescriptionItem}
          weightUnit={workspace.profile.weightUnit}
          onClose={() => void cancelPrescription()}
          onSave={savePrescription}
        />
      )}
      {modal === "section" && (
        <SectionModal
          section={sectionEditing}
          onClose={() => {
            setSectionEditing(null);
            setModal(null);
          }}
          onSave={sectionEditing ? updateSection : addSection}
        />
      )}
      {modal === "delete-section" && sectionDeleteTarget && (
        <DeleteSectionModal
          section={sectionDeleteTarget}
          onClose={() => {
            setSectionDeleteTarget(null);
            setModal(null);
          }}
          onDelete={(deleteItems) =>
            deleteSection(sectionDeleteTarget.id, deleteItems)
          }
        />
      )}
      {modal === "invite" && (
        <InviteModal
          onClose={() => setModal(null)}
          onResolve={resolveCoachInvite}
          onInvite={createCoachInvite}
        />
      )}
      {modal === "assign-program" && (
        <AssignProgramModal
          programs={assignableOwnPrograms}
          athletes={workspace.coachedAthletes}
          initialProgramId={assignmentSeed.programId}
          initialAthleteIds={assignmentSeed.athleteIds}
          onClose={() => {
            setAssignmentSeed({});
            setModal(null);
          }}
          onAssign={assignProgramToAthletes}
          onAssignQuickWorkout={assignQuickWorkoutToAthletes}
        />
      )}
      {modal === "program" && (
        <ProgramModal
          targetName={programTarget?.name ?? workspace.profile.displayName}
          onClose={() => {
            setProgramTarget(null);
            setModal(null);
          }}
          onSave={createProgram}
        />
      )}
      {modal === "quick-workout" && (
        <ProgramModal
          targetName={workspace.profile.displayName}
          kind="workout"
          onClose={() => setModal(null)}
          onSave={createQuickWorkout}
        />
      )}
      {modal === "deactivate-program" && program && (
        <DeactivateProgramModal
          programTitle={program.title}
          onClose={() => setModal(null)}
          onConfirm={deactivateProgram}
        />
      )}
      {modal === "schedule" && (
        <ScheduleModal
          key={`${scheduleOpening ? "preparing" : "ready"}:${scheduleEditingId ?? "new"}:${scheduleInitialDate ?? "today"}`}
          schedules={workspace.scheduledWorkouts}
          editingId={scheduleEditingId}
          initialDate={scheduleInitialDate}
          preparing={scheduleOpening}
          onClose={() => {
            setScheduleEditingId(null);
            setScheduleInitialDate(null);
            setModal(null);
          }}
          onSave={saveSchedule}
        />
      )}
      {modal === "account" && (
        <AccountModal
          profile={workspace.profile}
          email={viewer.email}
          onClose={() => setModal(null)}
          onSave={saveProfile}
          onSignOut={onSignOut}
        />
      )}
      {toast && (
        <div className="toast">
          <Check size={16} />
          {toast}
        </div>
      )}
    </main>
  );
}

function Sidebar({
  activeView,
  onNavigate,
  viewer,
  profile,
  onAccount,
  onSignOut,
  onOpenTestPersonas,
  coachingRequestCount,
}: {
  activeView: ViewName;
  onNavigate: (view: ViewName) => void;
  viewer: AppViewer;
  profile: WorkspaceData["profile"];
  onAccount: () => void;
  onSignOut: () => void;
  onOpenTestPersonas?: () => void;
  coachingRequestCount: number;
}) {
  const profileInitials = getInitials(profile.displayName);
  return (
    <aside className="sidebar">
      <button className="brand" onClick={() => onNavigate("today")}>
        <span className="brand-mark">LL</span>
        <span>
          <strong>Lift Log</strong>
          <small>Training workspace</small>
        </span>
      </button>
      <nav className="main-nav" aria-label="Main navigation">
        {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={cn("nav-item", activeView === item.id && "active")}
                onClick={() => onNavigate(item.id)}
                aria-label={
                  item.id === "coaching" && coachingRequestCount > 0
                    ? `${item.label}, ${coachingRequestCount} pending ${coachingRequestCount === 1 ? "request" : "requests"}`
                    : item.label
                }
              >
                <Icon size={18} />
                <span className="nav-label-desktop">{item.label}</span>
                <span className="nav-label-mobile">{item.shortLabel}</span>
                {item.id === "coaching" && coachingRequestCount > 0 && (
                  <em aria-hidden="true">{coachingRequestCount}</em>
                )}
              </button>
            );
          })}
      </nav>
      <div className="sidebar-footer">
        {onOpenTestPersonas && (
          <button className="test-persona-open" onClick={onOpenTestPersonas}>
            <FlaskConical size={15} />
            Test accounts
          </button>
        )}
        <div className="profile-menu">
          <button
            className="profile-identity"
            onClick={onAccount}
            aria-label="Open my account settings"
          >
            <PersonAvatar initials={profileInitials} name={profile.displayName} />
            <span>
              <strong>{profile.displayName}</strong>
              <small>
                {viewer.isDemo
                  ? "Local demo workspace"
                  : viewer.isTest
                    ? "Test population"
                    : viewer.email}
              </small>
            </span>
          </button>
          <button
            className="profile-signout"
            onClick={onSignOut}
            aria-label={`Sign out ${profile.displayName}`}
            title="Sign out"
          >
            <LogOut size={17} />
          </button>
        </div>
      </div>
    </aside>
  );
}

function PageHeader({
  eyebrow,
  title,
  titleAction,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  titleAction?: React.ReactNode;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <div className="page-title-row">
          <h1>{title}</h1>
          {titleAction}
        </div>
        {description && <p>{description}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </header>
  );
}

function NextWorkoutsView({
  schedules,
  hasProgram,
  hasPublishedProgram,
  startingScheduleId,
  onNavigate,
  onSchedule,
  onStart,
  onOpen,
  onSetStatus,
  statusAction,
}: {
  schedules: ScheduledWorkout[];
  hasProgram: boolean;
  hasPublishedProgram: boolean;
  startingScheduleId: string | null;
  onNavigate: (view: ViewName) => void;
  onSchedule: () => void;
  onStart: (schedule: ScheduledWorkout) => void;
  onOpen: (schedule: ScheduledWorkout) => void;
  onSetStatus: (scheduleId: string, status: "planned" | "skipped") => void;
  statusAction: { id: string; status: "planned" | "skipped" } | null;
}) {
  if (schedules.length) {
    return (
      <>
        <PageHeader
          eyebrow="Your schedule"
          title="Next workouts"
          description="Every workout scheduled from today onward. Start any one whenever you are ready."
        >
          <button
            className="button secondary"
            onClick={() => onNavigate("calendar")}
          >
            <CalendarDays size={15} />
            Open calendar
          </button>
        </PageHeader>
        <section className="next-workouts-list" aria-label="Scheduled workouts">
          {schedules.map((schedule) => {
            const date = new Date(`${schedule.plannedDate}T12:00:00`);
            const dateLabel = date.toLocaleDateString("en", {
              weekday: "long",
              day: "numeric",
              month: "long",
            });
            return (
              <article className="panel next-workout-card" key={schedule.id}>
                <div className="next-workout-date">
                  <CalendarDays size={17} />
                  <div>
                    <small>{dateLabel}</small>
                    <strong>{schedule.plannedDate}</strong>
                  </div>
                </div>
                <button
                  className="next-workout-summary"
                  onClick={() => onOpen(schedule)}
                >
                  <SourceTag source={sourceFromScheduledWorkout(schedule)} compact />
                  <p>{schedule.programTitle}</p>
                  <h2>{schedule.workoutTitle}</h2>
                  <small>
                    {schedule.workout.dayLabel} · {formatDuration(schedule.workout.durationMinutes)}
                  </small>
                </button>
                {schedule.status === "skipped" ? (
                  <AsyncButton
                    className="button secondary"
                    loading={statusAction?.id === schedule.id}
                    loadingLabel="Restoring…"
                    onClick={() => onSetStatus(schedule.id, "planned")}
                  >
                    Set back to planned
                  </AsyncButton>
                ) : (
                  <AsyncButton
                    className="button primary"
                    loading={startingScheduleId === schedule.id}
                    loadingLabel="Starting workout…"
                    icon={Activity}
                    onClick={() => onStart(schedule)}
                  >
                    Start workout
                  </AsyncButton>
                )}
              </article>
            );
          })}
        </section>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Next workouts"
        title="No future workouts scheduled"
        description={
          hasProgram
            ? "Your program and calendar are separate—you decide when each workout happens."
            : "Start only when you choose a program or create one of your own."
        }
      />
      <div className="panel empty-state today-empty">
        <CalendarDays size={28} />
        <h3>
          {hasProgram
            ? "Choose a training date"
            : "No training has been added"}
        </h3>
        <p>
          {hasProgram
            ? hasPublishedProgram
              ? "Schedule workouts for any date. Your upcoming calendar sessions will appear here."
              : "Finish and publish your program before placing workouts on the calendar."
            : "Browse the collapsed program library or build a plan from scratch."}
        </p>
        <div className="empty-actions">
          {hasPublishedProgram && (
            <button className="button primary" onClick={onSchedule}>
              <CalendarPlus size={15} />
              Schedule a workout
            </button>
          )}
          <button
            className="button secondary"
            onClick={() => onNavigate("program")}
          >
            <Dumbbell size={15} />
            {hasProgram ? "Open program" : "Choose a program"}
          </button>
        </div>
      </div>
    </>
  );
}

function TodayView({
  program,
  workout,
  weightUnit,
  timing,
  plannedDate,
  workoutStarted,
  workoutComplete,
  workoutAction,
  setLogs,
  resultLogs,
  sessionRpe,
  sessionNote,
  onStart,
  onFinish,
  onReset,
  onUpdateSet,
  onAddSet,
  onRemoveSet,
  onUpdateResult,
  onSessionRpe,
  onSessionNote,
  onSetPlanned,
  onSkip,
  statusAction,
  viewMode,
  onBack,
  backLabel = "Next workouts",
  onReschedule,
  onRemoveFromCalendar,
  onNavigate,
}: {
  program?: Program;
  workout: PlannedWorkout;
  weightUnit: OwnProfile["weightUnit"];
  timing: "active" | "overdue" | "today" | "future";
  plannedDate?: string;
  workoutStarted: boolean;
  workoutComplete: boolean;
  workoutAction: "starting" | "finishing" | null;
  setLogs: Record<string, SetLog[]>;
  resultLogs: Record<string, Record<string, string>>;
  sessionRpe: string;
  sessionNote: string;
  onStart: () => void;
  onFinish: () => void;
  onReset: () => void;
  onUpdateSet: (
    itemId: string,
    index: number,
    field: keyof SetLog,
    value: string,
  ) => void;
  onAddSet: (itemId: string) => void;
  onRemoveSet: (itemId: string, index: number) => void;
  onUpdateResult: (itemId: string, field: string, value: string) => void;
  onSessionRpe: (value: string) => void;
  onSessionNote: (value: string) => void;
  onSetPlanned?: () => void;
  onSkip?: () => void;
  statusAction: "planned" | "skipped" | null;
  viewMode: boolean;
  onBack?: () => void;
  backLabel?: string;
  onReschedule?: () => void;
  onRemoveFromCalendar?: () => void;
  onNavigate: (view: ViewName) => void;
}) {
  const workoutDate = plannedDate
    ? new Date(`${plannedDate}T12:00:00`)
    : new Date();
  const dateLabel = workoutDate.toLocaleDateString("en", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const workoutBelongsToProgram =
    !workout.programVersionId ||
    workout.programVersionId === program?.versionId;
  const workoutWeek = workoutBelongsToProgram
    ? program?.weeks.find((week) =>
        week.workouts.some((item) => item.id === workout.id),
      )
    : undefined;
  const workoutIndex =
    workoutWeek?.workouts.findIndex((item) => item.id === workout.id) ?? -1;
  const planDescription = workoutWeek
    ? `Week ${workoutWeek.index} of ${program?.title} · ${program?.phase} phase`
    : workoutBelongsToProgram && program
      ? `${workout.dayLabel} · scheduled workout`
      : `${workout.dayLabel} · scheduled from an earlier plan version`;
  const timingLabel =
    timing === "active"
      ? plannedDate
        ? `Workout in progress · ${dateLabel}`
        : "Workout in progress"
      : timing === "overdue"
        ? `Overdue · originally scheduled ${dateLabel}`
        : timing === "today"
          ? "Next workout · Today"
          : `Next workout · ${dateLabel}`;
  return (
    <>
      <PageHeader
        eyebrow={viewMode ? `Workout preview · ${dateLabel}` : timingLabel}
        title={
          workoutComplete
            ? "Session complete"
            : timing === "active"
              ? "Workout in progress"
              : viewMode
                ? "Workout preview"
                : "Next workout"
        }
        description={planDescription}
      >
        {program && <SourceTag source={sourceFromProgram(program)} />}
        {onBack && (
          <button className="button secondary" onClick={onBack}>
            <ArrowLeft size={15} />
            {backLabel}
          </button>
        )}
        {viewMode && onReschedule && (
          <button
            className="icon-button"
            onClick={onReschedule}
            aria-label="Reschedule workout"
            title="Reschedule"
          >
            <CalendarPlus size={15} />
          </button>
        )}
        {viewMode && onRemoveFromCalendar && (
          <button
            className="icon-button danger"
            onClick={onRemoveFromCalendar}
            aria-label="Remove workout from calendar"
            title="Remove from calendar"
          >
            <X size={15} />
          </button>
        )}
        {workoutStarted && onSetPlanned && onSkip && (
          <>
            <button
              className="button secondary"
              disabled={statusAction !== null}
              onClick={onSetPlanned}
            >
              {statusAction === "planned" ? (
                <>
                  <LoaderCircle className="button-spinner" size={15} />
                  Restoring…
                </>
              ) : (
                "Set back to planned"
              )}
            </button>
            <button
              className="button danger"
              disabled={statusAction !== null}
              onClick={onSkip}
            >
              {statusAction === "skipped" ? (
                <>
                  <LoaderCircle className="button-spinner" size={15} />
                  Skipping…
                </>
              ) : (
                "Skip workout"
              )}
            </button>
          </>
        )}
        {viewMode && onSkip && (
          <button
            className="button danger"
            disabled={statusAction !== null}
            onClick={onSkip}
          >
            {statusAction === "skipped" ? (
              <>
                <LoaderCircle className="button-spinner" size={15} />
                Skipping…
              </>
            ) : (
              "Skip workout"
            )}
          </button>
        )}
        <button
          className="button secondary"
          onClick={() => onNavigate("program")}
        >
          <Pencil size={15} />
          Edit plan
        </button>
      </PageHeader>
      {workoutComplete && (
        <div className="success-banner">
          <span>
            <Check size={20} />
          </span>
          <div>
            <strong>Nice work. Your session is logged.</strong>
            <p>
              RPE {sessionRpe} · {workout.durationMinutes} planned minutes
            </p>
          </div>
          <button className="button ghost" onClick={onReset}>
            View again
          </button>
        </div>
      )}
      <div className="today-layout">
        <article className="workout-card">
          <div className="workout-heading">
            <div>
              <p className="eyebrow">
                {workoutWeek
                  ? `Session ${workoutIndex + 1} of ${workoutWeek.workouts.length}`
                  : "Scheduled session"}
              </p>
              <h2>{workout.title}</h2>
              <p>
                {workout.dayLabel} · follow the prescription and adjust to how
                you feel on the day.
              </p>
            </div>
            <span className="time-pill">
              <Clock3 size={14} />~ {workout.durationMinutes} min
            </span>
          </div>
          {workout.sections.map((section) => (
            <section className="workout-section" key={section.id}>
              <WorkoutSectionHeading title={section.title} itemCount={section.items.length} />
              {section.items.map((item) => (
                <WorkoutLogItem
                  key={item.id}
                  item={item}
                  active={workoutStarted}
                  weightUnit={weightUnit}
                  setLogs={setLogs[item.id] ?? []}
                  resultLog={resultLogs[item.id] ?? {}}
                  onUpdateSet={onUpdateSet}
                  onAddSet={onAddSet}
                  onRemoveSet={onRemoveSet}
                  onUpdateResult={onUpdateResult}
                />
              ))}
            </section>
          ))}
          {!workoutStarted && !workoutComplete && (
            <AsyncButton
              className="button primary full"
              loading={workoutAction === "starting"}
              loadingLabel="Starting workout…"
              icon={Activity}
              onClick={onStart}
            >
              Start workout
            </AsyncButton>
          )}
          {workoutStarted && (
            <div className="session-finish">
              <label>
                <span>Session RPE</span>
                <small>How did the whole session feel?</small>
                <RpeChoiceButtons value={sessionRpe} onChange={onSessionRpe} />
              </label>
              <RpeLegend />
              <label>
                <span>
                  Session notes <em>optional</em>
                </span>
                <textarea
                  value={sessionNote}
                  onChange={(event) => onSessionNote(event.target.value)}
                  placeholder="What felt good? Anything to adjust next time?"
                />
              </label>
              <AsyncButton
                className="button primary full"
                loading={workoutAction === "finishing"}
                loadingLabel="Finishing session…"
                icon={Check}
                onClick={onFinish}
              >
                Finish and save session
              </AsyncButton>
            </div>
          )}
        </article>
      </div>
    </>
  );
}

const rpeOptions = [
  { value: "5", label: "Light", detail: "5+ reps left" },
  { value: "6", label: "Easy", detail: "about 4 reps left" },
  { value: "7", label: "Moderate", detail: "about 3 reps left" },
  { value: "8", label: "Hard", detail: "about 2 reps left" },
  { value: "9", label: "Very hard", detail: "about 1 rep left" },
  { value: "10", label: "Max", detail: "no reps left" },
] as const;

function rpeOption(value: string) {
  return rpeOptions.find((option) => option.value === value);
}

function wholeRpe(value: string) {
  const values = value
    .split(/[–-]/)
    .map((part) => Number(part.trim()))
    .filter((part) => Number.isFinite(part));
  const selected = values.at(-1);
  return selected && selected >= 5 && selected <= 10 ? String(selected) : "";
}

function rpeTone(value: string) {
  const rpe = Number(wholeRpe(value));
  if (rpe <= 6) return "easy";
  if (rpe === 7) return "moderate";
  if (rpe === 8) return "hard";
  return "very-hard";
}

function RpeLegend() {
  return (
    <details className="rpe-legend">
      <summary><Gauge size={14} /> RPE guide</summary>
      <div>
        {rpeOptions.map((option) => (
          <span key={option.value}>
            <strong>{option.value}</strong>
            <b>{option.label}</b>
            <small>{option.detail}</small>
          </span>
        ))}
      </div>
    </details>
  );
}

function RpeChoiceButtons({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="rpe-selector" aria-label="Select session RPE">
      {rpeOptions.map((option) => (
        <button
          type="button"
          key={option.value}
          className={cn(value === option.value && "selected", `rpe-${rpeTone(option.value)}`)}
          onClick={() => onChange(option.value)}
          aria-label={`RPE ${option.value}: ${option.label}, ${option.detail}`}
        >
          <strong>{option.value}</strong>
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

const plannedRpeOptions = [
  { value: "", label: "No planned effort", detail: "Athlete chooses effort" },
  { value: "6", label: "Easy", detail: "about 4 reps left" },
  { value: "7", label: "Moderate", detail: "about 3 reps left" },
  { value: "8", label: "Hard", detail: "about 2 reps left" },
  { value: "9", label: "Very hard", detail: "about 1 rep left" },
  { value: "10", label: "Max", detail: "no reps left" },
] as const;

function PlannedRpeSelect({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = plannedRpeOptions.find((option) => option.value === value);
  return (
    <div className="planned-rpe-select rpe-select">
      <button
        type="button"
        disabled={disabled}
        className={cn("rpe-select-trigger", value && "selected", value && `rpe-${rpeTone(value)}`)}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
      >
        <Gauge size={13} />
        <span>
          {current?.value ? `${current.value} · ${current.label}` : "No planned effort"}
        </span>
        <ChevronDown size={12} />
      </button>
      {open && !disabled && (
        <div className="rpe-select-menu" role="listbox" aria-label="Planned effort">
          {plannedRpeOptions.map((option) => (
            <button
              type="button"
              key={option.value || "none"}
              role="option"
              aria-selected={value === option.value}
              className={cn(value === option.value && "selected", option.value && `rpe-${rpeTone(option.value)}`)}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <Gauge size={13} />
              <strong>{option.value || "—"}</strong>
              <span>
                <b>{option.label}</b>
                <small>{option.detail}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RpeSelect({
  disabled,
  value,
  onChange,
}: {
  disabled: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = rpeOption(value);
  return (
    <div className="rpe-select">
      <button
        type="button"
        disabled={disabled}
        className={cn("rpe-select-trigger", value && "selected", value && `rpe-${rpeTone(value)}`)}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
      >
        <Gauge size={13} />
        <span>{current ? current.value : "—"}</span>
        <ChevronDown size={12} />
      </button>
      {open && !disabled && (
        <div className="rpe-select-menu" role="listbox" aria-label="Actual RPE">
          {rpeOptions.map((option) => (
            <button
              type="button"
              key={option.value}
              role="option"
              aria-selected={value === option.value}
              className={cn(value === option.value && "selected", `rpe-${rpeTone(option.value)}`)}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <Gauge size={13} />
              <strong>{option.value}</strong>
              <span>
                <b>{option.label}</b>
                <small>{option.detail}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TargetRpeBadge({ value }: { value: string }) {
  const normalizedValue = wholeRpe(value) || value;
  return (
    <span className="target-rpe-badge">
      <Gauge size={13} />
      <small>Target</small>
      <strong className={`rpe-${rpeTone(normalizedValue)}`}>RPE {normalizedValue}</strong>
    </span>
  );
}

function workoutLogFields(mode: EntryMode): TrackingField[] {
  if (mode === "sets") return ["reps", "load", "rpe"];
  if (mode === "intervals")
    return ["rounds", "duration", "distance", "heartRate", "rpe"];
  if (mode === "result") return ["duration", "distance", "heartRate", "rpe"];
  return [];
}

function WorkoutLogItem({
  item,
  active,
  weightUnit = "kg",
  showSetControls = true,
  builderPreview = false,
  setLogs,
  resultLog,
  onUpdateSet,
  onAddSet,
  onRemoveSet,
  onUpdateResult,
}: {
  item: WorkoutItem;
  active: boolean;
  weightUnit?: OwnProfile["weightUnit"];
  showSetControls?: boolean;
  builderPreview?: boolean;
  setLogs: SetLog[];
  resultLog: Record<string, string>;
  onUpdateSet: (
    itemId: string,
    index: number,
    field: keyof SetLog,
    value: string,
  ) => void;
  onAddSet: (itemId: string) => void;
  onRemoveSet: (itemId: string, index: number) => void;
  onUpdateResult: (itemId: string, field: string, value: string) => void;
}) {
  const note = item.cue || item.prescription.targetText || "";
  const fields = workoutLogFields(item.mode);
  const plannedRpeVaries = prescriptionEntryVaries(item, "targetRpe");
  const prescriptionSummary = (
    <div className="exercise-prescription">
      <span>{prescriptionLabel(item, weightUnit)}</span>
      {plannedRpeVaries ? (
        <span className="per-entry-rpe">Planned RPE per {item.mode === "intervals" ? "round" : "set"}</span>
      ) : item.prescription.targetRpe ? (
        <TargetRpeBadge value={item.prescription.targetRpe} />
      ) : null}
    </div>
  );
  if (item.mode === "none")
    return (
      <div className="instruction-item">
        <span className="instruction-dot" />
        <div>
          <strong>{item.title}</strong>
          <small>{note}</small>
        </div>
      </div>
    );
  return (
      <div className="log-item">
      <div className={cn("exercise-heading", builderPreview && "builder-exercise-heading")}>
        <div className={builderPreview ? "builder-exercise-title" : undefined}>
          {builderPreview ? (
            <div className="builder-exercise-title-row">
              <strong>{item.title}</strong>
              {prescriptionSummary}
            </div>
          ) : (
            <strong>{item.title}</strong>
          )}
          <small>{note}</small>
        </div>
        {!builderPreview && prescriptionSummary}
      </div>
      {item.mode === "sets" && (
        <div className={cn("set-table", `tracking-${fields.length}`)}>
          <div className="set-header">
            <span>Set</span>
            {fields.includes("reps") && <span>Reps</span>}
            {fields.includes("load") && <span>Load {weightUnit}</span>}
            {fields.includes("rpe") && <span>Actual RPE</span>}
            <span />
          </div>
          {setLogs.map((row, index) => (
            <div className="set-row" key={index}>
              <span>{index + 1}</span>
              {fields.includes("reps") && (
                <input
                  disabled={!active}
                  inputMode="numeric"
                  value={row.reps}
                  onChange={(event) =>
                    onUpdateSet(item.id, index, "reps", event.target.value)
                  }
                  placeholder="—"
                />
              )}
              {fields.includes("load") && (
                <input
                  disabled={!active}
                  inputMode="decimal"
                  value={weightInputValue(row.load, weightUnit)}
                  onChange={(event) =>
                    onUpdateSet(
                      item.id,
                      index,
                      "load",
                      weightKgValue(event.target.value, weightUnit),
                    )
                  }
                  placeholder="—"
                />
              )}
              {fields.includes("rpe") && (
                <RpeSelect
                  disabled={!active}
                  value={row.rpe}
                  onChange={(value) => onUpdateSet(item.id, index, "rpe", value)}
                />
              )}
              {showSetControls ? (
                <button
                  disabled={!active || setLogs.length === 1}
                  aria-label={`Remove set ${index + 1}`}
                  onClick={() => onRemoveSet(item.id, index)}
                >
                  <X size={14} />
                </button>
              ) : (
                <span aria-hidden />
              )}
            </div>
          ))}
          {active && showSetControls && (
            <button className="add-row" onClick={() => onAddSet(item.id)}>
              <Plus size={14} />
              Add set
            </button>
          )}
        </div>
      )}
      {(item.mode === "result" || item.mode === "intervals") && (
        <div className="result-fields">
          {item.mode === "intervals" && fields.includes("rounds") && (
            <ResultInput
              label="Rounds"
              unit="rounds"
              disabled={!active}
              value={resultLog.rounds ?? ""}
              onChange={(value) => onUpdateResult(item.id, "rounds", value)}
            />
          )}
          {fields.includes("duration") && (
            <ResultInput
              label="Duration"
              unit="min"
              disabled={!active}
              value={resultLog.duration ?? ""}
              onChange={(value) => onUpdateResult(item.id, "duration", value)}
            />
          )}
          {fields.includes("distance") && (
            <ResultInput
              label="Distance"
              unit="km"
              disabled={!active}
              value={resultLog.distance ?? ""}
              onChange={(value) => onUpdateResult(item.id, "distance", value)}
            />
          )}
          {fields.includes("heartRate") && (
            <ResultInput
              label="Avg HR"
              unit="bpm"
              disabled={!active}
              value={resultLog.heartRate ?? ""}
              onChange={(value) => onUpdateResult(item.id, "heartRate", value)}
            />
          )}
          {fields.includes("rpe") && (
            <RpeResultInput
              label="Actual RPE"
              disabled={!active}
              value={resultLog.rpe ?? ""}
              onChange={(value) =>
                onUpdateResult(item.id, "rpe", value)
              }
            />
          )}
        </div>
      )}
    </div>
  );
}

function RpeResultInput({
  label,
  disabled,
  value,
  onChange,
}: {
  label: string;
  disabled: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="result-input rpe-result-input">
      <span>{label}</span>
      <RpeSelect disabled={disabled} value={value} onChange={onChange} />
    </label>
  );
}

function ResultInput({
  label,
  unit,
  disabled,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  disabled: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="result-input">
      <span>{label}</span>
      <div>
        <input
          disabled={disabled}
          inputMode="decimal"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="—"
        />
        <small>{unit}</small>
      </div>
    </label>
  );
}

function ProgramView({
  program,
  action,
  mutationPending,
  viewerId,
  weightUnit,
  isAvailable,
  currentWeek,
  selectedWeek,
  selectedWorkout,
  selectedSectionId,
  exercises,
  onSelectWeek,
  onSelectWorkout,
  onSelectSection,
  onAddBlankWeek,
  onCopyWeek,
  onDeleteWeek,
  onAddWorkout,
  onDeleteWorkout,
  onReorderWorkouts,
  onAddSection,
  onEditSection,
  onDeleteSection,
  onReorderSections,
  onAddExercise,
  onEditItem,
  onRemoveItem,
  onMoveItem,
  onSave,
  onCreateDraft,
  onBack,
  onAssignProgram,
  onRenameProgram,
  onEditWorkout,
  onSchedule,
}: {
  program: Program;
  action: Exclude<ProgramAction, null>["kind"] | null;
  mutationPending: boolean;
  viewerId: string;
  weightUnit: OwnProfile["weightUnit"];
  isAvailable: boolean;
  currentWeek: Program["weeks"][number];
  selectedWeek: number;
  selectedWorkout?: PlannedWorkout;
  selectedSectionId: string;
  exercises: Exercise[];
  onSelectWeek: (week: number) => void;
  onSelectWorkout: (id: string) => void;
  onSelectSection: (id: string) => void;
  onAddBlankWeek: () => Promise<boolean>;
  onCopyWeek: (count: number) => Promise<boolean>;
  onDeleteWeek: () => void;
  onAddWorkout: () => void;
  onDeleteWorkout: () => void;
  onReorderWorkouts: (ids: string[]) => void;
  onAddSection: () => void;
  onEditSection: (section: WorkoutSection) => void;
  onDeleteSection: (section: WorkoutSection) => void;
  onReorderSections: (ids: string[]) => void;
  onAddExercise: (exercise: Exercise, sectionId?: string) => void;
  onEditItem: (item: WorkoutItem) => void;
  onRemoveItem: (id: string) => void;
  onMoveItem: (
    itemId: string,
    destinationSectionId: string,
    destinationPosition: number,
  ) => void;
  onSave: (description: string) => void;
  onCreateDraft: () => void;
  onBack: () => void;
  onAssignProgram?: () => void;
  onRenameProgram: (title: string) => Promise<void>;
  onEditWorkout: () => void;
  onSchedule?: () => void;
}) {
  const [pickerQuery, setPickerQuery] = useState("");
  const [description, setDescription] = useState(program.description);
  const [renamingProgram, setRenamingProgram] = useState(false);
  const [localWeekAction, setLocalWeekAction] = useState<
    "blank" | "copy" | null
  >(null);
  const localWeekActionRef = useRef(false);
  const dragSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 7 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 220, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const isDraft = program.versionStatus === "draft";
  const isQuickWorkout = program.contentType === "quick_workout";
  const canEdit =
    program.createdById === viewerId && program.sourceType !== "library";
  const editable = isDraft && canEdit;
  const additionalWeekCapacity = Math.max(0, 52 - program.weeks.length);
  const dragEnabled = editable && !mutationPending;
  const pickerResults = exercises
    .filter((exercise) =>
      exercise.name.toLowerCase().includes(pickerQuery.toLowerCase()),
    )
    .slice(0, 6);
  const targetSection =
    selectedWorkout?.sections.find(
      (section) => section.id === selectedSectionId,
    ) ?? selectedWorkout?.sections[0];
  function finishWorkoutDrag(event: DragEndEvent) {
    if (mutationPending) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = currentWeek.workouts.map((item) => item.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from >= 0 && to >= 0) onReorderWorkouts(arrayMove(ids, from, to));
  }

  function finishBuilderDrag(event: DragEndEvent) {
    if (mutationPending || !selectedWorkout || !event.over) return;
    const activeData = event.active.data.current;
    const overData = event.over.data.current;
    if (activeData?.type === "library-exercise") {
      const destinationSectionId = String(overData?.sectionId ?? "");
      if (
        !selectedWorkout.sections.some(
          (section) => section.id === destinationSectionId,
        )
      )
        return;
      const exercise = exercises.find(
        (candidate) => candidate.id === String(activeData.exerciseId),
      );
      if (!exercise) return;
      onSelectSection(destinationSectionId);
      onAddExercise(exercise, destinationSectionId);
      return;
    }
    if (activeData?.type === "section") {
      const sectionIds = selectedWorkout.sections.map((section) => section.id);
      const targetSectionId = String(overData?.sectionId ?? "");
      const from = sectionIds.indexOf(String(activeData.sectionId));
      const to = sectionIds.indexOf(targetSectionId);
      if (from >= 0 && to >= 0 && from !== to)
        onReorderSections(arrayMove(sectionIds, from, to));
      return;
    }
    if (activeData?.type !== "item") return;
    const destinationSectionId = String(overData?.sectionId ?? "");
    const destinationSection = selectedWorkout.sections.find(
      (section) => section.id === destinationSectionId,
    );
    if (!destinationSection) return;
    const itemId = String(activeData.itemId);
    const sourceSectionId = String(activeData.sectionId);
    const destinationIds = destinationSection.items
      .map((item) => item.id)
      .filter((id) => id !== itemId);
    const overItemId =
      overData?.type === "item" ? String(overData.itemId) : null;
    let destinationPosition = overItemId
      ? destinationIds.indexOf(overItemId)
      : destinationIds.length;
    if (destinationPosition < 0) destinationPosition = destinationIds.length;
    if (sourceSectionId === destinationSectionId) {
      const originalIds = destinationSection.items.map((item) => item.id);
      const from = originalIds.indexOf(itemId);
      const overIndex = overItemId ? originalIds.indexOf(overItemId) : -1;
      if (from >= 0 && overIndex >= 0) destinationPosition = overIndex;
      if (from === destinationPosition) return;
    }
    onMoveItem(itemId, destinationSectionId, destinationPosition);
    onSelectSection(destinationSectionId);
  }

  async function runWeekAction(
    kind: "blank" | "copy",
    mutation: () => Promise<boolean>,
  ) {
    if (localWeekActionRef.current || action) return;
    localWeekActionRef.current = true;
    setLocalWeekAction(kind);
    try {
      const completed = await mutation();
    } finally {
      localWeekActionRef.current = false;
      setLocalWeekAction(null);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow={
          program.athleteId === viewerId
            ? isQuickWorkout
              ? "Your workout"
              : "Your program"
            : `Planning for ${program.ownerName}`
        }
        title={isQuickWorkout ? selectedWorkout?.title ?? program.title : program.title}
        titleAction={
          editable ? (
            <button
              className="title-edit-button"
              onClick={
                isQuickWorkout
                  ? onEditWorkout
                  : () => setRenamingProgram(true)
              }
              aria-label={`Rename ${isQuickWorkout ? "workout" : "program"}`}
              title={`Rename ${isQuickWorkout ? "workout" : "program"}`}
            >
              <Pencil size={16} />
            </button>
          ) : undefined
        }
        description={
          program.description ||
          (isQuickWorkout
            ? "One session you can schedule for yourself or assign to athletes."
            : "A finite sequence of weeks. The athlete assigns workouts to calendar dates separately.")
        }
      >
        <button className="button secondary small" onClick={onBack}>
          <ArrowLeft size={15} />
          All programs
        </button>
        <SourceTag source={sourceFromProgram(program)} />
        <StatusBadge
          status={isDraft ? "draft" : isAvailable ? "in_schedule" : "ready"}
        />
        {onSchedule && (
          <button className="button secondary small" onClick={onSchedule}>
            <CalendarPlus size={15} />
            Schedule
          </button>
        )}
        {onAssignProgram && (
          <button
            className="button secondary small"
            disabled={Boolean(action)}
            onClick={onAssignProgram}
          >
            <UserPlus size={15} />
            Assign to athletes
          </button>
        )}
        {editable ? (
          <button
            className="button primary small"
            disabled={Boolean(action)}
            onClick={() => onSave(description)}
          >
            {action === "publish" ? (
              <>
                <LoaderCircle className="button-spinner" size={15} />
                Saving…
              </>
            ) : (
              <>
                <Save size={15} />
                {isQuickWorkout ? "Save workout" : "Save program"}
              </>
            )}
          </button>
        ) : (
          !isDraft &&
          canEdit && (
            <button
              className="button primary small"
              disabled={Boolean(action)}
              onClick={onCreateDraft}
            >
              {action === "edit" ? (
                <>
                  <LoaderCircle className="button-spinner" size={15} />
                  Opening…
                </>
              ) : (
                <>
                  <Pencil size={15} />
                  {isQuickWorkout ? "Edit workout" : "Edit program"}
                </>
              )}
            </button>
          )
        )}
      </PageHeader>
      <div className="program-summary panel">
        <div>
          <span className="program-icon">
            {isQuickWorkout ? <Activity size={21} /> : <Layers3 size={21} />}
          </span>
          <div>
            <strong>
              {isQuickWorkout
                ? "Quick workout"
                : `${program.weeks.length}-week program`}
            </strong>
            <small>
              {isQuickWorkout
                ? "One session you can schedule or assign."
                : "Runs once from first week to last"}
            </small>
          </div>
          {editable && (
            <label className="program-description-field">
              <span>
                Description <em>optional</em>
              </span>
              <input
                value={description}
                placeholder="What is this program for?"
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
          )}
        </div>
        {!isQuickWorkout && editable && program.weeks.length > 1 && (
          <button className="button danger small" onClick={onDeleteWeek}>
            <Trash2 size={14} />
            Delete week {selectedWeek}
          </button>
        )}
      </div>
      {!isQuickWorkout && <div className="week-tabs">
        <button
          className="icon-button"
          aria-label="Previous program week"
          onClick={() => onSelectWeek(Math.max(1, selectedWeek - 1))}
          disabled={selectedWeek === 1}
        >
          <ArrowLeft size={16} />
        </button>
        <div>
          {program.weeks.map((week) => (
            <button
              key={week.index}
              className={selectedWeek === week.index ? "active" : ""}
              onClick={() => onSelectWeek(week.index)}
            >
              <small>Week</small>
              <strong>{week.index}</strong>
            </button>
          ))}
          {editable && (
            <>
              <button
                className="week-add"
                disabled={Boolean(action) || additionalWeekCapacity === 0}
                onClick={() => void runWeekAction("blank", onAddBlankWeek)}
                title="Add blank week"
                aria-label="Add blank week"
              >
                {localWeekAction === "blank" ? (
                  <LoaderCircle className="button-spinner" size={17} />
                ) : (
                  <Plus size={18} />
                )}
              </button>
              <button
                className="week-add"
                disabled={
                  !currentWeek.workouts.length ||
                  Boolean(action) ||
                  additionalWeekCapacity === 0
                }
                onClick={() => void runWeekAction("copy", () => onCopyWeek(1))}
                title={`Duplicate Week ${selectedWeek}`}
                aria-label={`Duplicate Week ${selectedWeek}`}
              >
                {localWeekAction === "copy" ? (
                  <LoaderCircle className="button-spinner" size={17} />
                ) : (
                  <Copy size={17} />
                )}
              </button>
            </>
          )}
        </div>
        <button
          className="icon-button"
          aria-label="Next program week"
          onClick={() =>
            onSelectWeek(Math.min(program.weeks.length, selectedWeek + 1))
          }
          disabled={selectedWeek === program.weeks.length}
        >
          <ArrowRight size={16} />
        </button>
      </div>}
      <div className="builder-layout">
        <aside className="workout-list panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">
                {isQuickWorkout ? "Quick workout" : `Week ${selectedWeek}`}
              </p>
              <h3>{isQuickWorkout ? "Session" : currentWeek.label}</h3>
            </div>
          </div>
          <DndContext
            sensors={dragSensors}
            collisionDetection={closestCenter}
            onDragEnd={finishWorkoutDrag}
          >
            <SortableContext
              items={currentWeek.workouts.map((workout) => workout.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="workout-list-items">
                {currentWeek.workouts.map((workout, index) => (
                  <SortableWorkoutRow
                    key={workout.id}
                    workout={workout}
                    index={index}
                    selected={selectedWorkout?.id === workout.id}
                    editable={dragEnabled}
                    onSelect={() => onSelectWorkout(workout.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
          {!isQuickWorkout && <button
            className="button secondary full"
            disabled={!editable}
            onClick={onAddWorkout}
          >
            <Plus size={15} />
            Add workout
          </button>}
        </aside>
        <DndContext
          sensors={dragSensors}
          collisionDetection={closestCenter}
          onDragEnd={finishBuilderDrag}
        >
          <section className="builder-editor panel" aria-busy={mutationPending}>
            {selectedWorkout ? (
              <>
                <div className="editor-heading">
                  <div>
                    <div className="editor-title-row">
                      <h2>{selectedWorkout.title}</h2>
                      {editable && (
                        <button
                          className="title-edit-button"
                          onClick={onEditWorkout}
                          aria-label="Rename workout"
                          title="Rename workout"
                        >
                          <Pencil size={14} />
                        </button>
                      )}
                    </div>
                    <p>Estimated {selectedWorkout.durationMinutes} minutes</p>
                  </div>
                  <div className="editor-actions">
                    {editable && !isQuickWorkout && (
                      <button
                        className="icon-button danger"
                        onClick={onDeleteWorkout}
                        aria-label="Delete workout"
                      >
                        <Trash2 size={17} />
                      </button>
                    )}
                  </div>
                </div>
                {editable ? (
                  <SortableContext
                    items={selectedWorkout.sections.map(
                      (section) => `section:${section.id}`,
                    )}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="builder-section-list">
                      {selectedWorkout.sections.map((section) => (
                        <SortableBuilderSection
                          key={section.id}
                          section={section}
                          selected={targetSection?.id === section.id}
                          editable={editable}
                          dragEnabled={dragEnabled}
                          weightUnit={weightUnit}
                          canDelete={section.kind !== "main"}
                          onSelect={() => onSelectSection(section.id)}
                          onEdit={() => onEditSection(section)}
                          onDelete={() => onDeleteSection(section)}
                          onEditItem={onEditItem}
                          onRemoveItem={onRemoveItem}
                        />
                      ))}
                    </div>
                  </SortableContext>
                ) : (
                  <ProgramWorkoutDetails
                    workout={selectedWorkout}
                    weightUnit={weightUnit}
                  />
                )}
                {editable && (
                  <button
                    className="button secondary add-section-button"
                    onClick={onAddSection}
                  >
                    <Plus size={15} />
                    Add section
                  </button>
                )}
              </>
            ) : (
              <div className="empty-state">
                <Dumbbell size={28} />
                <h3>Select a workout</h3>
                <p>Choose a session from the left to start editing.</p>
              </div>
            )}
          </section>
          {editable && (
            <aside className="exercise-picker panel" aria-busy={mutationPending}>
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Exercise library</p>
                <h3>
                  {`Add to ${targetSection?.title ?? "section"}`}
                </h3>
              </div>
            </div>
            {selectedWorkout?.sections.length ? (
              <>
                <label className="search-field">
                  <Search size={16} />
                  <input
                    value={pickerQuery}
                    onChange={(event) => setPickerQuery(event.target.value)}
                    placeholder="Search exercises"
                  />
                </label>
                <div className="picker-results">
                  {pickerResults.map((exercise) => (
                    <DraggableExercisePickerRow
                      key={exercise.id}
                      exercise={exercise}
                      disabled={!dragEnabled}
                      onAdd={() => onAddExercise(exercise)}
                    />
                  ))}
                </div>
                <small className="picker-help">
                  Drag an exercise straight into any section, or click it to add
                  it to the selected section. Then prescribe sets, weight or
                  time.
                </small>
              </>
            ) : (
              <div className="empty-inline">
                Add a workout section first.
              </div>
            )}
            </aside>
          )}
        </DndContext>
      </div>
      {renamingProgram && !isQuickWorkout && (
        <RenameProgramModal
          label="program"
          title={program.title}
          onClose={() => setRenamingProgram(false)}
          onSave={async (title) => {
            await onRenameProgram(title);
            setRenamingProgram(false);
          }}
        />
      )}
    </>
  );
}

function ProgramWorkoutDetails({
  workout,
  weightUnit,
}: {
  workout: PlannedWorkout;
  weightUnit: OwnProfile["weightUnit"];
}) {
  return (
    <div className="program-workout-details">
      {workout.sections.map((section) => (
        <section className="workout-section" key={section.id}>
          <WorkoutSectionHeading
            title={section.title}
            itemCount={section.items.length}
          />
          {section.items.map((item) => (
            <WorkoutLogItem
              key={item.id}
              item={item}
              active={false}
              weightUnit={weightUnit}
              showSetControls={false}
              setLogs={programPreviewSetLogs(item)}
              resultLog={programPreviewResultLog(item)}
              onUpdateSet={() => undefined}
              onAddSet={() => undefined}
              onRemoveSet={() => undefined}
              onUpdateResult={() => undefined}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

function programPreviewSetLogs(item: WorkoutItem): SetLog[] {
  if (item.mode !== "sets") return [];
  const entries = item.prescription.entries?.length
    ? item.prescription.entries
    : Array.from({ length: item.prescription.sets ?? 1 }, () => item.prescription);
  return entries.map((entry) => ({
    reps: entry.reps?.split("–")[0] ?? item.prescription.reps?.split("–")[0] ?? "",
    load: (entry.loadKg ?? item.prescription.loadKg)?.toString() ?? "",
    rpe: "",
  }));
}

function programPreviewResultLog(item: WorkoutItem): Record<string, string> {
  const prescription = item.prescription;
  return {
    rounds: prescription.rounds?.toString() ?? "",
    duration: prescription.durationMinutes?.toString() ?? "",
    distance: prescription.distance?.toString() ?? "",
    rpe: "",
  };
}

function DraggableExercisePickerRow({
  exercise,
  disabled,
  onAdd,
}: {
  exercise: Exercise;
  disabled: boolean;
  onAdd: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `picker:${exercise.id}`,
      data: { type: "library-exercise", exerciseId: exercise.id },
      disabled,
    });
  return (
    <div
      ref={setNodeRef}
      className={cn("picker-result-row", isDragging && "dragging")}
      style={{ transform: CSS.Translate.toString(transform) }}
    >
      <button
        className="drag-handle picker-drag-handle"
        type="button"
        disabled={disabled}
        aria-label={`Drag ${exercise.name} into a workout section`}
        title="Drag into any section"
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      <button
        className="picker-result-main"
        type="button"
        disabled={disabled}
        onClick={onAdd}
      >
        <SourceTag source={sourceFromExercise(exercise)} compact />
        <div>
          <strong>{exercise.name}</strong>
          <small>
            {exercise.category} · {modeLabel(exercise.defaultMode)}
          </small>
        </div>
        <Plus size={15} />
      </button>
    </div>
  );
}

function SortableWorkoutRow({
  workout,
  index,
  selected,
  editable,
  onSelect,
}: {
  workout: PlannedWorkout;
  index: number;
  selected: boolean;
  editable: boolean;
  onSelect: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: workout.id, disabled: !editable });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "workout-order-row",
        selected && "active",
        isDragging && "dragging",
      )}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      {editable ? (
        <button
          className="drag-handle"
          type="button"
          aria-label={`Drag ${workout.title} to reorder`}
          title="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          ⠿
        </button>
      ) : (
        <span className="drag-handle-placeholder" aria-hidden />
      )}
      <button className="workout-row-main" onClick={onSelect}>
        <span>{index + 1}</span>
        <div>
          <strong>{workout.title}</strong>
          <small>{workout.durationMinutes} min</small>
        </div>
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

function SortableBuilderSection({
  section,
  selected,
  editable,
  dragEnabled,
  weightUnit,
  canDelete,
  onSelect,
  onEdit,
  onDelete,
  onEditItem,
  onRemoveItem,
}: {
  section: WorkoutSection;
  selected: boolean;
  editable: boolean;
  dragEnabled: boolean;
  weightUnit: OwnProfile["weightUnit"];
  canDelete: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onEditItem: (item: WorkoutItem) => void;
  onRemoveItem: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `section:${section.id}`,
    data: { type: "section", sectionId: section.id },
    disabled: !dragEnabled,
  });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "builder-section",
        selected && "selected",
        isDragging && "dragging",
      )}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <div className="builder-section-heading">
        {dragEnabled ? (
          <button
            className="drag-handle section-drag-handle"
            type="button"
            aria-label={`Drag ${section.title} section to reorder`}
            title="Drag section to reorder"
            {...attributes}
            {...listeners}
          >
            ⠿
          </button>
        ) : (
          <span className="drag-handle-placeholder" aria-hidden />
        )}
        <div className="section-title-group">
          <button className="section-title-button" onClick={onSelect}>
            <span>{section.title}</span>
            <small>{section.kind ?? "custom"}</small>
          </button>
          {editable && (
            <div className="section-actions">
              <button
                className="section-action"
                onClick={onEdit}
                aria-label={`Edit ${section.title}`}
                title="Edit section"
              >
                <Pencil size={12} />
              </button>
              {canDelete && (
                <button
                  className="section-action danger"
                  onClick={onDelete}
                  aria-label={`Delete ${section.title}`}
                  title={`Delete ${section.title} section`}
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <SortableExerciseList
        section={section}
        editable={editable}
        dragEnabled={dragEnabled}
        weightUnit={weightUnit}
        onEditItem={onEditItem}
        onRemoveItem={onRemoveItem}
      />
    </div>
  );
}

function SortableExerciseList({
  section,
  editable,
  dragEnabled,
  weightUnit,
  onEditItem,
  onRemoveItem,
}: {
  section: WorkoutSection;
  editable: boolean;
  dragEnabled: boolean;
  weightUnit: OwnProfile["weightUnit"];
  onEditItem: (item: WorkoutItem) => void;
  onRemoveItem: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `item-list:${section.id}`,
    data: { type: "item-list", sectionId: section.id },
    disabled: !dragEnabled,
  });
  return (
    <SortableContext
      items={section.items.map((item) => `item:${item.id}`)}
      strategy={verticalListSortingStrategy}
    >
      <div
        ref={setNodeRef}
        className={cn("builder-item-list", isOver && "drop-target")}
      >
        {section.items.length ? (
          section.items.map((item, index) => (
            <SortableExerciseItem
              key={item.id}
              item={item}
              index={index}
              sectionId={section.id}
              editable={editable}
              dragEnabled={dragEnabled}
              weightUnit={weightUnit}
              onEdit={() => onEditItem(item)}
              onRemove={() => onRemoveItem(item.id)}
            />
          ))
        ) : (
          <div className="empty-inline exercise-drop-empty">
            {editable
              ? "Drop an exercise here"
              : "No items in this section yet."}
          </div>
        )}
      </div>
    </SortableContext>
  );
}

function SortableExerciseItem({
  item,
  index,
  sectionId,
  editable,
  dragEnabled,
  weightUnit,
  onEdit,
  onRemove,
}: {
  item: WorkoutItem;
  index: number;
  sectionId: string;
  editable: boolean;
  dragEnabled: boolean;
  weightUnit: OwnProfile["weightUnit"];
  onEdit: () => void;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `item:${item.id}`,
    data: { type: "item", itemId: item.id, sectionId },
    disabled: !dragEnabled,
  });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "builder-item",
        "builder-exercise-preview",
        isDragging && "dragging",
      )}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      {dragEnabled ? (
        <button
          className="drag-handle"
          type="button"
          aria-label={`Drag ${item.title} to reorder or move section`}
          title="Drag to reorder or move section"
          {...attributes}
          {...listeners}
        >
          ⠿
        </button>
      ) : (
        <span className="drag-handle-placeholder" aria-hidden />
      )}
      <div className="builder-exercise-preview-content">
        <WorkoutLogItem
          item={item}
          active={false}
          weightUnit={weightUnit}
          showSetControls={false}
          builderPreview
          setLogs={programPreviewSetLogs(item)}
          resultLog={programPreviewResultLog(item)}
          onUpdateSet={() => undefined}
          onAddSet={() => undefined}
          onRemoveSet={() => undefined}
          onUpdateResult={() => undefined}
        />
      </div>
      <div className="builder-exercise-preview-actions">
        <button
          className="icon-button"
          disabled={!editable}
          aria-label={`Edit ${item.title}`}
          title="Edit exercise"
          onClick={onEdit}
        >
          <Pencil size={15} />
        </button>
        <button
          className="icon-button danger"
          disabled={!editable}
          aria-label={`Remove ${item.title}`}
          title="Remove exercise"
          onClick={onRemove}
        >
          <Trash2 size={15} />
        </button>
      </div>
      <span className="item-position">{index + 1}</span>
    </div>
  );
}

function ObjectTypeTag({ quickWorkout }: { quickWorkout: boolean }) {
  return (
    <span className="object-type-tag">
      {quickWorkout ? <Activity size={10} /> : <Layers3 size={10} />}
      {quickWorkout ? "Workout" : "Program"}
    </span>
  );
}

function ProgramRow({
  program,
  available,
  completed = false,
  canEdit,
  canDelete,
  canCopy = true,
  copyToOwn = true,
  workoutStates,
  action,
  availabilityAction,
  onOpen,
  onEdit,
  onCopy,
  onDelete,
  onSchedule,
  onAvailability,
}: {
  program: Program;
  available: boolean;
  completed?: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canCopy?: boolean;
  copyToOwn?: boolean;
  workoutStates?: Array<"unscheduled" | "scheduled" | "completed">;
  action: Exclude<ProgramAction, null>["kind"] | null;
  availabilityAction?: "make" | "remove";
  onOpen: () => void;
  onEdit: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onSchedule?: () => void;
  onAvailability?: () => void;
}) {
  const isQuickWorkout = program.contentType === "quick_workout";
  const objectLabel = isQuickWorkout ? "Workout" : "Program";
  return (
    <article className="program-catalog-card panel">
      <button
        className="program-card-main"
        disabled={Boolean(action)}
        onClick={onOpen}
      >
        <span className="program-card-heading">
          <span className="program-icon">
            {isQuickWorkout ? <Activity size={18} /> : <Layers3 size={18} />}
          </span>
          <span>
            <strong>{program.title}</strong>
            <ObjectTypeTag quickWorkout={isQuickWorkout} />
            <SourceTag source={sourceFromProgram(program)} compact />
          </span>
        </span>
        {action === "open" && (
          <span className="program-card-loading" aria-label="Opening program">
            <LoaderCircle className="button-spinner" size={16} />
          </span>
        )}
        {workoutStates ? (
          <span
            className="program-card-workout-progress"
            aria-label={`${program.title} workout scheduling progress`}
          >
            <small>Workout progress</small>
            <span>
              {workoutStates.map((state, index) => (
                <i
                  className={state}
                  key={`${index}-${state}`}
                  title={`Workout ${index + 1}: ${state}`}
                />
              ))}
            </span>
          </span>
        ) : program.description ? (
          <span className="program-card-description">
            {program.description}
          </span>
        ) : (
          <span />
        )}
        <span className="program-card-meta">
          <span>
            {isQuickWorkout
              ? `~${program.weeks[0]?.workouts[0]?.durationMinutes ?? 45} min · One workout`
              : formatWorkoutCount(programWorkoutCount(program))}
          </span>
          {!isQuickWorkout && <span>
            {programWeekCount(program)}{" "}
            {programWeekCount(program) === 1 ? "week" : "weeks"}
          </span>}
        </span>
      </button>
      <div className="program-card-footer">
        <StatusBadge
          status={
            program.versionStatus === "draft"
              ? "draft"
              : available
                ? "in_schedule"
                : completed
                  ? "completed"
                  : "ready"
          }
        />
        <div className="program-card-actions">
          {canEdit && (
            <button
              className="icon-button"
              disabled={Boolean(action)}
              onClick={onEdit}
              aria-label={`Edit ${program.title} ${objectLabel.toLowerCase()}`}
              title={`Edit ${objectLabel.toLowerCase()}`}
            >
              {action === "edit" ? (
                <LoaderCircle className="button-spinner" size={15} />
              ) : (
                <Pencil size={15} />
              )}
            </button>
          )}
          {canCopy && (
            <button
              className="icon-button"
              disabled={Boolean(action)}
              onClick={onCopy}
              aria-label={
                copyToOwn ? `Copy ${program.title} to Own` : `Copy ${program.title}`
              }
              title={copyToOwn ? "Copy to Own" : "Copy"}
            >
              {action === "copy" ? (
                <LoaderCircle className="button-spinner" size={15} />
              ) : (
                <Copy size={15} />
              )}
            </button>
          )}
          {onSchedule && (
            <button
              className="icon-button"
              disabled={Boolean(action)}
              onClick={onSchedule}
              aria-label={`Schedule ${program.title}`}
              title={`Schedule ${objectLabel.toLowerCase()}`}
            >
              <CalendarPlus size={15} />
            </button>
          )}
          {program.versionStatus === "published" && availabilityAction && (
            <button
              className="icon-button"
              disabled={Boolean(action)}
              onClick={onAvailability}
              aria-label={`${availabilityAction === "remove" ? "Remove" : "Add"} ${program.title} ${availabilityAction === "remove" ? "from scheduling" : "to scheduling"}`}
              title={
                availabilityAction === "remove"
                  ? "Remove from schedule"
                  : "Add to schedule"
              }
            >
              {action === "availability" ? (
                <LoaderCircle className="button-spinner" size={15} />
              ) : availabilityAction === "remove" ? (
                <X size={15} />
              ) : (
                <Check size={15} />
              )}
            </button>
          )}
          {canDelete && (
            <button
              className="icon-button danger"
              disabled={Boolean(action)}
              onClick={onDelete}
              aria-label={`Delete ${program.title} ${objectLabel.toLowerCase()}`}
              title={`Delete ${objectLabel.toLowerCase()}`}
            >
              {action === "delete" ? (
                <LoaderCircle className="button-spinner" size={15} />
              ) : (
                <Trash2 size={15} />
              )}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function LibraryTemplateCard({
  template,
  loading,
  disabled,
  onOpen,
  onCopy,
  onSchedule,
}: {
  template: ProgramTemplate;
  loading: boolean;
  disabled: boolean;
  onOpen: () => void;
  onCopy: () => void;
  onSchedule: () => void;
}) {
  return (
    <article
      className={cn("program-catalog-card panel", loading && "activating")}
    >
      <button
        className="program-card-main"
        disabled={disabled}
        onClick={onOpen}
      >
        <span className="program-card-heading">
          <span className="program-icon">
            <Layers3 size={18} />
          </span>
          <span>
            <strong>{template.title}</strong>
            <ObjectTypeTag quickWorkout={false} />
            <SourceTag source={{ kind: "library" }} compact />
          </span>
        </span>
        <span className="program-card-description">{template.description}</span>
        <span className="program-card-meta">
          <span>
            {template.sessionsPerWeek}{" "}
            {template.sessionsPerWeek === 1 ? "session" : "sessions"} / week
          </span>
          <span>
            {template.weekCount} {template.weekCount === 1 ? "week" : "weeks"}
          </span>
        </span>
      </button>
      <div className="program-card-footer">
        <StatusBadge status="ready" />
        <div className="program-card-actions">
          {loading ? (
            <span className="program-card-loading" aria-label="Working">
              <LoaderCircle className="button-spinner" size={16} />
            </span>
          ) : (
            <>
              <button
                className="icon-button"
                disabled={disabled}
                onClick={onSchedule}
                aria-label={`Add ${template.title} to scheduling`}
                title="Add to scheduling"
              >
                <CalendarPlus size={15} />
              </button>
              <button
                className="icon-button"
                disabled={disabled}
                onClick={onCopy}
                aria-label={`Copy ${template.title} to Own`}
                title="Copy to Own"
              >
                <Copy size={15} />
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

function ProgramsHome({
  programs,
  schedules,
  availableIds,
  templates,
  source,
  hasCoach,
  activatingTemplateId,
  action,
  onOpen,
  onEdit,
  onCopy,
  onDelete,
  onAvailability,
  onSource,
  onCreate,
  onCreateWorkout,
  onOpenTemplate,
  onCopyTemplate,
  onScheduleTemplate,
  onScheduleLibraryProgram,
  onSchedule,
}: {
  programs: Program[];
  schedules: ScheduledWorkout[];
  availableIds: string[];
  templates: ProgramTemplate[];
  source: ProgramSourceTab;
  hasCoach: boolean;
  activatingTemplateId: string | null;
  action: ProgramAction;
  onOpen: (program: Program) => void;
  onEdit: (program: Program) => void;
  onCopy: (program: Program) => void;
  onDelete: (program: Program) => void;
  onAvailability: (program: Program, available: boolean) => void;
  onSource: (source: ProgramSourceTab) => void;
  onCreate: () => void;
  onCreateWorkout: () => void;
  onOpenTemplate: (template: ProgramTemplate) => void;
  onCopyTemplate: (template: ProgramTemplate) => void;
  onScheduleTemplate: (template: ProgramTemplate) => void;
  onScheduleLibraryProgram: (program: Program) => void;
  onSchedule: () => void;
}) {
  const available = programs.filter((program) =>
    availableIds.includes(program.id),
  );
  const availablePrograms = available.filter(
    (program) => program.contentType !== "quick_workout",
  ).length;
  const availableWorkouts = available.length - availablePrograms;
  const scheduleCountLabel = [
    availablePrograms && `${availablePrograms} ${availablePrograms === 1 ? "program" : "programs"}`,
    availableWorkouts && `${availableWorkouts} ${availableWorkouts === 1 ? "workout" : "workouts"}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const completedIds = new Set(
    programs
      .filter((program) => {
        if (availableIds.includes(program.id)) return false;
        const occurrences = schedules.filter(
          (schedule) => schedule.programVersionId === program.versionId,
        );
        return (
          occurrences.length > 0 &&
          occurrences.every(
            (schedule) =>
              schedule.status === "completed" || schedule.status === "skipped",
          )
        );
      })
      .map((program) => program.id),
  );
  const own = programs.filter((program) => program.sourceType === "self");
  const coach = programs.filter((program) => program.sourceType === "coach");
  const scheduleProgress = (program: Program) => {
    const workoutIds = programWorkoutIds(program);
    const latestScheduleByWorkout = new Map<string, ScheduledWorkout>();
    schedules
      .filter((schedule) => schedule.programVersionId === program.versionId)
      .forEach((schedule) => {
        const current = latestScheduleByWorkout.get(schedule.workoutId);
        if (!current || schedule.sequenceNumber > current.sequenceNumber)
          latestScheduleByWorkout.set(schedule.workoutId, schedule);
      });
    const workoutStates = workoutIds.map((workoutId) => {
      const schedule = latestScheduleByWorkout.get(workoutId);
      if (!schedule || !schedule.plannedDate || schedule.status === "skipped")
        return "unscheduled" as const;
      return schedule.status === "completed" ? "completed" : "scheduled";
    });
    return {
      workoutStates,
    };
  };
  return (
    <>
      <PageHeader
        eyebrow="Your training"
        title="Programs"
        description="Programs and workouts stay in their source collection. Add finished items to your scheduling choices."
      >
        <button className="button primary small" onClick={onCreateWorkout}>
          <Activity size={15} />
          Create workout
        </button>
        <button className="button primary small" onClick={onCreate}>
          <Layers3 size={15} />
          Create program
        </button>
      </PageHeader>
      <section className="program-source-section">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">In schedule</p>
            <h2>
              {scheduleCountLabel || "No items"}
            </h2>
          </div>
        </div>
        <div className="program-compact-list">
          {available.length ? (
            available.map((item) => (
              <ProgramRow
                key={item.id}
                program={item}
                available
                {...scheduleProgress(item)}
                canEdit={false}
                canDelete={false}
                canCopy={false}
                action={action?.id === item.id ? action.kind : null}
                availabilityAction="remove"
                onOpen={() => onOpen(item)}
                onEdit={() => onEdit(item)}
                onCopy={() => onCopy(item)}
                onDelete={() => undefined}
                onSchedule={onSchedule}
                onAvailability={() => onAvailability(item, false)}
              />
            ))
          ) : (
            <div className="panel empty-inline">
              Nothing is in your schedule yet. Add a Ready program below;
              calendar dates are still assigned separately.
            </div>
          )}
        </div>
      </section>
      <section className="program-source-browser panel">
        <SegmentedTabs
          className="program-source-tabs"
          label="Program sources"
          value={source}
          onChange={onSource}
          tabs={[
            { value: "library", label: "Library", icon: BookOpen },
            { value: "own", label: "Own", icon: CircleUserRound },
            ...(hasCoach ? [{ value: "coach" as const, label: "Coach", icon: Users }] : []),
          ]}
        />
        {source === "library" && (
          <div className="program-compact-list" role="tabpanel">
            {templates.map((template) => {
              const instance = programs.find(
                (program) => program.templateId === template.id,
              );
              const isActivating = activatingTemplateId === template.id;
              const instanceAction =
                instance && action?.id === instance.id ? action.kind : null;
              return instance ? (
                <ProgramRow
                  key={template.id}
                  program={instance}
                  available={availableIds.includes(instance.id)}
                  completed={completedIds.has(instance.id)}
                  canEdit={false}
                  canDelete={false}
                  action={instanceAction}
                  onOpen={() => onOpen(instance)}
                  onEdit={() => undefined}
                  onCopy={() => onCopy(instance)}
                  onDelete={() => undefined}
                  onSchedule={() => onScheduleLibraryProgram(instance)}
                />
              ) : (
                <LibraryTemplateCard
                  key={template.id}
                  template={template}
                  loading={isActivating}
                  disabled={Boolean(activatingTemplateId)}
                  onOpen={() => onOpenTemplate(template)}
                  onCopy={() => onCopyTemplate(template)}
                  onSchedule={() => onScheduleTemplate(template)}
                />
              );
            })}
          </div>
        )}
        {source === "own" && (
          <div className="program-compact-list" role="tabpanel">
            {own.length ? (
              own.map((item) => (
                <ProgramRow
                  key={item.id}
                  program={item}
                  available={availableIds.includes(item.id)}
                  completed={completedIds.has(item.id)}
                  canEdit
                  canDelete
                  copyToOwn={false}
                  action={action?.id === item.id ? action.kind : null}
                  availabilityAction={
                    availableIds.includes(item.id) ? undefined : "make"
                  }
                  onOpen={() => onOpen(item)}
                  onEdit={() => onEdit(item)}
                  onCopy={() => onCopy(item)}
                  onDelete={() => onDelete(item)}
                  onAvailability={() => onAvailability(item, true)}
                />
              ))
            ) : (
              <div className="empty-state compact">
                <Dumbbell size={24} />
                <h3>No own programs</h3>
                <p>
                  Create one from scratch or copy a Library or Coach program.
                </p>
                <button className="button primary" onClick={onCreate}>
                  <Layers3 size={15} />
                  Create program
                </button>
                <button className="button secondary" onClick={onCreateWorkout}>
                  Create workout
                </button>
              </div>
            )}
          </div>
        )}
        {hasCoach && source === "coach" && (
          <div className="program-compact-list" role="tabpanel">
            {coach.length ? (
              coach.map((item) => (
                <ProgramRow
                  key={item.id}
                  program={item}
                  available={availableIds.includes(item.id)}
                  completed={completedIds.has(item.id)}
                  canEdit={false}
                  canDelete={false}
                  action={action?.id === item.id ? action.kind : null}
                  availabilityAction={
                    availableIds.includes(item.id) ? undefined : "make"
                  }
                  onOpen={() => onOpen(item)}
                  onEdit={() => undefined}
                  onCopy={() => onCopy(item)}
                  onDelete={() => undefined}
                  onAvailability={() => onAvailability(item, true)}
                />
              ))
            ) : (
              <div className="empty-state compact">
                <Users size={24} />
                <h3>No coach programs</h3>
                <p>
                  Programs created for you by connected coaches will appear
                  here.
                </p>
              </div>
            )}
          </div>
        )}
      </section>
    </>
  );
}

function CoachProgramEmpty({
  athlete,
  onCreate,
}: {
  athlete: AthleteSummary;
  onCreate: () => void;
}) {
  return (
    <>
      <PageHeader
        eyebrow="My athletes"
        title={`${athlete.name} has no program`}
        description="Create the training content and order. The athlete will decide when each workout appears on their calendar."
      />
      <section className="panel empty-state coach-program-empty">
        <Users size={28} />
        <h3>Create a future plan</h3>
        <p>
          No program is created merely by opening this athlete. Start only when
          you are ready to assign one.
        </p>
        <button className="button primary" onClick={onCreate}>
          <Layers3 size={15} />
          Create program for {athlete.name.split(" ")[0]}
        </button>
      </section>
    </>
  );
}

function CalendarView({
  sessions,
  schedules,
  weekStartsOnSunday,
  canSchedule,
  onNavigate,
  onSchedule,
  onScheduleDay,
  onMoveSchedule,
  onDeleteSchedule,
  onOpenPlan,
  onOpenResults,
}: {
  sessions: CompletedSession[];
  schedules: ScheduledWorkout[];
  weekStartsOnSunday: boolean;
  canSchedule: boolean;
  onNavigate: (view: ViewName) => void;
  onSchedule: () => void;
  onScheduleDay: (date: string) => void;
  onMoveSchedule: (scheduleId: string, date: string) => void;
  onDeleteSchedule: (scheduleId: string) => void;
  onOpenPlan: (schedule: ScheduledWorkout) => void;
  onOpenResults: (session: CompletedSession) => void;
}) {
  const [monthOffset, setMonthOffset] = useState(0);
  const [draggingScheduleId, setDraggingScheduleId] = useState<string | null>(
    null,
  );
  const now = new Date();
  const baseDate = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const days = new Date(year, month + 1, 0).getDate();
  const firstDay =
    (new Date(year, month, 1).getDay() - (weekStartsOnSunday ? 0 : 1) + 7) %
    7;
  const weekDays = weekStartsOnSunday
    ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const monthName = baseDate.toLocaleDateString("en", {
    month: "long",
    year: "numeric",
  });
  const monthSessions = sessions.filter((session) => {
    const date = new Date(`${session.date}T12:00:00`);
    return date.getFullYear() === year && date.getMonth() === month;
  });
  const monthSchedules = schedules.filter((schedule) => {
    if (!schedule.plannedDate || schedule.status !== "planned") return false;
    const date = new Date(`${schedule.plannedDate}T12:00:00`);
    return date.getFullYear() === year && date.getMonth() === month;
  });
  const ratedSessions = monthSessions.filter((session) => session.rpe > 0);
  const averageRpe = ratedSessions.length
    ? ratedSessions.reduce((sum, session) => sum + session.rpe, 0) /
      ratedSessions.length
    : 0;
  const cells = Array.from({ length: firstDay + days }, (_, index) =>
    index < firstDay ? null : index - firstDay + 1,
  );
  return (
    <>
      <PageHeader
        eyebrow="Your schedule"
        title="Calendar"
        description="You decide when program workouts happen. Coaches can see this calendar but cannot change it."
      >
        {canSchedule ? (
          <button className="button primary" onClick={onSchedule}>
            <CalendarPlus size={15} />
            Schedule workout
          </button>
        ) : (
          <button
            className="button primary"
            onClick={() => onNavigate("program")}
          >
            <Dumbbell size={15} />
            Choose a program
          </button>
        )}
      </PageHeader>
      <div className="calendar-stats">
        <div className="panel">
          <span>
            <CalendarPlus size={18} />
          </span>
          <div>
            <small>Planned this month</small>
            <strong>{monthSchedules.length}</strong>
          </div>
          <em>Dates chosen by you</em>
        </div>
        <div className="panel">
          <span>
            <TrendingUp size={18} />
          </span>
          <div>
            <small>Completed this month</small>
            <strong>{monthSessions.length}</strong>
          </div>
          <em>{monthSessions.length ? "Synced history" : "No sessions yet"}</em>
        </div>
        <div className="panel">
          <span>
            <Activity size={18} />
          </span>
          <div>
            <small>Average session RPE</small>
            <strong>{averageRpe ? averageRpe.toFixed(1) : "—"}</strong>
          </div>
          <em>
            {averageRpe ? "From completed logs" : "Add RPE after training"}
          </em>
        </div>
      </div>
      <div className="calendar-layout">
        <section className="calendar-card panel">
          <div className="calendar-heading">
            <button
              className="icon-button"
              aria-label="Previous month"
              onClick={() => setMonthOffset((value) => value - 1)}
            >
              <ArrowLeft size={16} />
            </button>
            <h2>{monthName}</h2>
            <button
              className="icon-button"
              aria-label="Next month"
              onClick={() => setMonthOffset((value) => value + 1)}
            >
              <ArrowRight size={16} />
            </button>
          </div>
          <div className="calendar-grid">
            {weekDays.map((day) => (
              <span className="calendar-dow" key={day}>
                {day}
              </span>
            ))}
            {cells.map((day, index) => {
              if (!day)
                return (
                  <span className="calendar-day empty" key={`empty-${index}`} />
                );
              const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const daySessions = sessions.filter((item) => item.date === date);
              const daySchedules = schedules.filter(
                (item) =>
                  item.plannedDate === date && item.status === "planned",
              );
              const isToday =
                date ===
                `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
              return (
                <div
                  className={cn(
                    "calendar-day",
                  daySessions.length > 0 && "trained",
                  daySchedules.length > 0 && "planned",
                  isToday && "today",
                  draggingScheduleId && "schedule-target",
                )}
                key={date}
                role={canSchedule ? "button" : undefined}
                tabIndex={canSchedule ? 0 : undefined}
                aria-label={
                  canSchedule
                    ? `Schedule a workout on ${date}`
                    : undefined
                }
                onClick={() => {
                  if (canSchedule) onScheduleDay(date);
                }}
                onKeyDown={(event) => {
                  if (
                    canSchedule &&
                    (event.key === "Enter" || event.key === " ")
                  ) {
                    event.preventDefault();
                    onScheduleDay(date);
                  }
                }}
                onDragOver={(event) => {
                  if (draggingScheduleId) event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const scheduleId =
                    draggingScheduleId ??
                    event.dataTransfer.getData("text/plain");
                  setDraggingScheduleId(null);
                  if (scheduleId) onMoveSchedule(scheduleId, date);
                }}
              >
                  <span>{day}</span>
                  <div className="calendar-events">
                    {daySessions.map((session) => (
                      <button
                        key={session.id}
                        className="completed"
                        aria-label={`${session.workoutTitle}, completed on ${date}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenResults(session);
                        }}
                      >
                        <Check size={12} />
                        <span>{session.workoutTitle}</span>
                      </button>
                    ))}
                    {daySchedules.map((schedule) => (
                      <div className="calendar-planned-event" key={schedule.id}>
                        <button
                          className="planned"
                          draggable
                          aria-label={`${schedule.workoutTitle}, scheduled on ${date}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpenPlan(schedule);
                          }}
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", schedule.id);
                            setDraggingScheduleId(schedule.id);
                          }}
                          onDragEnd={() => setDraggingScheduleId(null)}
                        >
                          <CalendarPlus size={12} />
                          <span>{schedule.workoutTitle}</span>
                        </button>
                        <button
                          className="calendar-event-delete"
                          aria-label={`Remove ${schedule.workoutTitle} from the calendar`}
                          title="Remove from calendar"
                          onClick={(event) => {
                            event.stopPropagation();
                            onDeleteSchedule(schedule.id);
                          }}
                        >
                          <X size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                  {isToday && !daySessions.length && !daySchedules.length ? (
                    <small>Today</small>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="calendar-legend">
            <span>
              <i className="planned-dot" />
              Scheduled by you
            </span>
            <span>
              <i className="completed-dot" />
              Completed
            </span>
            <span>
              <i className="today-dot" />
              Today
            </span>
          </div>
        </section>
      </div>
    </>
  );
}

function completedEntryLabel(
  entry: CompletedSessionDetail["items"][number]["entries"][number],
  weightUnit: OwnProfile["weightUnit"] = "kg",
) {
  const parts: string[] = [];
  if (entry.reps !== undefined) parts.push(`${entry.reps} reps`);
  if (entry.loadKg !== undefined)
    parts.push(`${formatWeight(entry.loadKg, weightUnit)} ${weightUnit}`);
  if (entry.durationMinutes !== undefined)
    parts.push(`${entry.durationMinutes} min`);
  if (entry.distanceKm !== undefined) parts.push(`${entry.distanceKm} km`);
  if (entry.rounds !== undefined) parts.push(`${entry.rounds} rounds`);
  if (entry.heartRate !== undefined) parts.push(`${entry.heartRate} bpm`);
  if (entry.rpe !== undefined) parts.push(`RPE ${entry.rpe}`);
  return parts.join(" · ") || "Completed";
}

function CompletedWorkoutView({
  state,
  program,
  weightUnit,
  onBack,
}: {
  state: CompletedWorkoutViewState;
  program?: Program;
  weightUnit: OwnProfile["weightUnit"];
  onBack: () => void;
}) {
  const dateLabel = new Date(`${state.session.date}T12:00:00`).toLocaleDateString(
    "en",
    { weekday: "long", month: "long", day: "numeric" },
  );
  return (
    <>
      <PageHeader
        eyebrow={`Workout results · ${dateLabel}`}
        title="Workout results"
        description={program ? `${program.title} · completed session` : "Completed session"}
      >
        {program && <SourceTag source={sourceFromProgram(program)} />}
        <StatusBadge status="completed" />
        <button className="button secondary" onClick={onBack}>
          <ArrowLeft size={15} />
          {state.returnView === "calendar" ? "Calendar" : "Coaching"}
        </button>
      </PageHeader>
      <div className="today-layout">
        <article className="workout-card completed-workout-card">
          <div className="workout-heading">
            <div>
              <p className="eyebrow">Completed workout</p>
              <h2>{state.session.workoutTitle}</h2>
              <p>Completed on {dateLabel}</p>
            </div>
            <span className="time-pill">
              <Clock3 size={14} /> {state.session.durationMinutes} min
            </span>
          </div>
          <div className="detail-metrics calendar-result-metrics">
            <span>
              <small>Duration</small>
              <strong>{state.session.durationMinutes} min</strong>
            </span>
            <span>
              <small>Session RPE</small>
              <strong>{state.session.rpe || "—"}</strong>
            </span>
          </div>
          {state.session.note && (
            <div className="session-note">
              <MessageSquareText size={15} />
              <p>{state.session.note}</p>
            </div>
          )}
          {state.loading ? (
            <div className="calendar-detail-loading" role="status">
              <LoaderCircle className="button-spinner" size={24} />
              <span>Loading saved results…</span>
            </div>
          ) : state.error ? (
            <p className="auth-error" role="alert">
              {state.error}
            </p>
          ) : state.detail?.items.length ? (
            <div className="calendar-detail-sections">
              {state.detail.items.map((item) => (
                <section className="calendar-detail-section" key={item.id}>
                  <div className="calendar-result-heading">
                    <div>
                      <strong>{item.title}</strong>
                      {item.cue && <small>{item.cue}</small>}
                    </div>
                    <span>{modeLabel(item.mode)}</span>
                  </div>
                  {item.entries.length ? (
                    <div className="calendar-result-entries">
                      {item.entries.map((entry) => (
                        <div key={entry.position}>
                          <small>
                            {item.entries.length > 1
                              ? `Set ${entry.position + 1}`
                              : "Result"}
                          </small>
                          <strong>{completedEntryLabel(entry, weightUnit)}</strong>
                          {entry.note && <span>{entry.note}</span>}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="calendar-result-empty">
                      {item.mode === "none"
                        ? "Instructions completed"
                        : "No values were recorded"}
                    </p>
                  )}
                  {item.note && (
                    <p className="calendar-result-note">{item.note}</p>
                  )}
                </section>
              ))}
            </div>
          ) : (
            <div className="calendar-result-empty-state">
              <Activity size={22} />
              <p>No exercise-level values were saved for this session.</p>
            </div>
          )}
        </article>
      </div>
    </>
  );
}

function inferredExerciseDiscipline(exercise: Exercise): ExerciseDiscipline {
  if (exercise.discipline) return exercise.discipline;
  if (exercise.category === "Weightlifting") return "weightlifting";
  if (
    ["Functional fitness", "Gymnastics", "Conditioning", "Cardio"].includes(
      exercise.category,
    )
  ) {
    return "functional";
  }
  return "gym";
}

function ExercisesView({
  scope,
  query,
  global,
  personal,
  onScope,
  onQuery,
  onAdd,
  onDelete,
}: {
  scope: "global" | "personal";
  query: string;
  global: Exercise[];
  personal: Exercise[];
  onScope: (scope: "global" | "personal") => void;
  onQuery: (query: string) => void;
  onAdd: () => void;
  onDelete: (exercise: Exercise) => void;
}) {
  const source = scope === "global" ? global : personal;
  const [disciplineFilter, setDisciplineFilter] = useState<
    "all" | ExerciseDiscipline
  >("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const filteredByDiscipline = source.filter(
    (exercise) =>
      scope !== "global" ||
      disciplineFilter === "all" ||
      inferredExerciseDiscipline(exercise) === disciplineFilter,
  );
  const categoryOptions = Array.from(
    new Set(filteredByDiscipline.map((exercise) => exercise.category)),
  ).sort((left, right) => left.localeCompare(right));
  const activeCategory = categoryOptions.includes(categoryFilter)
    ? categoryFilter
    : "all";
  const filtered = filteredByDiscipline.filter((exercise) =>
    `${exercise.name} ${exercise.category} ${exercise.tags?.join(" ") ?? ""}`
      .toLowerCase()
      .includes(query.toLowerCase()) &&
    (activeCategory === "all" || exercise.category === activeCategory),
  );
  return (
    <>
      <PageHeader
        eyebrow="Reusable movements"
        title="Exercise library"
      >
        <button className="button primary" onClick={onAdd}>
          <Plus size={16} />
          New exercise
        </button>
      </PageHeader>
      <div className="library-toolbar panel">
        <div className="library-filter-tabs">
          <SegmentedTabs
            label="Exercise sources"
            value={scope}
            onChange={onScope}
            tabs={[
              { value: "global", label: <>Global library <span>{global.length}</span></>, icon: BookOpen },
              { value: "personal", label: <>My exercises <span>{personal.length}</span></>, icon: CircleUserRound },
            ]}
          />
          {scope === "global" && (
            <SegmentedTabs
              className="exercise-discipline-tabs"
              compact
              label="Exercise discipline"
              value={disciplineFilter}
              onChange={(nextDiscipline) => {
                setDisciplineFilter(nextDiscipline);
                setCategoryFilter("all");
              }}
              tabs={[
                { value: "all", label: "All" },
                { value: "weightlifting", label: "Weightlifting" },
                { value: "gym", label: "Gym" },
                { value: "functional", label: "Functional" },
              ]}
            />
          )}
        </div>
        <div className="library-filter-actions">
          <label className="search-field library-search">
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => onQuery(event.target.value)}
              placeholder="Search exercises"
            />
          </label>
          <div className="library-category-filter">
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={categoryMenuOpen}
            onClick={() => setCategoryMenuOpen((open) => !open)}
          >
            <Settings2 size={14} />
            {activeCategory === "all" ? "All categories" : activeCategory}
            <ChevronDown size={13} />
          </button>
          {categoryMenuOpen && (
            <div className="library-category-menu" role="listbox" aria-label="Filter exercises by category">
              {["all", ...categoryOptions].map((category) => {
                const selected = category === activeCategory;
                return (
                  <button
                    type="button"
                    key={category}
                    role="option"
                    aria-selected={selected}
                    className={selected ? "selected" : undefined}
                    onClick={() => {
                      setCategoryFilter(category);
                      setCategoryMenuOpen(false);
                    }}
                  >
                    {category === "all" ? "All categories" : category}
                  </button>
                );
              })}
            </div>
          )}
          </div>
        </div>
      </div>
      <div className="library-meta"><span>{filtered.length} exercises</span></div>
      <div className="exercise-list panel">
        {filtered.map((exercise) => (
          <article className="exercise-list-row" key={exercise.id}>
            <div className="exercise-list-identity">
              <strong>{exercise.name}</strong>
              <small>{exercise.category}</small>
            </div>
            <div className="exercise-list-tracking">
              <span>
                <Activity size={14} />
                {modeLabel(exercise.defaultMode)}
              </span>
              <span>
                {exercise.defaultFields.length
                  ? exercise.defaultFields.join(" · ")
                  : "No tracking"}
              </span>
              {exercise.scope === "personal" && (
                <button
                  className="icon-button danger exercise-list-delete"
                  aria-label={`Delete ${exercise.name}`}
                  title="Delete exercise"
                  onClick={() => onDelete(exercise)}
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

function coachDateLabel(value: string, includeYear = false) {
  const date = new Date(value.includes("T") ? value : `${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return date.toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" } : {}),
  });
}

function coachProgramStatusLabel(
  status: CoachAssignedProgramSummary["status"],
) {
  if (status === "awaiting_schedule") return "Awaiting scheduling";
  if (status === "in_progress") return "In progress";
  if (status === "completed") return "Completed";
  return "Scheduled";
}

function coachProgramDisplayStatus(
  status: CoachAssignedProgramSummary["status"],
) {
  if (status === "awaiting_schedule") return "ready" as const;
  if (status === "scheduled") return "in_schedule" as const;
  return status;
}

function coachRpeTone(rpe: number) {
  if (rpe <= 4) return "low";
  if (rpe >= 9) return "high";
  return "balanced";
}

function coachAgendaStatusLabel(status: CoachAgendaEntry["status"]) {
  if (status === "in_progress") return "In progress";
  if (status === "overdue") return "Overdue";
  if (status === "completed") return "Completed";
  return "Planned";
}

function CoachingView({
  mode,
  coachConnections,
  pendingInvites,
  outgoingInvites,
  athletes,
  selectedAthlete,
  openingProgramId,
  onMode,
  refreshing,
  onRefresh,
  onInvite,
  respondingInvite,
  cancellingInviteId,
  onRespondInvite,
  onDisconnect,
  onCancelInvite,
  onSelectAthlete,
  onOpenAssignedProgram,
  onOpenAgendaEntry,
  onAssignAthlete,
}: {
  mode: "athlete" | "coach";
  coachConnections: CoachConnection[];
  pendingInvites: PendingCoachInvite[];
  outgoingInvites: OutgoingCoachInvite[];
  athletes: AthleteSummary[];
  selectedAthlete: AthleteSummary | null;
  openingProgramId: string | null;
  onMode: (mode: "athlete" | "coach") => void;
  refreshing: boolean;
  onRefresh: () => void;
  onInvite: () => void;
  respondingInvite: {
    id: string;
    response: "accepted" | "declined";
  } | null;
  cancellingInviteId: string | null;
  onRespondInvite: (
    invitation: PendingCoachInvite,
    response: "accepted" | "declined",
  ) => void;
  onDisconnect: (connection: CoachConnection) => void;
  onCancelInvite: (invitation: OutgoingCoachInvite) => void;
  onSelectAthlete: (athlete: AthleteSummary) => void;
  onOpenAssignedProgram: (
    athlete: AthleteSummary,
    program: CoachAssignedProgramSummary,
    workoutId?: string,
  ) => void;
  onOpenAgendaEntry: (
    athlete: AthleteSummary,
    entry: CoachAgendaEntry,
  ) => void;
  onAssignAthlete: (athlete: AthleteSummary) => void;
}) {
  const hasAthleteWorkspace = athletes.length > 0 || pendingInvites.length > 0;
  return (
    <>
      <PageHeader
        eyebrow="Shared progress"
        title="Coaching"
        description="Invite people you trust to plan with context, or manage the athletes who invited you."
      >
        <SegmentedTabs
          compact
          label="Coaching workspace"
          value={mode}
          onChange={onMode}
          tabs={[
            { value: "athlete", label: "My coaches" },
            ...(hasAthleteWorkspace
              ? [{
                  value: "coach" as const,
                  label: refreshing ? <><LoaderCircle className="button-spinner" size={14} /> Refreshing…</> : "My athletes",
                  disabled: refreshing,
                  badge: pendingInvites.length,
                }]
              : []),
          ]}
        />
      </PageHeader>
      {mode === "athlete" || !hasAthleteWorkspace ? (
        <div className="coaching-athlete-layout">
          <section className="panel coach-access-card">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Plan access</p>
                <h3>
                  {coachConnections.length} active{" "}
                  {coachConnections.length === 1 ? "coach" : "coaches"}
                </h3>
              </div>
              <button className="button secondary small" onClick={onInvite}>
                <UserPlus size={14} />
                Invite coach
              </button>
            </div>
            {outgoingInvites.length > 0 && (
              <div className="outgoing-coach-requests">
                <p className="eyebrow">Pending requests</p>
                {outgoingInvites.map((invitation) => {
                  const cancelling = cancellingInviteId === invitation.id;
                  return (
                    <article key={invitation.id}>
                      <PersonAvatar initials={invitation.coachInitials} name={invitation.coachName} />
                      <div>
                        <strong>{invitation.coachName}</strong>
                        <small>Waiting for coach confirmation</small>
                      </div>
                      <span className="pending-count">Pending</span>
                      <button
                        className="button secondary small"
                        disabled={Boolean(cancellingInviteId)}
                        onClick={() => onCancelInvite(invitation)}
                      >
                        {cancelling ? (
                          <>
                            <LoaderCircle
                              className="button-spinner"
                              size={14}
                            />
                            Cancelling…
                          </>
                        ) : (
                          <>
                            <X size={14} />
                            Cancel
                          </>
                        )}
                      </button>
                    </article>
                  );
                })}
              </div>
            )}
            {coachConnections.length ? (
              <>
                <div className="coach-connection-list">
                  {coachConnections.map((connection) => {
                    const connectedDate = new Date(
                      `${connection.connectedSince}T12:00:00`,
                    ).toLocaleDateString("en", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    });
                    return (
                      <article
                        key={connection.relationshipId}
                        className="coach-connection-row"
                      >
                        <PersonAvatar initials={connection.initials} name={connection.name} size="large" />
                        <div>
                          <strong>{connection.name}</strong>
                          <small>Connected since {connectedDate}</small>
                        </div>
                        <StatusBadge status="connected" />
                        <button
                          className="button danger small"
                          onClick={() => onDisconnect(connection)}
                        >
                          <X size={14} />
                          Remove
                        </button>
                      </article>
                    );
                  })}
                </div>
                <div className="permission-list">
                  <h3>What your coaches can do</h3>
                  <span>
                    <Check size={15} />
                    View your calendar, sessions, RPE, and training notes
                  </span>
                  <span>
                    <Check size={15} />
                    Create and update future program versions
                  </span>
                  <span>
                    <Check size={15} />
                    Use personal exercises while building your plan
                  </span>
                  <span className="locked">
                    <LockKeyhole size={15} />
                    Cannot alter your completed workout history
                  </span>
                </div>
              </>
            ) : (
              <div
                className={cn(
                  "invite-empty",
                  outgoingInvites.length > 0 && "compact",
                )}
              >
                <span>
                  <UserPlus size={26} />
                </span>
                <h2>No active coach yet</h2>
                <p>
                  Invite a coach above to build future plans and review your
                  workout history. You stay in control of every connection.
                </p>
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="coach-dashboard">
          <section className="panel athlete-list">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Your athletes</p>
                <h3>{athletes.length} active</h3>
              </div>
              <div className="coach-workspace-heading-actions">
                {pendingInvites.length ? (
                  <span className="pending-count">
                    {pendingInvites.length} pending
                  </span>
                ) : (
                  <Users size={17} />
                )}
                <button
                  className="button secondary small"
                  disabled={refreshing}
                  onClick={onRefresh}
                  aria-label="Refresh coaching requests"
                >
                  {refreshing ? (
                    <LoaderCircle className="button-spinner" size={14} />
                  ) : (
                    <RefreshCw size={14} />
                  )}
                  {refreshing ? "Refreshing…" : "Refresh"}
                </button>
              </div>
            </div>
            {pendingInvites.length > 0 && (
              <div className="pending-coach-requests">
                <p className="eyebrow">Coaching requests</p>
                {pendingInvites.map((invitation) => {
                  const responding = respondingInvite?.id === invitation.id;
                  const declining =
                    responding && respondingInvite.response === "declined";
                  const accepting =
                    responding && respondingInvite.response === "accepted";
                  return (
                    <article key={invitation.id}>
                      <PersonAvatar initials={invitation.athleteInitials} name={invitation.athleteName} />
                      <div>
                        <strong>{invitation.athleteName}</strong>
                        <small>Invited you to coach them</small>
                      </div>
                      <div className="pending-request-actions">
                        <button
                          className="button secondary small"
                          disabled={Boolean(respondingInvite)}
                          onClick={() =>
                            onRespondInvite(invitation, "declined")
                          }
                        >
                          {declining ? (
                            <>
                              <LoaderCircle
                                className="button-spinner"
                                size={14}
                              />
                              Declining…
                            </>
                          ) : (
                            "Decline"
                          )}
                        </button>
                        <button
                          className="button primary small"
                          disabled={Boolean(respondingInvite)}
                          onClick={() =>
                            onRespondInvite(invitation, "accepted")
                          }
                        >
                          {accepting ? (
                            <>
                              <LoaderCircle
                                className="button-spinner"
                                size={14}
                              />
                              Accepting…
                            </>
                          ) : (
                            <>
                              <Check size={14} />
                              Accept
                            </>
                          )}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
            {pendingInvites.length > 0 && athletes.length > 0 && (
              <p className="athlete-list-label">Active athletes</p>
            )}
            {athletes.length ? (
              athletes.map((athlete) => (
                <button
                  key={athlete.id}
                  className={selectedAthlete?.id === athlete.id ? "active" : ""}
                  onClick={() => onSelectAthlete(athlete)}
                >
                  <PersonAvatar initials={athlete.initials} name={athlete.name} />
                  <div>
                    <strong>{athlete.name}</strong>
                  </div>
                  <ChevronRight size={16} />
                </button>
              ))
            ) : (
              <div className="empty-state">
                <Users size={24} />
                <h3>No athletes yet</h3>
                <p>
                  Athletes appear here after you accept their coaching request.
                </p>
              </div>
            )}
          </section>
          {selectedAthlete ? (
            <CoachAthleteOverview
              athlete={selectedAthlete}
              openingProgramId={openingProgramId}
              onAssign={() => onAssignAthlete(selectedAthlete)}
              onOpenProgram={(assignedProgram, workoutId) =>
                onOpenAssignedProgram(
                  selectedAthlete,
                  assignedProgram,
                  workoutId,
                )
              }
              onOpenAgenda={(entry) =>
                onOpenAgendaEntry(selectedAthlete, entry)
              }
            />
          ) : (
            <section className="panel empty-state">
              <Users size={28} />
              <h3>Select an athlete</h3>
              <p>Choose an athlete to view their latest training summary.</p>
            </section>
          )}
        </div>
      )}
    </>
  );
}

function CoachAthleteOverview({
  athlete,
  openingProgramId,
  onAssign,
  onOpenProgram,
  onOpenAgenda,
}: {
  athlete: AthleteSummary;
  openingProgramId: string | null;
  onAssign: () => void;
  onOpenProgram: (
    program: CoachAssignedProgramSummary,
    workoutId?: string,
  ) => void;
  onOpenAgenda: (entry: CoachAgendaEntry) => void;
}) {
  const upcomingEntries = athlete.agenda
    .filter((entry) => entry.kind === "upcoming")
    .sort((left, right) => {
      const priority = { in_progress: 0, overdue: 1, planned: 2, completed: 3 };
      return (
        priority[left.status] - priority[right.status] ||
        left.date.localeCompare(right.date)
      );
    })
    .slice(0, 6);
  const completedEntries = athlete.agenda
    .filter((entry) => entry.kind === "completed")
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, 6);

  return (
    <section className="athlete-overview">
      <div className="panel athlete-hero">
        <div className="athlete-name">
          <PersonAvatar initials={athlete.initials} name={athlete.name} size="large" />
          <div>
            <p className="eyebrow">Athlete overview</p>
            <h2>{athlete.name}</h2>
            <p>Programs and sessions you coach</p>
          </div>
        </div>
        <div className="athlete-hero-actions">
          <button className="button primary" onClick={onAssign}>
            <Dumbbell size={15} />
            Assign program
          </button>
        </div>
      </div>

      <section className="panel coach-programs-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Your programs</p>
            <h3>
              {athlete.assignedPrograms.length} assigned{" "}
              {athlete.assignedPrograms.length === 1 ? "program" : "programs"}
            </h3>
          </div>
        </div>
        {athlete.assignedPrograms.length ? (
          <div className="coach-assigned-programs">
            {athlete.assignedPrograms.map((assignedProgram) => (
              <article
                className="program-catalog-card coach-assigned-program panel"
                key={assignedProgram.id}
              >
                <button
                  className="program-card-main"
                  disabled={Boolean(openingProgramId)}
                  onClick={() => onOpenProgram(assignedProgram)}
                  aria-busy={openingProgramId === assignedProgram.id}
                  aria-label={
                    openingProgramId === assignedProgram.id
                      ? "Opening " + assignedProgram.title
                      : `Open ${assignedProgram.title}, ${coachProgramStatusLabel(assignedProgram.status)}, ${assignedProgram.completedWorkouts} of ${assignedProgram.totalWorkouts} workouts completed`
                  }
                >
                  <span className="program-card-heading">
                    <span className="program-icon">
                      {openingProgramId === assignedProgram.id ? (
                        <LoaderCircle className="button-spinner" size={16} />
                      ) : (
                        <Dumbbell size={18} />
                      )}
                    </span>
                    <span>
                      <strong>{assignedProgram.title}</strong>
                      <SourceTag source={{ kind: "coach" }} compact />
                    </span>
                  </span>
                  <span
                    className="program-card-workout-progress"
                    aria-label={`${assignedProgram.title} workout progress`}
                  >
                    <small>Workout progress</small>
                    <span
                      aria-label={`${assignedProgram.completedWorkouts} of ${assignedProgram.totalWorkouts} workouts completed`}
                    >
                      {assignedProgram.workoutProgress.map((state, index) => (
                        <i
                          className={state}
                          key={`${assignedProgram.id}-${index}-${state}`}
                          title={`Workout ${index + 1}: ${state}`}
                        />
                      ))}
                    </span>
                  </span>
                  <span className="program-card-meta">
                    <span>
                      {assignedProgram.totalWorkouts} {assignedProgram.totalWorkouts === 1 ? "workout" : "workouts"}
                    </span>
                    <span>Assigned {coachDateLabel(assignedProgram.assignedAt, true)}</span>
                  </span>
                </button>
                <div className="program-card-footer">
                  <StatusBadge
                    status={coachProgramDisplayStatus(assignedProgram.status)}
                    label={coachProgramStatusLabel(assignedProgram.status)}
                  />
                  <div className="program-card-actions">
                    <button
                      className="icon-button"
                      disabled={Boolean(openingProgramId)}
                      onClick={() => onOpenProgram(assignedProgram)}
                      aria-label={`Open ${assignedProgram.title}`}
                      title="Open assignment"
                    >
                      {openingProgramId === assignedProgram.id ? (
                        <LoaderCircle className="button-spinner" size={15} />
                      ) : (
                        <ChevronRight size={15} />
                      )}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="coach-program-empty">
            <Dumbbell size={20} />
            <div>
              <strong>No programs assigned by you</strong>
              <p>
                Assign one of your finished programs to start planning with
                this athlete.
              </p>
            </div>
          </div>
        )}
      </section>

      <section className="panel coach-agenda-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Athlete calendar</p>
            <h3>Your programs on their agenda</h3>
          </div>
          <span className="read-only-pill">
            <LockKeyhole size={13} />
            Read only
          </span>
        </div>
        <div className="coach-agenda-grid">
          <CoachAgendaGroup
            title="Scheduled"
            empty="No scheduled workouts from your programs."
            entries={upcomingEntries}
            onOpen={onOpenAgenda}
          />
          <CoachAgendaGroup
            title="Recently completed"
            empty="No workouts from your programs have been completed yet."
            entries={completedEntries}
            onOpen={onOpenAgenda}
          />
        </div>
        <div className="coach-rpe-legend" aria-label="RPE color guide">
          <span className="low">RPE 1–4 · low</span>
          <span className="balanced">RPE 5–8 · usual range</span>
          <span className="high">RPE 9–10 · high</span>
        </div>
      </section>
    </section>
  );
}

function CoachAgendaGroup({
  title,
  empty,
  entries,
  onOpen,
}: {
  title: string;
  empty: string;
  entries: CoachAgendaEntry[];
  onOpen: (entry: CoachAgendaEntry) => void;
}) {
  return (
    <section className="coach-agenda-group">
      <div className="coach-agenda-heading">
        <strong>{title}</strong>
        <span>{entries.length}</span>
      </div>
      {entries.length ? (
        <div className="coach-agenda-list">
          {entries.map((entry) => {
            const canOpen =
              entry.kind === "upcoming" || Boolean(entry.sessionId);
            const dateParts = coachDateLabel(entry.date).split(" ");
            return (
              <button
                key={entry.id}
                disabled={!canOpen}
                onClick={() => onOpen(entry)}
                aria-label={
                  `${entry.workoutTitle}, ${entry.programTitle}, ${coachAgendaStatusLabel(entry.status)} ${coachDateLabel(entry.date, true)}${entry.kind === "completed" ? `, RPE ${entry.rpe ?? "unavailable"}` : ""}`
                }
              >
                <span
                  className={cn(
                    "coach-agenda-date",
                    entry.kind === "completed" && "completed",
                  )}
                >
                  <small>{dateParts[0]}</small>
                  <strong>{dateParts[1]}</strong>
                </span>
                <span className="coach-agenda-copy">
                  <strong>{entry.workoutTitle}</strong>
                  <small>{entry.programTitle}</small>
                </span>
                {entry.kind === "completed" ? (
                  <span
                    className={cn(
                      "coach-rpe",
                      entry.rpe ? coachRpeTone(entry.rpe) : "unavailable",
                    )}
                    aria-label={
                      entry.rpe
                        ? "Completed, RPE " + entry.rpe
                        : "Completed, RPE unavailable"
                    }
                  >
                    {entry.rpe ? "RPE " + entry.rpe : "Completed · RPE —"}
                  </span>
                ) : (
                  <span
                    className={cn("coach-agenda-state", entry.status)}
                  >
                    {entry.status === "planned" ? (
                      <CalendarDays size={13} />
                    ) : (
                      <Clock3 size={13} />
                    )}
                    {coachAgendaStatusLabel(entry.status)}
                  </span>
                )}
                <ChevronRight size={15} />
              </button>
            );
          })}
        </div>
      ) : (
        <p className="coach-agenda-empty">{empty}</p>
      )}
    </section>
  );
}

function ModalShell({
  title,
  description,
  onClose,
  dismissible = true,
  wide = false,
  children,
}: {
  title: string;
  description: string;
  onClose: () => void;
  dismissible?: boolean;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = dialogRef.current;
    dialog
      ?.querySelector<HTMLElement>(
        "input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)",
      )
      ?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && dismissible) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [
        ...dialog.querySelectorAll<HTMLElement>(
          "input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), [tabindex]:not([tabindex='-1'])",
        ),
      ];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [dismissible, onClose]);
  return (
    <div className="modal-backdrop" aria-busy={!dismissible}>
      <button
        className="modal-dismiss-layer"
        tabIndex={-1}
        onClick={dismissible ? onClose : undefined}
        disabled={!dismissible}
        aria-label="Close dialog"
      />
      <section
        ref={dialogRef}
        className={cn("modal", wide && "wide")}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Lift Log</p>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            disabled={!dismissible}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function ExerciseModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (
    name: string,
    category: string,
    mode: EntryMode,
    cue: string,
  ) => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [mode, setMode] = useState<EntryMode>("sets");
  const [cue, setCue] = useState("");
  return (
    <ModalShell
      title="Create an exercise"
      description="Save it once, then reuse it in any program you build."
      onClose={onClose}
    >
      <div className="form-grid">
        <label className="form-field full">
          <span>Exercise name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Tall clean + front squat"
          />
        </label>
        <label className="form-field">
          <span>Category</span>
          <input
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            placeholder="e.g. Weightlifting"
          />
        </label>
        <label className="form-field">
          <span>Default logging</span>
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as EntryMode)}
          >
            <option value="sets">Sets</option>
            <option value="result">Single result</option>
            <option value="intervals">Intervals</option>
            <option value="none">Instructions only</option>
          </select>
        </label>
        <label className="form-field full">
          <span>Default cue</span>
          <textarea
            value={cue}
            onChange={(event) => setCue(event.target.value)}
            placeholder="Short instruction shown in the workout"
          />
        </label>
      </div>
      <div className="modal-actions">
        <button className="button secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button primary"
          disabled={!name.trim()}
          onClick={() => onSave(name.trim(), category.trim(), mode, cue.trim())}
        >
          Save exercise
        </button>
      </div>
    </ModalShell>
  );
}

function WorkoutModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (title: string) => void;
}) {
  const [title, setTitle] = useState("");
  return (
    <ModalShell
      title="Add a workout"
      description="Create the next session in this program. The athlete chooses its calendar date separately."
      onClose={onClose}
    >
      <div className="form-grid">
        <label className="form-field full">
          <span>Workout name</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. Upper body"
          />
        </label>
        <div className="form-info full">
          <CalendarDays size={16} />
          <span>
            This workout is ordered in the plan, not tied to a weekday.
          </span>
        </div>
      </div>
      <div className="modal-actions">
        <button className="button secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button primary"
          disabled={!title.trim()}
          onClick={() => onSave(title.trim())}
        >
          Add workout
        </button>
      </div>
    </ModalShell>
  );
}

function RenameProgramModal({
  label,
  title,
  onClose,
  onSave,
}: {
  label: "program" | "workout";
  title: string;
  onClose: () => void;
  onSave: (title: string) => Promise<void>;
}) {
  const [nextTitle, setNextTitle] = useState(title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    try {
      await onSave(nextTitle.trim());
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : `The ${label} name could not be updated.`,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell
      title={`Rename ${label}`}
      description={`Choose the name shown for this ${label} throughout LiftLog.`}
      onClose={onClose}
    >
      <label className="form-field full">
        <span>{label === "program" ? "Program" : "Workout"} name</span>
        <input
          autoFocus
          value={nextTitle}
          onChange={(event) => setNextTitle(event.target.value)}
        />
      </label>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button className="button secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button primary"
          disabled={!nextTitle.trim() || saving}
          onClick={save}
        >
          {saving ? "Saving…" : "Save name"}
        </button>
      </div>
    </ModalShell>
  );
}

function WorkoutSettingsModal({
  workout,
  onClose,
  onSave,
}: {
  workout: PlannedWorkout;
  onClose: () => void;
  onSave: (title: string, durationMinutes: number) => Promise<void>;
}) {
  const [title, setTitle] = useState(workout.title);
  const [duration, setDuration] = useState(String(workout.durationMinutes));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const durationMinutes = Number(duration);
  async function save() {
    setSaving(true);
    setError("");
    try {
      await onSave(title.trim(), durationMinutes);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "The workout could not be updated.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <ModalShell
      title="Workout details"
      description="Update the name and expected duration shown throughout the plan."
      onClose={onClose}
    >
      <div className="form-grid">
        <label className="form-field full">
          <span>Workout name</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="form-field full">
          <span>Estimated duration in minutes</span>
          <input
            type="number"
            min="5"
            max="600"
            step="5"
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
          />
        </label>
      </div>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button className="button secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button primary"
          disabled={
            !title.trim() ||
            !Number.isInteger(durationMinutes) ||
            durationMinutes < 5 ||
            durationMinutes > 600 ||
            saving
          }
          onClick={save}
        >
          {saving ? "Saving…" : "Save workout"}
        </button>
      </div>
    </ModalShell>
  );
}

function SectionModal({
  section,
  onClose,
  onSave,
}: {
  section: WorkoutSection | null;
  onClose: () => void;
  onSave: (title: string, kind: WorkoutSection["kind"]) => Promise<void>;
}) {
  const labels: Record<NonNullable<WorkoutSection["kind"]>, string> = {
    warmup: "Warm-up",
    main: "Main work",
    conditioning: "Conditioning",
    cooldown: "Cool-down",
    custom: "Custom section",
  };
  const [kind, setKind] = useState<NonNullable<WorkoutSection["kind"]>>(
    section?.kind ?? "warmup",
  );
  const [title, setTitle] = useState(
    section?.title ?? labels[section?.kind ?? "warmup"],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const mainLocked = section?.kind === "main";
  async function save() {
    setSaving(true);
    setError("");
    try {
      await onSave(title.trim(), kind);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : `The section could not be ${section ? "updated" : "added"}.`,
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <ModalShell
      title={section ? "Edit workout section" : "Add workout section"}
      description={
        section
          ? "Rename the section or change how it is categorised."
          : "Separate warm-up, main work, conditioning and cool-down while keeping one workout."
      }
      onClose={onClose}
    >
      <div className="form-grid">
        <label className="form-field">
          <span>Section type</span>
          <select
            value={kind}
            disabled={mainLocked}
            onChange={(event) => {
              const next = event.target.value as NonNullable<
                WorkoutSection["kind"]
              >;
              setKind(next);
              setTitle(labels[next]);
            }}
          >
            <option value="warmup">Warm-up</option>
            {section && <option value="main">Main work</option>}
            <option value="conditioning">Conditioning</option>
            <option value="cooldown">Cool-down</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label className="form-field">
          <span>Section name</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
      </div>
      {mainLocked && (
        <p className="form-info">
          Main work is required in every workout and cannot be changed to another
          section type.
        </p>
      )}
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button className="button secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button primary"
          disabled={!title.trim() || saving}
          onClick={save}
        >
          {saving ? "Saving…" : section ? "Save section" : "Add section"}
        </button>
      </div>
    </ModalShell>
  );
}

function DeleteSectionModal({
  section,
  onClose,
  onDelete,
}: {
  section: WorkoutSection;
  onClose: () => void;
  onDelete: (deleteItems: boolean) => Promise<void>;
}) {
  const [saving, setSaving] = useState<"move" | "delete" | null>(null);
  const [error, setError] = useState("");
  const itemCount = section.items.length;

  async function remove(deleteItems: boolean) {
    setSaving(deleteItems ? "delete" : "move");
    setError("");
    try {
      await onDelete(deleteItems);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "The section could not be deleted.",
      );
      setSaving(null);
    }
  }

  return (
    <ModalShell
      title={`Delete ${section.title}?`}
      description={
        itemCount
          ? `This section contains ${itemCount} ${itemCount === 1 ? "exercise" : "exercises"}. Choose what to do with them.`
          : "This empty section will be removed."
      }
      onClose={onClose}
      dismissible={!saving}
    >
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button className="button secondary" disabled={Boolean(saving)} onClick={onClose}>
          Cancel
        </button>
        {itemCount > 0 && (
          <button
            className="button secondary"
            disabled={Boolean(saving)}
            onClick={() => void remove(false)}
          >
            {saving === "move" ? "Moving…" : "Move to Main work"}
          </button>
        )}
        <button
          className="button danger"
          disabled={Boolean(saving)}
          onClick={() => void remove(true)}
        >
          {saving === "delete"
            ? "Deleting…"
            : itemCount > 0
              ? "Delete section & exercises"
              : "Delete section"}
        </button>
      </div>
    </ModalShell>
  );
}

function DeleteExerciseModal({
  exercise,
  onClose,
  onDelete,
}: {
  exercise: Exercise;
  onClose: () => void;
  onDelete: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    setDeleting(true);
    setError("");
    try {
      await onDelete();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "The exercise could not be deleted.",
      );
      setDeleting(false);
    }
  }

  return (
    <ModalShell
      title={`Delete ${exercise.name}?`}
      description="It will disappear from My exercises. Any existing workouts keep their saved exercise details."
      onClose={onClose}
      dismissible={!deleting}
    >
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button className="button secondary" disabled={deleting} onClick={onClose}>
          Cancel
        </button>
        <button className="button danger" disabled={deleting} onClick={() => void remove()}>
          {deleting ? (
            <>
              <LoaderCircle className="button-spinner" size={15} />
              Deleting…
            </>
          ) : (
            <>
              <Trash2 size={15} />
              Delete exercise
            </>
          )}
        </button>
      </div>
    </ModalShell>
  );
}

type PrescriptionDraftEntry = {
  reps: string;
  load: string;
  rpe: string;
  duration: string;
  distance: string;
  work: string;
  rest: string;
};

type PerEntryField = "reps" | "load" | "rpe" | "work" | "rest";

function prescriptionDraftEntry(
  entry: PrescriptionEntry | undefined,
  prescription: WorkoutItem["prescription"],
  weightUnit: OwnProfile["weightUnit"],
): PrescriptionDraftEntry {
  return {
    reps: entry?.reps ?? prescription.reps ?? "",
    load:
      entry?.loadKg ?? prescription.loadKg
        ? formatWeight(entry?.loadKg ?? prescription.loadKg ?? 0, weightUnit)
        : "",
    rpe: wholeRpe(entry?.targetRpe ?? prescription.targetRpe ?? ""),
    duration: String(entry?.durationMinutes ?? prescription.durationMinutes ?? ""),
    distance: String(entry?.distance ?? prescription.distance ?? ""),
    work: String(entry?.workSeconds ?? prescription.workSeconds ?? ""),
    rest: String(entry?.restSeconds ?? prescription.restSeconds ?? ""),
  };
}

function prescriptionDraftEntries(
  mode: EntryMode,
  prescription: WorkoutItem["prescription"],
  weightUnit: OwnProfile["weightUnit"],
) {
  const count =
    mode === "sets"
      ? Math.max(1, prescription.sets ?? 3)
      : mode === "intervals"
        ? Math.max(1, prescription.rounds ?? 1)
        : 1;
  const source = prescription.entries?.length
    ? prescription.entries
    : [undefined];
  return Array.from({ length: count }, (_, index) =>
    prescriptionDraftEntry(source[index] ?? source.at(-1), prescription, weightUnit),
  );
}

function PrescriptionModal({
  item,
  weightUnit,
  onClose,
  onSave,
}: {
  item: WorkoutItem;
  weightUnit: OwnProfile["weightUnit"];
  onClose: () => void;
  onSave: (item: WorkoutItem) => Promise<void>;
}) {
  const [mode, setMode] = useState<EntryMode>(item.mode);
  const [entries, setEntries] = useState<PrescriptionDraftEntry[]>(() =>
    prescriptionDraftEntries(item.mode, item.prescription, weightUnit),
  );
  const initialEntries = prescriptionDraftEntries(
    item.mode,
    item.prescription,
    weightUnit,
  );
  const [perEntry, setPerEntry] = useState<Record<PerEntryField, boolean>>(
    () => ({
      reps: initialEntries.some((entry) => entry.reps !== initialEntries[0]?.reps),
      load: initialEntries.some((entry) => entry.load !== initialEntries[0]?.load),
      rpe: initialEntries.some((entry) => entry.rpe !== initialEntries[0]?.rpe),
      work: initialEntries.some((entry) => entry.work !== initialEntries[0]?.work),
      rest: initialEntries.some((entry) => entry.rest !== initialEntries[0]?.rest),
    }),
  );
  const [note, setNote] = useState(
    [item.cue, item.prescription.targetText].filter(Boolean).join("\n"),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const entryCount = entries.length;
  const entryLabel = mode === "intervals" ? "Per round" : "Per set";
  function numberOrUndefined(value: string) {
    const parsed = Number(value);
    return value.trim() && Number.isFinite(parsed) ? parsed : undefined;
  }
  function changeEntryCount(value: string) {
    const count = Math.min(30, Math.max(1, Math.trunc(Number(value) || 1)));
    setEntries((previous) =>
      Array.from({ length: count }, (_, index) =>
        previous[index] ?? previous.at(-1) ?? prescriptionDraftEntry(undefined, item.prescription, weightUnit),
      ),
    );
  }
  function updateEntry(
    index: number,
    field: keyof PrescriptionDraftEntry,
    value: string,
  ) {
    setEntries((previous) =>
      previous.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, [field]: value } : entry,
      ),
    );
  }
  function updateShared(field: PerEntryField, value: string) {
    setPerEntry((previous) => ({ ...previous, [field]: false }));
    setEntries((previous) =>
      previous.map((entry) => ({ ...entry, [field]: value })),
    );
  }
  function togglePerEntry(field: PerEntryField, checked: boolean) {
    setPerEntry((previous) => ({ ...previous, [field]: checked }));
  }
  function resetForMode(nextMode: EntryMode) {
    setMode(nextMode);
    setEntries(prescriptionDraftEntries(nextMode, item.prescription, weightUnit));
    setPerEntry({ reps: false, load: false, rpe: false, work: false, rest: false });
  }
  async function save() {
    setSaving(true);
    setError("");
    const nextFields = workoutLogFields(mode);
    const savedEntries: PrescriptionEntry[] = entries.map((entry) => ({
      reps: entry.reps.trim() || undefined,
      loadKg: numberOrUndefined(weightKgValue(entry.load, weightUnit)),
      durationMinutes: numberOrUndefined(entry.duration),
      distance: numberOrUndefined(entry.distance),
      distanceUnit: "km",
      workSeconds: numberOrUndefined(entry.work),
      restSeconds: numberOrUndefined(entry.rest),
      targetRpe: wholeRpe(entry.rpe) || undefined,
    }));
    const firstEntry = savedEntries[0] ?? {};
    const nextItem: WorkoutItem = {
      ...item,
      cue: note.trim(),
      mode,
      fields: nextFields,
      prescription:
        mode === "sets"
          ? {
              sets: entryCount,
              reps: firstEntry.reps,
              loadKg: firstEntry.loadKg,
              targetRpe: firstEntry.targetRpe,
              entries: savedEntries,
            }
          : mode === "intervals"
            ? {
                rounds: entryCount,
                workSeconds: firstEntry.workSeconds,
                restSeconds: firstEntry.restSeconds,
                targetRpe: firstEntry.targetRpe,
                entries: savedEntries,
              }
            : mode === "result"
              ? {
                  durationMinutes: firstEntry.durationMinutes,
                  distance: firstEntry.distance,
                  distanceUnit: "km",
                  targetRpe: firstEntry.targetRpe,
                  entries: savedEntries,
                }
              : {},
    };
    try {
      await onSave(nextItem);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "The prescription could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <ModalShell
      title={`Prescribe ${item.title}`}
      description="Set the planned target here. The athlete records actual reps, weight and effort during the workout."
      onClose={onClose}
    >
      <div className="form-grid prescription-form">
        <label className="form-field full">
          <span>Prescription type</span>
          <select
            value={mode}
            onChange={(event) => resetForMode(event.target.value as EntryMode)}
          >
            <option value="sets">Sets and repetitions</option>
            <option value="result">Time, distance or result</option>
            <option value="intervals">Intervals</option>
            <option value="none">Instructions only</option>
          </select>
        </label>
        {mode === "sets" && (
          <>
            <label className="form-field">
              <span>Sets</span>
              <input
                type="number"
              min="1"
              max="30"
                value={entryCount}
                onChange={(event) => changeEntryCount(event.target.value)}
              />
            </label>
            <label className="form-field">
              <FieldLabel
                label="Reps"
                perEntryLabel={entryLabel}
                checked={perEntry.reps}
                onToggle={(checked) => togglePerEntry("reps", checked)}
              />
              {perEntry.reps ? (
                <PerEntryValue label={entryLabel} />
              ) : (
                <input
                  value={entries[0]?.reps ?? ""}
                  onChange={(event) => updateShared("reps", event.target.value)}
                  placeholder="5 or 8–10"
                />
              )}
            </label>
            <label className="form-field">
              <FieldLabel
                label={`Target weight (${weightUnit})`}
                optional
                perEntryLabel={entryLabel}
                checked={perEntry.load}
                onToggle={(checked) => togglePerEntry("load", checked)}
              />
              {perEntry.load ? (
                <PerEntryValue label={entryLabel} />
              ) : (
                <input
                  inputMode="decimal"
                  value={entries[0]?.load ?? ""}
                  onChange={(event) => updateShared("load", event.target.value)}
                  placeholder="Optional"
                />
              )}
            </label>
            <div className="form-field planned-rpe-field">
              <FieldLabel
                label="Planned effort"
                optional
                perEntryLabel={entryLabel}
                checked={perEntry.rpe}
                onToggle={(checked) => togglePerEntry("rpe", checked)}
              />
              {perEntry.rpe ? (
                <PerEntryValue label={entryLabel} />
              ) : (
                <PlannedRpeSelect
                  value={entries[0]?.rpe ?? ""}
                  onChange={(value) => updateShared("rpe", value)}
                />
              )}
            </div>
            <PrescriptionEntryTable
              label="Set plan"
              rows={entries}
              weightUnit={weightUnit}
              fields={["reps", "load", "rpe"]}
              editable={perEntry}
              onChange={updateEntry}
            />
          </>
        )}
        {mode === "result" && (
          <>
            <label className="form-field">
              <span>Target duration (minutes)</span>
              <input
                type="number"
                min="0"
                value={entries[0]?.duration ?? ""}
                onChange={(event) => updateEntry(0, "duration", event.target.value)}
              />
            </label>
            <label className="form-field">
              <span>Target distance (km)</span>
              <input
                type="number"
                min="0"
                step="0.1"
                value={entries[0]?.distance ?? ""}
                onChange={(event) => updateEntry(0, "distance", event.target.value)}
              />
            </label>
          </>
        )}
        {mode === "intervals" && (
          <>
            <label className="form-field">
              <span>Rounds</span>
              <input
                type="number"
                min="1"
                value={entryCount}
                onChange={(event) => changeEntryCount(event.target.value)}
              />
            </label>
            <label className="form-field">
              <FieldLabel
                label="Work"
                perEntryLabel={entryLabel}
                checked={perEntry.work}
                onToggle={(checked) => togglePerEntry("work", checked)}
              />
              {perEntry.work ? (
                <PerEntryValue label={entryLabel} />
              ) : (
                <input
                  inputMode="numeric"
                  value={entries[0]?.work ?? ""}
                  onChange={(event) => updateShared("work", event.target.value)}
                />
              )}
            </label>
            <label className="form-field">
              <FieldLabel
                label="Rest"
                perEntryLabel={entryLabel}
                checked={perEntry.rest}
                onToggle={(checked) => togglePerEntry("rest", checked)}
              />
              {perEntry.rest ? (
                <PerEntryValue label={entryLabel} />
              ) : (
                <input
                  inputMode="numeric"
                  value={entries[0]?.rest ?? ""}
                  onChange={(event) => updateShared("rest", event.target.value)}
                />
              )}
            </label>
            <div className="form-field planned-rpe-field">
              <FieldLabel
                label="Planned effort"
                optional
                perEntryLabel={entryLabel}
                checked={perEntry.rpe}
                onToggle={(checked) => togglePerEntry("rpe", checked)}
              />
              {perEntry.rpe ? (
                <PerEntryValue label={entryLabel} />
              ) : (
                <PlannedRpeSelect
                  value={entries[0]?.rpe ?? ""}
                  onChange={(value) => updateShared("rpe", value)}
                />
              )}
            </div>
            <PrescriptionEntryTable
              label="Round plan"
              rows={entries}
              weightUnit={weightUnit}
              fields={["work", "rest", "rpe"]}
              editable={perEntry}
              onChange={updateEntry}
            />
          </>
        )}
        {mode === "result" && (
          <div className="form-field full planned-rpe-field">
            <span>Planned effort <em>optional</em></span>
            <small>
              This guides effort alongside an exact weight target. The athlete
              records actual RPE while training.
            </small>
            <PlannedRpeSelect
              value={entries[0]?.rpe ?? ""}
              onChange={(value) => updateEntry(0, "rpe", value)}
            />
          </div>
        )}
        <label className="form-field full">
          <span>
            Notes <em>optional</em>
          </span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Technique cues, tempo, substitutions…"
          />
        </label>
      </div>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button className="button secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button primary"
          disabled={
            saving ||
            ((mode === "sets" || mode === "intervals") && entryCount < 1)
          }
          onClick={save}
        >
          {saving ? "Saving…" : "Save prescription"}
        </button>
      </div>
    </ModalShell>
  );
}

function FieldLabel({
  label,
  optional = false,
  perEntryLabel,
  checked,
  onToggle,
}: {
  label: string;
  optional?: boolean;
  perEntryLabel: string;
  checked: boolean;
  onToggle: (checked: boolean) => void;
}) {
  return (
    <span className="prescription-field-label">
      <label className="per-entry-toggle">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onToggle(event.target.checked)}
        />
        <i aria-hidden />
        <small>{perEntryLabel}</small>
      </label>
      <b>{label}</b>
      {optional && <em>optional</em>}
    </span>
  );
}

function PerEntryValue({ label }: { label: string }) {
  return (
    <div className="per-entry-value">
      <Settings2 size={13} />
      {label}
    </div>
  );
}

function PrescriptionEntryTable({
  label,
  rows,
  weightUnit,
  fields,
  editable,
  onChange,
}: {
  label: string;
  rows: PrescriptionDraftEntry[];
  weightUnit: OwnProfile["weightUnit"];
  fields: PerEntryField[];
  editable: Record<PerEntryField, boolean>;
  onChange: (index: number, field: keyof PrescriptionDraftEntry, value: string) => void;
}) {
  return (
    <div className="prescription-entry-table full">
      <div className="prescription-entry-heading">
        <strong>{label}</strong>
        <small>Choose “Per set” or “Per round” above to edit a column.</small>
      </div>
      <div className="prescription-entry-grid">
        <div
          className="prescription-entry-row prescription-entry-header"
          style={{ gridTemplateColumns: `36px repeat(${fields.length}, minmax(0, 1fr))` }}
        >
          <span>#</span>
          {fields.map((field) => (
            <span key={field}>
              {field === "load" ? `Weight (${weightUnit})` : field === "rpe" ? "Planned RPE" : field[0].toUpperCase() + field.slice(1)}
            </span>
          ))}
        </div>
        {rows.map((row, index) => (
          <div
            className="prescription-entry-row"
            key={index}
            style={{ gridTemplateColumns: `36px repeat(${fields.length}, minmax(0, 1fr))` }}
          >
            <span>{index + 1}</span>
            {fields.map((field) =>
              field === "rpe" ? (
                <PlannedRpeSelect
                  key={field}
                  disabled={!editable.rpe}
                  value={row.rpe}
                  onChange={(value) => onChange(index, "rpe", value)}
                />
              ) : (
                <input
                  key={field}
                  disabled={!editable[field]}
                  inputMode={field === "load" ? "decimal" : field === "reps" ? "text" : "numeric"}
                  value={row[field]}
                  onChange={(event) => onChange(index, field, event.target.value)}
                />
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function DeactivateProgramModal({
  programTitle,
  onClose,
  onConfirm,
}: {
  programTitle: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function confirm() {
    setSaving(true);
    setError("");
    try {
      await onConfirm();
    } catch (deactivateError) {
      setError(
        deactivateError instanceof Error
          ? deactivateError.message
          : "The program could not be deactivated.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <ModalShell
      title="Deactivate this program?"
      description={`${programTitle} will stop being your current plan.`}
      onClose={onClose}
    >
      <div className="invite-permissions">
        <span>
          <Check size={14} />
          Completed workout history is preserved
        </span>
        <span>
          <Check size={14} />
          Future scheduled workouts from this plan are removed
        </span>
        <span>
          <BookOpen size={14} />
          You can choose a library program or create a new one next
        </span>
      </div>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button className="button secondary" onClick={onClose}>
          Keep current program
        </button>
        <button className="button danger" disabled={saving} onClick={confirm}>
          {saving ? "Deactivating…" : "Deactivate program"}
        </button>
      </div>
    </ModalShell>
  );
}

function InviteModal({
  onClose,
  onResolve,
  onInvite,
}: {
  onClose: () => void;
  onResolve: (identifier: string) => Promise<CoachInviteTarget>;
  onInvite: (identifier: string) => Promise<CoachInviteReceipt>;
}) {
  const [identifier, setIdentifier] = useState("");
  const [target, setTarget] = useState<CoachInviteTarget | null>(null);
  const [receipt, setReceipt] = useState<CoachInviteReceipt | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function resolveTarget() {
    setSending(true);
    setError("");
    try {
      setTarget(await onResolve(identifier.trim()));
    } catch (inviteError) {
      setError(
        inviteError instanceof Error
          ? inviteError.message
          : "That account could not be found.",
      );
    } finally {
      setSending(false);
    }
  }

  async function createRequest() {
    setSending(true);
    setError("");
    try {
      setReceipt(await onInvite(identifier.trim()));
    } catch (inviteError) {
      setError(
        inviteError instanceof Error
          ? inviteError.message
          : "The invitation could not be created.",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <ModalShell
      title="Invite a coach"
      description="Use their exact email or private LiftLog ID. There is no public account directory."
      onClose={onClose}
      dismissible={!sending}
    >
      {receipt ? (
        <>
          <div className="invite-success" role="status">
            <span>
              <Check size={20} />
            </span>
            <div>
              <strong>Request sent to {receipt.targetName}</strong>
              <p>
                It now appears under Coaching requests in their My athletes
                workspace.
                They can accept or decline it there.
              </p>
            </div>
          </div>
          <div className="modal-actions">
            <button className="button primary" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      ) : target ? (
        <>
          <div className="invite-target-confirm">
            <PersonAvatar initials={getInitials(target.displayName)} name={target.displayName} size="large" />
            <div>
              <small>Confirm coach</small>
              <strong>{target.displayName}</strong>
              <span>
                {target.identifierType === "id"
                  ? target.liftlogId
                  : identifier.trim()}
              </span>
            </div>
          </div>
          {!target.registered && (
            <p className="form-info">
              <LockKeyhole size={15} />
              This person needs a registered LiftLog account before an in-app
              request can be sent.
            </p>
          )}
          <div className="invite-permissions">
            <span>
              <Check size={14} />
              View your calendar, reports, and workout notes
            </span>
            <span>
              <Check size={14} />
              Create and publish future program content
            </span>
            <span>
              <LockKeyhole size={14} />
              Cannot schedule workouts or change completed logs
            </span>
          </div>
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button
              className="button secondary"
              disabled={sending}
              onClick={() => {
                setTarget(null);
                setError("");
              }}
            >
              Back
            </button>
            <button
              className="button primary"
              disabled={sending || !target.registered}
              onClick={createRequest}
            >
              {sending ? (
                <>
                  <LoaderCircle className="button-spinner" size={15} />
                  Sending…
                </>
              ) : (
                "Send coaching request"
              )}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="invite-permissions">
            <span>
              <Check size={14} />
              Exact match only—no name search
            </span>
            <span>
              <Check size={14} />
              Registered email or LiftLog ID
            </span>
            <span>
              <LockKeyhole size={14} />
              Unrelated accounts remain private
            </span>
          </div>
          <label className="form-field full">
            <span>Email address or LiftLog ID</span>
            <input
              value={identifier}
              onChange={(event) => {
                setIdentifier(event.target.value);
                setError("");
              }}
              placeholder="coach@example.com or LL-…"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button
              className="button secondary"
              disabled={sending}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="button primary"
              disabled={identifier.trim().length < 4 || sending}
              onClick={resolveTarget}
            >
              {sending ? "Checking…" : "Continue"}
            </button>
          </div>
        </>
      )}
    </ModalShell>
  );
}

function AssignProgramModal({
  programs,
  athletes,
  initialProgramId,
  initialAthleteIds = [],
  onClose,
  onAssign,
  onAssignQuickWorkout,
}: {
  programs: Program[];
  athletes: AthleteSummary[];
  initialProgramId?: string;
  initialAthleteIds?: string[];
  onClose: () => void;
  onAssign: (
    programId: string,
    athleteIds: string[],
  ) => Promise<ProgramAssignment[]>;
  onAssignQuickWorkout: (
    programId: string,
    athleteIds: string[],
    plannedDate: string,
  ) => Promise<ProgramAssignment[]>;
}) {
  const lockedProgram = Boolean(initialProgramId);
  const lockedAthletes = !initialProgramId && initialAthleteIds.length === 1;
  const [programId, setProgramId] = useState(
    initialProgramId ?? programs[0]?.id ?? "",
  );
  const [athleteIds, setAthleteIds] = useState(
    () => new Set(initialAthleteIds),
  );
  const [saving, setSaving] = useState(false);
  const [plannedDate, setPlannedDate] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return localDateOnly(tomorrow);
  });
  const savingRef = useRef(false);
  const [error, setError] = useState("");
  const selectedProgram = programs.find(
    (candidate) => candidate.id === programId,
  );
  const selectedAthletes = athletes.filter((athlete) =>
    athleteIds.has(athlete.id),
  );
  const quickWorkout = selectedProgram?.contentType === "quick_workout";

  function toggleAthlete(athleteId: string) {
    setAthleteIds((previous) => {
      const next = new Set(previous);
      if (next.has(athleteId)) next.delete(athleteId);
      else next.add(athleteId);
      return next;
    });
  }

  async function assign() {
    if (!programId || !athleteIds.size || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      if (quickWorkout) {
        await onAssignQuickWorkout(programId, [...athleteIds], plannedDate);
      } else {
        await onAssign(programId, [...athleteIds]);
      }
    } catch (assignmentError) {
      setError(
        assignmentError instanceof Error
          ? assignmentError.message
          : "The program could not be assigned.",
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <ModalShell
      title={quickWorkout ? "Assign and schedule workout" : "Assign a program"}
      description={
        quickWorkout
          ? "Each athlete receives an independent copy and the session is placed on the date you choose."
          : "Each athlete receives an independent copy. Their calendar stays unchanged until they schedule workouts."
      }
      onClose={onClose}
      dismissible={!saving}
      wide
    >
      {!programs.length ? (
        <div className="empty-state modal-empty compact">
          <Dumbbell size={26} />
          <h3>No finished Own programs</h3>
          <p>Finish an Own program before assigning it to an athlete.</p>
          <button className="button secondary" onClick={onClose}>
            Close
          </button>
        </div>
      ) : !athletes.length ? (
        <div className="empty-state modal-empty compact">
          <Users size={26} />
          <h3>No active athletes</h3>
          <p>Accept a coaching request before assigning a program.</p>
          <button className="button secondary" onClick={onClose}>
            Close
          </button>
        </div>
      ) : (
        <>
          <div className="assignment-grid">
            <div className="assignment-step">
              <div className="assignment-step-heading">
                <span>1</span>
                <div>
                  <strong>{quickWorkout ? "Quick workout" : "Own program"}</strong>
                  <small>
                    {quickWorkout
                      ? "This one session will be scheduled for every athlete"
                      : "Only finished programs can be assigned"}
                  </small>
                </div>
              </div>
              {lockedProgram && selectedProgram ? (
                <div className="assignment-program-summary">
                  <Dumbbell size={17} />
                  <div>
                    <strong>{selectedProgram.title}</strong>
                    <small>
                      {programWeekCount(selectedProgram)}{" "}
                      {programWeekCount(selectedProgram) === 1 ? "week" : "weeks"} ·{" "}
                      {programWorkoutCount(selectedProgram)}{" "}
                      workouts
                    </small>
                  </div>
                  <Check size={16} />
                </div>
              ) : (
                <label className="form-field full">
                  <span>Choose a program</span>
                  <select
                    value={programId}
                    disabled={saving}
                    onChange={(event) => setProgramId(event.target.value)}
                  >
                    {programs.map((candidate) => (
                      <option value={candidate.id} key={candidate.id}>
                        {candidate.title} ·{" "}
                        {programWorkoutCount(candidate)}{" "}
                        workouts
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            {quickWorkout && (
              <div className="assignment-step">
                <div className="assignment-step-heading">
                  <span>3</span>
                  <div>
                    <strong>Schedule date</strong>
                    <small>All selected athletes get this session on this day</small>
                  </div>
                </div>
                <label className="form-field full">
                  <span>Date</span>
                  <input
                    type="date"
                    value={plannedDate}
                    disabled={saving}
                    onChange={(event) => setPlannedDate(event.target.value)}
                  />
                </label>
              </div>
            )}
            <div className="assignment-step">
              <div className="assignment-step-heading">
                <span>2</span>
                <div>
                  <strong>{lockedAthletes ? "Athlete" : "Athletes"}</strong>
                  <small>
                    {lockedAthletes
                      ? "Assigning from My athletes"
                      : "Choose one or more people you coach"}
                  </small>
                </div>
              </div>
              {lockedAthletes ? (
                selectedAthletes.map((athlete) => (
                  <div className="assignment-athlete-summary" key={athlete.id}>
                    <span className="avatar">{athlete.initials}</span>
                    <div>
                      <strong>{athlete.name}</strong>
                      <small>
                        {athlete.assignedPrograms.length
                          ? athlete.assignedPrograms.length +
                            (athlete.assignedPrograms.length === 1
                              ? " program from you"
                              : " programs from you")
                          : "No programs from you yet"}
                      </small>
                    </div>
                    <Check size={16} />
                  </div>
                ))
              ) : (
                <div className="assignment-athlete-list">
                  {athletes.map((athlete) => (
                    <label key={athlete.id}>
                      <input
                        type="checkbox"
                        checked={athleteIds.has(athlete.id)}
                        disabled={saving}
                        onChange={() => toggleAthlete(athlete.id)}
                      />
                      <span className="avatar">{athlete.initials}</span>
                      <span>
                        <strong>{athlete.name}</strong>
                        <small>
                          {athlete.assignedPrograms.length
                            ? athlete.assignedPrograms.length +
                              (athlete.assignedPrograms.length === 1
                                ? " program from you"
                                : " programs from you")
                            : "No programs from you yet"}
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
          {saving && (
            <div className="assignment-progress" role="status">
              <LoaderCircle className="button-spinner" size={17} />
              <span>
                {quickWorkout
                  ? "Scheduling workout for selected athletes"
                  : "Creating independent program"}{" "}
                {athleteIds.size === 1 ? "copy" : "copies"}…
              </span>
            </div>
          )}
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions assignment-actions">
            <button
              className="button secondary"
              disabled={saving}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="button primary"
              disabled={!programId || !athleteIds.size || !plannedDate || saving}
              onClick={assign}
            >
              {saving ? (
                <>
                  <LoaderCircle className="button-spinner" size={15} />
                  {quickWorkout ? "Scheduling…" : "Assigning…"}
                </>
              ) : (
                <>
                  <UserPlus size={15} />
                  {quickWorkout ? "Assign & schedule" : "Assign to"}{" "}
                  {athleteIds.size || 0}{" "}
                  {athleteIds.size === 1 ? "athlete" : "athletes"}
                </>
              )}
            </button>
          </div>
        </>
      )}
    </ModalShell>
  );
}

function CopyWeekModal({
  weekIndex,
  nextWeekIndex,
  maxCopies,
  onClose,
  onCopy,
}: {
  weekIndex: number;
  nextWeekIndex: number;
  maxCopies: number;
  onClose: () => void;
  onCopy: (count: number) => Promise<boolean>;
}) {
  const initialCount = Math.min(3, maxCopies);
  const [count, setCount] = useState(Math.max(2, initialCount));
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState("");
  const validCount =
    Number.isInteger(count) && count >= 2 && count <= maxCopies;
  const finalWeekIndex = nextWeekIndex + Math.max(count, 1) - 1;

  async function copy() {
    if (!validCount || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const completed = await onCopy(count);
      if (completed) onClose();
      else setError("The week could not be copied. Try again.");
    } catch (copyError) {
      setError(
        copyError instanceof Error
          ? copyError.message
          : "The week could not be copied.",
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <ModalShell
      title={`Copy Week ${weekIndex}`}
      description="Create several independent weeks in one step. You can adjust every copy afterward."
      onClose={onClose}
      dismissible={!saving}
    >
      <div className="copy-week-preview">
        <span className="program-icon">
          <Copy size={19} />
        </span>
        <div>
          <small>Source</small>
          <strong>Week {weekIndex}</strong>
        </div>
        <ArrowRight size={17} />
        <div>
          <small>New weeks</small>
          <strong>
            {validCount
              ? `Weeks ${nextWeekIndex}–${finalWeekIndex}`
              : "Choose a valid quantity"}
          </strong>
        </div>
      </div>
      <label className="form-field full copy-week-count">
        <span>Number of copies</span>
        <input
          type="number"
          inputMode="numeric"
          min={2}
          max={maxCopies}
          step={1}
          value={count}
          disabled={saving}
          onChange={(event) => setCount(Number(event.target.value))}
        />
        <small>
          This program can contain up to 52 weeks. You can add {maxCopies} more.
        </small>
      </label>
      {saving && (
        <div className="assignment-progress" role="status">
          <LoaderCircle className="button-spinner" size={17} />
          <span>
            Creating {count} independent {count === 1 ? "week" : "weeks"}…
          </span>
        </div>
      )}
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions copy-week-actions">
        <button
          className="button secondary"
          disabled={saving}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          className="button primary"
          disabled={!validCount || saving}
          onClick={copy}
        >
          {saving ? (
            <>
              <LoaderCircle className="button-spinner" size={15} />
              Creating weeks…
            </>
          ) : (
            <>
              <Copy size={15} />
              Create {validCount ? count : ""} copies
            </>
          )}
        </button>
      </div>
    </ModalShell>
  );
}

function ProgramModal({
  targetName,
  kind = "program",
  onClose,
  onSave,
}: {
  targetName: string;
  kind?: "program" | "workout";
  onClose: () => void;
  onSave: (title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState("");
  async function save() {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      await onSave(title.trim());
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "The program could not be created.",
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  return (
    <ModalShell
      title={
        kind === "workout"
          ? "Create a quick workout"
          : `Create a program for ${targetName}`
      }
      description={
        kind === "workout"
          ? "Create one session, then schedule it for yourself or assign it to athletes."
          : "Start with one empty week. Workouts are ordered here and scheduled later by the athlete."
      }
      onClose={onClose}
    >
      <div className="form-grid">
        <label className="form-field full">
          <span>{kind === "workout" ? "Workout name" : "Program name"}</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={
              kind === "workout"
                ? "e.g. Friday conditioning"
                : "e.g. Two-day general fitness"
            }
          />
        </label>
        {kind === "program" && <div className="form-info full">
          <CalendarDays size={16} />
          <span>
            Start with Week 1, then use the + week tab to add a blank week or
            copy any week as many times as you need.
          </span>
        </div>}
      </div>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button className="button secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button primary"
          disabled={!title.trim() || saving}
          onClick={save}
        >
          {saving ? "Creating…" : kind === "workout" ? "Create workout" : "Create program"}
        </button>
      </div>
    </ModalShell>
  );
}

function ScheduleModal({
  schedules,
  editingId,
  initialDate,
  preparing,
  onClose,
  onSave,
}: {
  schedules: ScheduledWorkout[];
  editingId: string | null;
  initialDate: string | null;
  preparing: boolean;
  onClose: () => void;
  onSave: (scheduleId: string, date: string | null) => Promise<void>;
}) {
  const candidates = schedules.filter(
    (schedule) => schedule.status === "planned",
  );
  const initial =
    candidates.find((schedule) => schedule.id === editingId) ??
    candidates.find((schedule) => !schedule.plannedDate) ??
    candidates[0];
  const [scheduleId, setScheduleId] = useState(initial?.id ?? "");
  const [date, setDate] = useState(
    initial?.plannedDate ?? initialDate ?? localDateOnly(),
  );
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [savingAction, setSavingAction] = useState<
    "add" | "reschedule" | "unschedule" | null
  >(null);
  const [error, setError] = useState("");
  const selected = candidates.find((schedule) => schedule.id === scheduleId);
  const originalDate = selected?.plannedDate ?? "";
  const action = originalDate
    ? !date
      ? "unschedule"
      : date !== originalDate
        ? "reschedule"
        : "unschedule"
    : "add";
  async function save(
    nextDate: string | null,
    nextAction: "add" | "reschedule" | "unschedule",
  ) {
    if (!scheduleId || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSavingAction(nextAction);
    setError("");
    try {
      await onSave(scheduleId, nextDate);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "The date could not be updated.",
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
      setSavingAction(null);
    }
  }
  return (
    <ModalShell
      title={originalDate ? "Update a workout date" : "Schedule a workout"}
      description="These dates belong to you. Your coach can see them but cannot change them."
      onClose={onClose}
      dismissible={!preparing && !saving}
    >
      {preparing ? (
        <div className="schedule-preparing" role="status">
          <LoaderCircle size={24} className="button-spinner" />
          <div>
            <strong>Preparing calendar…</strong>
            <span>Making your published workouts available to schedule.</span>
          </div>
        </div>
      ) : candidates.length ? (
        <>
          <div className="form-grid">
            <label className="form-field full">
              <span>Program workout</span>
              <select
                value={scheduleId}
                disabled={Boolean(editingId) || saving}
                onChange={(event) => {
                  const next = candidates.find(
                    (schedule) => schedule.id === event.target.value,
                  );
                  setScheduleId(event.target.value);
                  setDate(next?.plannedDate ?? localDateOnly());
                }}
              >
                {candidates.map((schedule) => (
                  <option value={schedule.id} key={schedule.id}>
                    {schedule.slotLabel} · {schedule.workoutTitle}
                    {schedule.plannedDate ? ` · ${schedule.plannedDate}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field full">
              <span>Date</span>
              <input
                type="date"
                value={date}
                disabled={saving}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
          </div>
          <div className="form-info">
            <LockKeyhole size={15} />
            <span>Only your account can assign or move this date.</span>
          </div>
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions schedule-actions">
            <button
              className="button secondary"
              disabled={saving}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className={cn(
                "button",
                action === "unschedule" ? "danger" : "primary",
              )}
              disabled={(action !== "unschedule" && !date) || saving}
              onClick={() =>
                save(action === "unschedule" ? null : date, action)
              }
            >
              {saving && <LoaderCircle size={15} className="button-spinner" />}
              {saving
                ? savingAction === "unschedule"
                  ? "Unscheduling…"
                  : savingAction === "reschedule"
                    ? "Rescheduling…"
                    : "Adding…"
                : action === "unschedule"
                  ? "Unschedule"
                  : action === "reschedule"
                    ? "Reschedule"
                    : "Add to calendar"}
            </button>
          </div>
        </>
      ) : (
        <div className="empty-state modal-empty">
          <CalendarDays size={26} />
          <h3>No workouts available to schedule</h3>
          <p>
            Add a finished program to your scheduling choices. Completed
            programs can be added again whenever you want to run them another
            time.
          </p>
          <button className="button secondary" onClick={onClose}>
            Close
          </button>
        </div>
      )}
    </ModalShell>
  );
}

function AccountModal({
  profile,
  email,
  onClose,
  onSave,
  onSignOut,
}: {
  profile: OwnProfile;
  email: string;
  onClose: () => void;
  onSave: (
    firstName: string,
    lastName: string,
    weekStartsOnSunday: boolean,
    weightUnit: OwnProfile["weightUnit"],
    distanceUnit: OwnProfile["distanceUnit"],
  ) => Promise<void>;
  onSignOut: () => void;
}) {
  const [firstName, setFirstName] = useState(profile.firstName);
  const [lastName, setLastName] = useState(profile.lastName);
  const [weekStartsOnSunday, setWeekStartsOnSunday] = useState(
    profile.weekStartsOnSunday,
  );
  const [weightUnit, setWeightUnit] = useState(profile.weightUnit);
  const [distanceUnit, setDistanceUnit] = useState(profile.distanceUnit);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setSaving(true);
    setError("");
    try {
      await onSave(
        firstName.trim(),
        lastName.trim(),
        weekStartsOnSunday,
        weightUnit,
        distanceUnit,
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Your account could not be updated.",
      );
    } finally {
      setSaving(false);
    }
  }
  async function copyId() {
    const success = await copyText(profile.liftlogId);
    setCopied(success);
    if (!success)
      setError(
        "Copy was unavailable. Select the LiftLog ID and copy it manually.",
      );
  }
  return (
    <ModalShell
      title="My account"
      description="Only you can open and edit these account details."
      onClose={onClose}
    >
      <div className="account-identity">
        <span className="avatar large">
          {profile.displayName
            .split(/\s+/)
            .map((part) => part[0])
            .slice(0, 2)
            .join("")}
        </span>
        <div>
          <strong>{profile.displayName}</strong>
          <small>Private LiftLog account</small>
        </div>
      </div>
      <div className="form-grid">
        <label className="form-field">
          <span>First name</span>
          <input
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            autoComplete="given-name"
          />
        </label>
        <label className="form-field">
          <span>Surname</span>
          <input
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            autoComplete="family-name"
          />
        </label>
        <label className="form-field full">
          <span>Login email</span>
          <input value={email} readOnly />
        </label>
        <label className="form-field full">
          <span>LiftLog ID</span>
          <div className="copy-field">
            <input
              value={profile.liftlogId}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
            />
            <button className="button secondary" onClick={copyId}>
              <Copy size={15} />
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <small>
            Share this ID privately when someone wants to invite you as their
            coach.
          </small>
        </label>
      </div>
      <section className="account-settings" aria-labelledby="user-settings-title">
        <div className="account-settings-heading">
          <p>Preferences</p>
          <h3 id="user-settings-title">User settings</h3>
        </div>
        <div className="account-settings-grid">
          <label className="form-field">
            <span>Week starts on</span>
            <select
              value={weekStartsOnSunday ? "sunday" : "monday"}
              onChange={(event) =>
                setWeekStartsOnSunday(event.target.value === "sunday")
              }
            >
              <option value="monday">Monday</option>
              <option value="sunday">Sunday</option>
            </select>
          </label>
          <label className="form-field">
            <span>Weight</span>
            <select
              value={weightUnit}
              onChange={(event) =>
                setWeightUnit(event.target.value as OwnProfile["weightUnit"])
              }
            >
              <option value="kg">Kilograms (kg)</option>
              <option value="lb">Pounds (lb)</option>
            </select>
          </label>
          <label className="form-field">
            <span>Distance</span>
            <select
              value={distanceUnit}
              onChange={(event) =>
                setDistanceUnit(
                  event.target.value as OwnProfile["distanceUnit"],
                )
              }
            >
              <option value="km">Kilometres (km)</option>
              <option value="mi">Miles (mi)</option>
            </select>
          </label>
        </div>
      </section>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions account-actions">
        <button className="text-button danger-text" onClick={onSignOut}>
          <LogOut size={15} />
          Sign out
        </button>
        <button className="button secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button primary"
          disabled={!firstName.trim() || saving}
          onClick={save}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </ModalShell>
  );
}
