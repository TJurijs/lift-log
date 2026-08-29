import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BicepsFlexed,
  BookOpen,
  CalendarDays,
  CalendarMinus,
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
  Info,
  LayoutDashboard,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  MessageSquareText,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  memo,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type {
  ActiveSession,
  AthleteSummary,
  CalendarWorkspaceData,
  CoachAgendaEntry,
  CoachAthleteCursor,
  CoachAssignedProgramSummary,
  CoachConnection,
  CoachingWorkspaceData,
  CoachInviteReceipt,
  CoachInviteTarget,
  CompletedSession,
  CompletedSessionDetail,
  EntryMode,
  Exercise,
  ExerciseCursor,
  ExerciseDiscipline,
  OwnProfile,
  OutgoingCoachInvite,
  PendingCoachInvite,
  PlannedWorkout,
  PrescriptionEntry,
  Program,
  ProgramAssignment,
  ProgramCursor,
  ScheduledWorkout,
  SchedulableWorkoutCandidate,
  SchedulableWorkoutCursor,
  SessionSetValue,
  TrackingField,
  ViewName,
  WorkoutItem,
  WorkoutSection,
  WorkspaceData,
} from "../lib/domain";
import { trackingFieldsForMode } from "../lib/domain";
import type { AppViewer } from "../lib/auth";
import {
  LiftLogRepository,
  SessionRevisionConflictError,
} from "../lib/repository";
import type { ActiveWorkoutDraftSnapshot } from "../lib/active-workout-draft-storage";
import type { SessionDraftSaveStatus } from "../lib/session-draft-coordinator";
import {
  deriveOccurrenceCapabilities,
  deriveTrainingContentCapabilities,
  requireCapability,
  type OccurrenceCapabilities,
  type TrainingContentCapabilities,
} from "../lib/capabilities";
import { localDateOnly } from "../lib/date-only";
import {
  cn,
  formatDuration,
  formatWorkoutCount,
  getInitials,
  sourceFromScheduledWorkout,
} from "../lib/presentation";
import {
  presentProgramProvenance,
  presentProvenance,
} from "../lib/provenance";
import {
  formatWeight,
  weightInputValue,
  weightKgValue,
} from "../lib/units";
import {
  deriveProgramRunStatus,
  deriveProgramWorkoutProgressState,
  deriveSingleWorkoutStatus,
  programRunStatusLabel,
  programWorkoutProgressLabel,
  type ProgramRunStatus,
  type ProgramWorkoutProgressState,
  type SingleWorkoutStatusSummary,
} from "../lib/program-progress";
import {
  moveProgramExercise,
  programWeekCount,
  programWorkoutCount,
  programWorkoutIds,
  reorderProgramSections,
  reorderProgramWorkouts,
} from "../lib/program-tree";
import {
  listUpcomingWorkouts,
  selectNextWorkoutFocus,
} from "../lib/workout-focus";
import { parseAppView, updateAppViewUrl } from "../lib/app-route";
import {
  AsyncButton,
  InlineError,
  ModalShell,
  PageHeader,
  PersonAvatar,
  SegmentedTabs,
  SessionSaveIndicator,
  SourceTag,
  StatusBadge,
  Toast,
  WorkoutSectionHeading,
} from "./ui-primitives";
import { useActiveWorkoutPersistence } from "./features/active-workout/useActiveWorkoutPersistence";

const CalendarView = lazy(() => import("./features/calendar/CalendarView"));
const loadProgramView = () => import("./features/programs/ProgramView");
const ProgramView = lazy(loadProgramView);

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
  | "exercise-details"
  | "workout"
  | "workout-settings"
  | "prescription"
  | "section"
  | "delete-section"
  | "delete-exercise"
  | "delete-content"
  | "invite"
  | "assign-program"
  | "program"
  | "quick-workout"
  | "deactivate-program"
  | "schedule"
  | "account"
  | null;
type ContentDeleteTarget =
  | { kind: "week"; id: string; label: string }
  | { kind: "workout"; id: string; title: string }
  | { kind: "workout-item"; id: string; title: string }
  | { kind: "program"; program: Program };
type SetLog = SessionSetValue;
const emptySetLogs: SetLog[] = [];
const emptyResultLog: Record<string, string> = {};

function mergeProgramCatalog(
  previous: WorkspaceData,
  incoming: Program[],
  reset: boolean,
): WorkspaceData {
  const ordered = reset ? [] : [...(previous.programCatalog ?? [])];
  const byId = new Map(ordered.map((program) => [program.id, program]));
  for (const nextProgram of incoming) {
    const current = byId.get(nextProgram.id);
    const merged =
      current && current.detailsLoaded !== false ? current : nextProgram;
    if (!byId.has(nextProgram.id)) ordered.push(merged);
    else {
      const index = ordered.findIndex((program) => program.id === nextProgram.id);
      if (index >= 0) ordered[index] = merged;
    }
    byId.set(nextProgram.id, merged);
  }
  const schedulablePrograms = ordered.filter(
    (program) =>
      program.versionStatus === "published" && program.sourceType !== "library",
  );
  return {
    ...previous,
    programCatalog: ordered,
    schedulablePrograms,
    schedulableProgramIds: schedulablePrograms.map((program) => program.id),
    draftProgram:
      ordered.find((program) => program.versionStatus === "draft") ?? null,
    activeProgram:
      ordered.find(
        (program) =>
          program.sourceType !== "library" &&
          program.versionStatus === "published",
      ) ?? null,
  };
}

type ProgramSourceTab = "own" | "coach";
type ProgramAction = {
  id: string;
  kind: "delete" | "publish" | "edit" | "open" | "week";
} | null;
type ExerciseLibraryFilters = {
  disciplines: ExerciseDiscipline[];
  categories: string[];
  modes: EntryMode[];
  tracking: TrackingField[];
};
type CompletedWorkoutViewState = {
  session: CompletedSession;
  detail: CompletedSessionDetail | null;
  loading: boolean;
  error: string;
  returnView: "calendar" | "coaching";
};
type DetailState =
  | {
      kind: "workout-preview";
      schedule: ScheduledWorkout;
      returnView: "today" | "calendar";
    }
  | ({ kind: "completed-workout" } & CompletedWorkoutViewState)
  | null;
type ScheduleCandidate = {
  id: string;
  scheduleId?: string;
  programId: string;
  assignmentId?: string;
  programVersionId: string;
  programTitle: string;
  workoutId: string;
  workoutTitle: string;
  scheduleLabel: string;
  estimatedMinutes: number;
  quickWorkout: boolean;
  plannedDate?: string;
};
type LazyWorkspaceFeature = "programs" | "exercises" | "calendar" | "coaching";

function prescriptionEntries(item: WorkoutItem) {
  return item.prescription.entries?.length
    ? item.prescription.entries
    : [item.prescription];
}

function intervalPrescriptionEntries(item: WorkoutItem) {
  const entries = prescriptionEntries(item);
  const roundCount = Math.max(1, item.prescription.rounds ?? entries.length);
  return Array.from(
    { length: roundCount },
    (_, index) => entries[index] ?? entries.at(-1) ?? item.prescription,
  );
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
    if (target.loadKg !== undefined)
      parts.push(`${formatWeight(target.loadKg, weightUnit)} ${weightUnit}`);
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

export function scrollToAppTop() {
  const reduceMotion = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
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
  const [activeView, setActiveView] = useState<ViewName>(() =>
    typeof window === "undefined" ? "today" : parseAppView(window.location.hash),
  );
  const [workspace, setWorkspace] = useState<WorkspaceData>(initialWorkspace);
  const [calendarRangeData, setCalendarRangeData] =
    useState<CalendarWorkspaceData>({
      scheduledWorkouts: initialWorkspace.scheduledWorkouts,
      completedSessions: initialWorkspace.completedSessions,
    });
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
  const [exerciseDeleteTarget, setExerciseDeleteTarget] =
    useState<Exercise | null>(null);
  const [contentDeleteTarget, setContentDeleteTarget] =
    useState<ContentDeleteTarget | null>(null);
  const [exerciseDetailTarget, setExerciseDetailTarget] =
    useState<Exercise | null>(null);
  const [exerciseEditing, setExerciseEditing] = useState<Exercise | null>(
    null,
  );
  const [copyingExerciseId, setCopyingExerciseId] = useState<string | null>(
    null,
  );
  const [exerciseScope, setExerciseScope] = useState<
    "global" | "personal"
  >("global");
  const [exerciseQuery, setExerciseQuery] = useState("");
  const [exerciseFilters, setExerciseFilters] =
    useState<ExerciseLibraryFilters>(() => emptyExerciseLibraryFilters());
  const [exerciseCursor, setExerciseCursor] = useState<ExerciseCursor>();
  const [exerciseSearchLoading, setExerciseSearchLoading] = useState(false);
  const [exerciseSearchError, setExerciseSearchError] = useState("");
  const [exerciseSearchRetryKey, setExerciseSearchRetryKey] = useState(0);
  const exerciseSearchRequestRef = useRef(0);
  const [modal, setModal] = useState<ModalName>(null);
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(
    initialWorkspace.activeSession,
  );
  const [workoutStarted, setWorkoutStarted] = useState(
    Boolean(initialWorkspace.activeSession),
  );
  const [activeWorkoutVisible, setActiveWorkoutVisible] = useState(
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
  const [detail, setDetail] = useState<DetailState>(null);
  const [sessionRpe, setSessionRpe] = useState(
    initialWorkspace.activeSession?.sessionRpe ?? "7",
  );
  const [sessionNote, setSessionNote] = useState(
    initialWorkspace.activeSession?.sessionNote ?? "",
  );
  const [toast, setToast] = useState("");
  const loadedWorkspaceFeaturesRef = useRef(
    new Set<LazyWorkspaceFeature>(
      repository ? [] : ["exercises", "calendar", "coaching"],
    ),
  );
  const loadingWorkspaceFeaturesRef = useRef(
    new Map<LazyWorkspaceFeature, Promise<void>>(),
  );
  const [loadingWorkspaceFeature, setLoadingWorkspaceFeature] =
    useState<LazyWorkspaceFeature | null>(null);
  const [workspaceFeatureError, setWorkspaceFeatureError] = useState<{
    feature: LazyWorkspaceFeature;
    message: string;
  } | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const notify = useCallback((message: string) => {
    if (toastTimerRef.current !== null)
      window.clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = window.setTimeout(() => {
      toastTimerRef.current = null;
      setToast("");
    }, 2600);
  }, []);
  useEffect(
    () => () => {
      if (toastTimerRef.current !== null)
        window.clearTimeout(toastTimerRef.current);
    },
    [],
  );
  useEffect(() => {
    if (!window.location.hash || parseAppView(window.location.hash) !== activeView) {
      updateAppViewUrl(activeView, "replace");
    }
    const restoreViewFromHistory = () => {
      setActiveView(parseAppView(window.location.hash));
      scrollToAppTop();
    };
    window.addEventListener("popstate", restoreViewFromHistory);
    window.addEventListener("hashchange", restoreViewFromHistory);
    return () => {
      window.removeEventListener("popstate", restoreViewFromHistory);
      window.removeEventListener("hashchange", restoreViewFromHistory);
    };
  }, [activeView]);
  const loadWorkspaceFeature = useCallback(
    (feature: LazyWorkspaceFeature) => {
      if (!repository || loadedWorkspaceFeaturesRef.current.has(feature)) {
        return Promise.resolve();
      }
      const current = loadingWorkspaceFeaturesRef.current.get(feature);
      if (current) return current;

      setLoadingWorkspaceFeature(feature);
      setWorkspaceFeatureError(null);
      const pending = (async () => {
        if (feature === "programs") {
          const page = await repository.listProgramSummaries({ limit: 25 });
          setProgramCursor(page.nextCursor);
          setWorkspace((previous) =>
            mergeProgramCatalog(previous, page.items, true),
          );
        } else if (feature === "exercises") {
          const exerciseWorkspace = await repository.loadExerciseWorkspace();
          setWorkspace((previous) => ({ ...previous, ...exerciseWorkspace }));
        } else if (feature === "calendar") {
          const calendarWorkspace = await repository.loadCalendarWorkspace();
          setWorkspace((previous) => ({ ...previous, ...calendarWorkspace }));
        } else {
          const coachingWorkspace = await repository.loadCoachingWorkspace();
          const { coachAthleteCursor: nextCursor, ...workspaceData } =
            coachingWorkspace;
          setCoachAthleteCursor(nextCursor);
          setCoachAthletesLoadError("");
          setWorkspace((previous) => ({ ...previous, ...workspaceData }));
        }
        loadedWorkspaceFeaturesRef.current.add(feature);
      })()
        .catch((error: unknown) => {
          setWorkspaceFeatureError({
            feature,
            message:
              error instanceof Error
                ? error.message
                : "This part of your workspace could not be loaded",
          });
        })
        .finally(() => {
          loadingWorkspaceFeaturesRef.current.delete(feature);
          setLoadingWorkspaceFeature((currentFeature) =>
            currentFeature === feature ? null : currentFeature,
          );
        });
      loadingWorkspaceFeaturesRef.current.set(feature, pending);
      return pending;
    },
    [repository],
  );
  useEffect(() => {
    const feature =
      activeView === "coaching"
          ? "coaching"
          : activeView === "program"
            ? "programs"
            : null;
    if (feature) void loadWorkspaceFeature(feature);
  }, [activeView, loadWorkspaceFeature]);

  const loadVisibleCalendarRange = useCallback(
    async (rangeStart: string, rangeEnd: string) => {
      if (!repository) return;
      const requestId = ++calendarRangeRequestRef.current;
      lastCalendarRangeRef.current = { start: rangeStart, end: rangeEnd };
      setCalendarRangeLoading(true);
      setCalendarRangeError("");
      try {
        const next = await repository.loadCalendarRange(rangeStart, rangeEnd);
        if (requestId !== calendarRangeRequestRef.current) return;
        setCalendarRangeData(next);
      } catch (error) {
        if (requestId === calendarRangeRequestRef.current) {
          setCalendarRangeError(
            error instanceof Error
              ? error.message
              : "This calendar month could not be loaded.",
          );
        }
      } finally {
        if (requestId === calendarRangeRequestRef.current) {
          setCalendarRangeLoading(false);
        }
      }
    },
    [repository],
  );
  const completionTokenRef = useRef<{
    sessionId: string;
    token: string;
    confirmedRevision: number;
    sessionRpe: string;
    sessionNote: string;
  } | null>(null);
  const [requestedCoachMode, setCoachMode] = useState<"athlete" | "coach">(
    "athlete",
  );
  const coachingRefreshRef = useRef(false);
  const [coachingRefreshing, setCoachingRefreshing] = useState(false);
  const [coachAthleteCursor, setCoachAthleteCursor] = useState<
    CoachAthleteCursor | undefined
  >();
  const [coachAthletesLoadingMore, setCoachAthletesLoadingMore] =
    useState(false);
  const [coachAthletesLoadError, setCoachAthletesLoadError] = useState("");
  const coachingDetailRequestsRef = useRef(new Set<string>());
  const [coachingDetailLoadingId, setCoachingDetailLoadingId] = useState<
    string | null
  >(null);
  const [selectedAthleteId, setSelectedAthleteId] = useState<string | null>(
    initialWorkspace.coachedAthletes[0]?.id ?? null,
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
  const [scheduleCandidates, setScheduleCandidates] = useState<
    SchedulableWorkoutCandidate[]
  >([]);
  const [scheduleCandidateCursor, setScheduleCandidateCursor] =
    useState<SchedulableWorkoutCursor>();
  const [scheduleCandidatesLoading, setScheduleCandidatesLoading] =
    useState(false);
  const [scheduleCandidatesError, setScheduleCandidatesError] = useState("");
  const [programCursor, setProgramCursor] = useState<ProgramCursor>();
  const [programsLoadingMore, setProgramsLoadingMore] = useState(false);
  const [programsLoadError, setProgramsLoadError] = useState("");
  const calendarRangeRequestRef = useRef(0);
  const lastCalendarRangeRef = useRef<{
    start: string;
    end: string;
  } | null>(null);
  const [calendarRangeLoading, setCalendarRangeLoading] = useState(false);
  const [calendarRangeError, setCalendarRangeError] = useState("");
  const completedWorkoutRequestRef = useRef(0);
  const [programOwnerId, setProgramOwnerId] = useState(viewer.id);
  const [requestedProgramSource, setProgramSource] =
    useState<ProgramSourceTab>("own");
  const [programAction, setProgramAction] = useState<ProgramAction>(null);
  const weekMutationRef = useRef(false);
  const builderMutationPendingRef = useRef(false);
  const [builderMutationPending, setBuilderMutationPending] = useState(false);

  const loadMorePrograms = useCallback(async () => {
    if (!repository || !programCursor || programsLoadingMore) return;
    setProgramsLoadingMore(true);
    setProgramsLoadError("");
    try {
      const page = await repository.listProgramSummaries({
        limit: 25,
        cursor: programCursor,
      });
      setProgramCursor(page.nextCursor);
      setWorkspace((previous) =>
        mergeProgramCatalog(previous, page.items, false),
      );
    } catch (error) {
      setProgramsLoadError(
        error instanceof Error
          ? error.message
          : "More programs could not be loaded.",
      );
    } finally {
      setProgramsLoadingMore(false);
    }
  }, [programCursor, programsLoadingMore, repository]);

  useEffect(() => {
    if (!repository || activeView !== "exercises") return;
    const requestId = ++exerciseSearchRequestRef.current;
    const timer = window.setTimeout(() => {
      setExerciseSearchLoading(true);
      setExerciseSearchError("");
      void repository
        .searchExercises({
          query: exerciseQuery,
          scope: exerciseScope,
          disciplines: exerciseFilters.disciplines,
          categories: exerciseFilters.categories,
          modes: exerciseFilters.modes,
          tracking: exerciseFilters.tracking,
          limit: 50,
        })
        .then((page) => {
          if (requestId !== exerciseSearchRequestRef.current) return;
          setExerciseCursor(page.nextCursor);
          setWorkspace((previous) => ({
            ...previous,
            ...(exerciseScope === "global"
              ? { globalExercises: page.items }
              : { personalExercises: page.items }),
          }));
        })
        .catch((error: unknown) => {
          if (requestId !== exerciseSearchRequestRef.current) return;
          setExerciseSearchError(
            error instanceof Error
              ? error.message
              : "The exercise library could not be searched.",
          );
        })
        .finally(() => {
          if (requestId === exerciseSearchRequestRef.current) {
            setExerciseSearchLoading(false);
          }
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    activeView,
    exerciseFilters,
    exerciseQuery,
    exerciseScope,
    exerciseSearchRetryKey,
    repository,
  ]);

  const loadMoreExercises = useCallback(async () => {
    if (!repository || !exerciseCursor || exerciseSearchLoading) return;
    const requestId = ++exerciseSearchRequestRef.current;
    setExerciseSearchLoading(true);
    setExerciseSearchError("");
    try {
      const page = await repository.searchExercises({
        query: exerciseQuery,
        scope: exerciseScope,
        disciplines: exerciseFilters.disciplines,
        categories: exerciseFilters.categories,
        modes: exerciseFilters.modes,
        tracking: exerciseFilters.tracking,
        limit: 50,
        cursor: exerciseCursor,
      });
      if (requestId !== exerciseSearchRequestRef.current) return;
      setExerciseCursor(page.nextCursor);
      setWorkspace((previous) => {
        const current =
          exerciseScope === "global"
            ? previous.globalExercises
            : previous.personalExercises;
        const merged = [
          ...current,
          ...page.items.filter(
            (exercise) =>
              !current.some((candidate) => candidate.id === exercise.id),
          ),
        ];
        return {
          ...previous,
          ...(exerciseScope === "global"
            ? { globalExercises: merged }
            : { personalExercises: merged }),
        };
      });
    } catch (error) {
      if (requestId === exerciseSearchRequestRef.current) {
        setExerciseSearchError(
          error instanceof Error
            ? error.message
            : "More exercises could not be loaded.",
        );
      }
    } finally {
      if (requestId === exerciseSearchRequestRef.current) {
        setExerciseSearchLoading(false);
      }
    }
  }, [
    exerciseCursor,
    exerciseFilters,
    exerciseQuery,
    exerciseScope,
    exerciseSearchLoading,
    repository,
  ]);

  const searchBuilderExercises = useCallback(
    async (query: string) => {
      if (repository) {
        const page = await repository.searchExercises({
          query,
          scope: "all",
          limit: 20,
        });
        return page.items;
      }
      const normalized = query.trim().toLowerCase();
      return [
        ...workspace.globalExercises,
        ...workspace.personalExercises,
      ]
        .filter(
          (exercise) =>
            !normalized || exercise.name.toLowerCase().includes(normalized),
        )
        .slice(0, 20);
    },
    [repository, workspace.globalExercises, workspace.personalExercises],
  );

  const schedulablePrograms =
    workspace.schedulablePrograms ??
    [workspace.draftProgram ?? workspace.activeProgram].filter(
      (candidate): candidate is Program => Boolean(candidate),
    );
  const outgoingCoachInvites = workspace.outgoingCoachInvites ?? [];
  const coachingDetailsLoaded =
    loadedWorkspaceFeaturesRef.current.has("coaching");
  const hasCoach = coachingDetailsLoaded
    ? workspace.coachConnections.length > 0
    : (workspace.coachingAccess?.hasCoach ?? false);
  const hasAthleteWorkspace =
    coachingDetailsLoaded
      ? workspace.coachedAthletes.length > 0 ||
        workspace.pendingCoachInvites.length > 0
      : (workspace.coachingAccess?.coachedAthleteCount ?? 0) > 0 ||
        (workspace.coachingAccess?.pendingInviteCount ?? 0) > 0;
  const coachMode = hasAthleteWorkspace ? requestedCoachMode : "athlete";
  const programSource =
    requestedProgramSource === "coach" && !hasCoach
      ? "own"
      : requestedProgramSource;
  const programCatalog = workspace.programCatalog ?? schedulablePrograms;
  const visibleGlobalExercises = repository
    ? workspace.globalExercises
    : filterCompleteExerciseLibrary(
        workspace.globalExercises,
        exerciseQuery,
        exerciseFilters,
      );
  const visiblePersonalExercises = repository
    ? workspace.personalExercises
    : filterCompleteExerciseLibrary(
        workspace.personalExercises,
        exerciseQuery,
        exerciseFilters,
      );
  const workoutPreviewSchedule =
    detail?.kind === "workout-preview" ? detail.schedule : null;
  const workoutPreviewReturnView =
    detail?.kind === "workout-preview" ? detail.returnView : "today";
  const completedWorkoutView =
    detail?.kind === "completed-workout" ? detail : null;
  const selectedAthlete =
    workspace.coachedAthletes.find(
      (athlete) => athlete.id === selectedAthleteId,
    ) ??
    workspace.coachedAthletes[0] ??
    null;
  function capabilitiesForProgram(
    targetProgram: Program,
  ): TrainingContentCapabilities {
    return deriveTrainingContentCapabilities({
      viewerId: viewer.id,
      athleteOwnerId: targetProgram.athleteId,
      authorId: targetProgram.createdById,
      source: targetProgram.sourceType,
      contentType: targetProgram.contentType ?? "program",
      lifecycle: targetProgram.versionStatus,
      activeCoachOfOwner: workspace.coachedAthletes.some(
        (athlete) => athlete.id === targetProgram.athleteId,
      ),
      hasAssignableAthletes: coachingDetailsLoaded
        ? workspace.coachedAthletes.length > 0
        : (workspace.coachingAccess?.coachedAthleteCount ?? 0) > 0,
      coachReadScope: "authored_only",
    });
  }
  function capabilitiesForOccurrence(
    schedule: ScheduledWorkout,
  ): OccurrenceCapabilities {
    return deriveOccurrenceCapabilities({
      viewerId: viewer.id,
      athleteOwnerId: viewer.id,
      status: schedule.status,
      activeCoachOfOwner: false,
    });
  }
  const assignableOwnPrograms = programCatalog.filter(
    (candidate) => capabilitiesForProgram(candidate).assign,
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
    initialWorkspace.activeSession?.setLogs ??
    (todayWorkout ? starterSetLogs(todayWorkout, activeSession) : {}),
  );
  const [resultLogs, setResultLogs] = useState<
    Record<string, Record<string, string>>
  >(initialWorkspace.activeSession?.resultLogs ?? {});
  const activeWorkoutSnapshot = useMemo<ActiveWorkoutDraftSnapshot>(
    () => ({ setLogs, resultLogs, sessionRpe, sessionNote }),
    [resultLogs, sessionNote, sessionRpe, setLogs],
  );
  const applyPersistedSnapshot = useCallback(
    (snapshot: ActiveWorkoutDraftSnapshot) => {
      setSetLogs(snapshot.setLogs);
      setResultLogs(snapshot.resultLogs);
      setSessionRpe(snapshot.sessionRpe);
      setSessionNote(snapshot.sessionNote);
    },
    [],
  );
  const activeWorkoutPersistence = useActiveWorkoutPersistence({
    userId: viewer.id,
    session: workoutStarted ? activeSession : null,
    workout: todayWorkout,
    schedule: todaySchedule,
    profile: workspace.profile,
    repository,
    snapshot: activeWorkoutSnapshot,
    onApplySnapshot: applyPersistedSnapshot,
    onSessionRefresh: setActiveSession,
    onRevisionConfirmed: (revision, writeToken) =>
      setActiveSession((current) =>
        current
          ? {
              ...current,
              draftRevision: revision,
              draftWriteToken: writeToken,
            }
          : current,
      ),
    onSyncError: (error) =>
      notify(
        error instanceof Error
          ? error.message
          : "Your workout is saved on this device but could not sync yet.",
      ),
  });
  const sessionDraftConflict = activeWorkoutPersistence.conflict;
  const sessionSaveStatus = activeWorkoutPersistence.status;
  const isOnline = activeWorkoutPersistence.online;
  const localRecoveryAvailable =
    activeWorkoutPersistence.localRecoveryAvailable;

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
    void loadProgramView();
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
        targetProgram.versionId,
        targetProgram.assignmentId,
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

  async function viewScheduledPlan(schedule: ScheduledWorkout) {
    try {
      const matchingProgram = programCatalog.find(
        (candidate) => candidate.id === schedule.programId,
      );
      const nextProgram = repository
          ? await repository.loadOwnScheduledProgramVersionById(
            schedule.programId,
            schedule.programVersionId,
            schedule.assignmentId,
          )
        : matchingProgram;
      if (!nextProgram) throw new Error("This plan version is no longer available.");
      const workoutWeek = nextProgram.weeks.find((week) =>
        week.workouts.some((workout) => workout.id === schedule.workoutId),
      );
      selectProgram(nextProgram, {
        weekIndex: workoutWeek?.index,
        workoutId: schedule.workoutId,
      });
      setDetail(null);
      setActiveView("program");
      scrollToAppTop();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "The plan could not be opened",
      );
    }
  }

  function replaceProgramEverywhere(nextProgram: Program) {
    const replaceMatchingVersion = (candidate: Program) =>
      candidate.versionId === nextProgram.versionId ? nextProgram : candidate;
    setProgram(nextProgram);
    setWorkspace((previous) => ({
      ...previous,
      programCatalog: previous.programCatalog.map(replaceMatchingVersion),
      schedulablePrograms: previous.schedulablePrograms.map(replaceMatchingVersion),
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

  async function refreshProgramWorkspace(programId?: string) {
    if (!repository) return null;
    repository.invalidatePrograms(programId);
    const page = await repository.listProgramSummaries({ limit: 25 });
    setProgramCursor(page.nextCursor);
    setWorkspace((previous) =>
      mergeProgramCatalog(previous, page.items, true),
    );
    return page.items;
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
        fallback.assignmentId,
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
        await repository.loadEditableProgram(
          program.athleteId,
          program.id,
          program.assignmentId,
        ),
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
      program.versionId,
      program.assignmentId,
    );
    if (nextProgram) selectProgram(nextProgram, preferred);
    else setProgram(null);
  }

  function navigate(view: ViewName) {
    if (view === "today" && activeSession && activeWorkoutVisible) {
      setActiveWorkoutVisible(false);
      setDetail(null);
    }
    if (view === "program" && programOwnerId !== viewer.id) {
      setProgram(null);
      setProgramOwnerId(viewer.id);
    }
    if (
      view === "coaching" &&
      coachMode === "coach" &&
      selectedAthlete?.detailsLoaded === false
    ) {
      void loadCoachedAthleteDetail(selectedAthlete.id);
    }
    setActiveView(view);
    updateAppViewUrl(view);
    scrollToAppTop();
  }

  function applyCoachingWorkspace(nextCoaching: CoachingWorkspaceData) {
    const { coachAthleteCursor: nextCursor, ...workspaceData } = nextCoaching;
    setCoachAthleteCursor(nextCursor);
    setCoachAthletesLoadError("");
    setWorkspace((previous) => ({ ...previous, ...workspaceData }));
    setSelectedAthleteId(
      (previousId) =>
        nextCoaching.coachedAthletes.find(
          (athlete) => athlete.id === previousId,
        )?.id ??
        nextCoaching.coachedAthletes[0]?.id ??
        null,
    );
  }

  async function loadMoreCoachAthletes() {
    if (!repository || !coachAthleteCursor || coachAthletesLoadingMore) return;
    setCoachAthletesLoadingMore(true);
    setCoachAthletesLoadError("");
    try {
      const page = await repository.listCoachAthletes({
        limit: 25,
        cursor: coachAthleteCursor,
      });
      setWorkspace((previous) => {
        const athletesById = new Map(
          previous.coachedAthletes.map((athlete) => [athlete.id, athlete]),
        );
        for (const athlete of page.items) {
          if (!athletesById.has(athlete.id)) athletesById.set(athlete.id, athlete);
        }
        return { ...previous, coachedAthletes: [...athletesById.values()] };
      });
      setCoachAthleteCursor(page.nextCursor);
    } catch (error) {
      setCoachAthletesLoadError(
        error instanceof Error
          ? error.message
          : "More athletes could not be loaded.",
      );
    } finally {
      setCoachAthletesLoadingMore(false);
    }
  }

  async function loadCoachedAthleteDetail(
    athleteId: string,
    force = false,
  ): Promise<boolean> {
    if (!repository) return true;
    const current = workspace.coachedAthletes.find(
      (athlete) => athlete.id === athleteId,
    );
    if (!force && current?.detailsLoaded !== false) return true;
    if (coachingDetailRequestsRef.current.has(athleteId)) return false;
    coachingDetailRequestsRef.current.add(athleteId);
    setCoachingDetailLoadingId(athleteId);
    try {
      const detail = await repository.loadCoachedAthleteDetail(athleteId);
      if (!detail) throw new Error("This coaching connection is no longer active.");
      setWorkspace((previous) => ({
        ...previous,
        coachedAthletes: previous.coachedAthletes.map((athlete) =>
          athlete.id === athleteId ? detail : athlete,
        ),
      }));
      return true;
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "The athlete overview could not be loaded",
      );
      return false;
    } finally {
      coachingDetailRequestsRef.current.delete(athleteId);
      setCoachingDetailLoadingId((currentId) =>
        currentId === athleteId ? null : currentId,
      );
    }
  }

  async function refreshCoachWorkspace(): Promise<boolean> {
    if (!repository) return true;
    if (coachingRefreshRef.current) return false;
    coachingRefreshRef.current = true;
    setCoachingRefreshing(true);
    try {
      const nextCoaching = await repository.loadCoachingWorkspace();
      const nextSelectedId =
        nextCoaching.coachedAthletes.find(
          (athlete) => athlete.id === selectedAthleteId,
        )?.id ?? nextCoaching.coachedAthletes[0]?.id;
      applyCoachingWorkspace(nextCoaching);
      if (coachMode === "coach" && nextSelectedId) {
        await loadCoachedAthleteDetail(nextSelectedId, true);
      }
      return true;
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "The coach workspace could not be refreshed",
      );
      return false;
    } finally {
      coachingRefreshRef.current = false;
      setCoachingRefreshing(false);
    }
  }

  function changeCoachMode(nextMode: "athlete" | "coach") {
    setCoachMode(nextMode);
    if (
      nextMode === "coach" &&
      selectedAthlete &&
      selectedAthlete.detailsLoaded === false
    ) {
      void loadCoachedAthleteDetail(selectedAthlete.id);
    }
  }

  function selectCoachedAthlete(athlete: AthleteSummary) {
    setSelectedAthleteId(athlete.id);
    if (athlete.detailsLoaded === false) {
      void loadCoachedAthleteDetail(athlete.id);
    }
  }

  const updateSet = useCallback((
    itemId: string,
    index: number,
    field: keyof SetLog,
    value: string,
  ) => {
    setSetLogs((previous) => ({
      ...previous,
      [itemId]: previous[itemId].map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: value } : row,
      ),
    }));
  }, []);

  const addSet = useCallback((itemId: string) => {
    setSetLogs((previous) => ({
      ...previous,
      [itemId]: [...(previous[itemId] ?? []), { reps: "", load: "", rpe: "" }],
    }));
  }, []);

  const removeSet = useCallback((itemId: string, index: number) => {
    setSetLogs((previous) => ({
      ...previous,
      [itemId]: previous[itemId].filter((_, rowIndex) => rowIndex !== index),
    }));
  }, []);

  const updateResult = useCallback((itemId: string, field: string, value: string) => {
    setResultLogs((previous) => ({
      ...previous,
      [itemId]: { ...(previous[itemId] ?? {}), [field]: value },
    }));
  }, []);

  async function resolveSessionDraftConflict(keepLocalValues: boolean) {
    if (!sessionDraftConflict) return;
    try {
      await activeWorkoutPersistence.resolveConflict(keepLocalValues);
      notify(
        keepLocalValues
          ? "Kept this device's conflicting values · syncing merged workout"
          : "Kept the last server-saved conflicting values",
      );
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "The workout conflict could not be resolved",
      );
    }
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
    setCalendarRangeData((previous) => ({
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
      requireCapability(
        capabilitiesForOccurrence(schedule),
        "startOrResume",
      );
      const detailedSchedule = await ensureScheduledWorkoutDetails(schedule);
      const workout = detailedSchedule.workout;
      if (!repository) {
        setWorkoutStarted(true);
        setActiveWorkoutVisible(true);
        return;
      }
      const session = await repository.startOrResumeSession(
        detailedSchedule.id,
      );
      if (!session) throw new Error("The workout session was not created.");
      completionTokenRef.current = null;
      setActiveSession(session);
      setSetLogs(starterSetLogs(workout, session));
      setResultLogs(session.resultLogs);
      setSessionRpe(session.sessionRpe);
      setSessionNote(session.sessionNote);
      setWorkoutStarted(true);
      setActiveWorkoutVisible(true);
      setWorkspace((previous) => ({
        ...previous,
        scheduledWorkouts: previous.scheduledWorkouts.map((candidate) =>
          candidate.id === schedule.id
            ? { ...candidate, status: "in_progress" }
            : candidate,
        ),
      }));
      setDetail(null);
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
      setDetail({
        kind: "workout-preview",
        schedule: detailedSchedule,
        returnView,
      });
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

  async function clearConfirmedActiveSession(
    session: ActiveSession,
    scheduleStatus: "planned" | "skipped" | "completed",
  ) {
    await activeWorkoutPersistence.clearAfterCompletion(session.id);
    setActiveSession(null);
    setWorkoutStarted(false);
    setWorkoutComplete(false);
    setWorkspace((previous) => ({
      ...previous,
      activeSession: null,
      scheduledWorkouts: previous.scheduledWorkouts.map((scheduled) =>
        scheduled.id === session.scheduledWorkoutId
          ? { ...scheduled, status: scheduleStatus }
          : scheduled,
      ),
    }));
  }

  async function finishWorkout() {
    if (workoutActionRef.current) return;
    workoutActionRef.current = "finishing";
    setWorkoutAction("finishing");
    try {
      if (repository && activeSession) {
        if (!isOnline) {
          throw new Error("Reconnect before finishing this workout");
        }
        let completion =
          completionTokenRef.current?.sessionId === activeSession.id
            ? completionTokenRef.current
            : null;
        let recoveredRevision: number | null = null;

        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (!completion) {
            const confirmedRevision =
              recoveredRevision ?? (await activeWorkoutPersistence.flush());
            recoveredRevision = null;
            completion = {
              sessionId: activeSession.id,
              token: crypto.randomUUID(),
              confirmedRevision,
              sessionRpe,
              sessionNote,
            };
            completionTokenRef.current = completion;
          }

          try {
            await repository.completeSession(
              completion.sessionId,
              completion.sessionRpe,
              completion.sessionNote,
              completion.confirmedRevision,
              completion.token,
            );
            break;
          } catch (error) {
            if (
              !(error instanceof SessionRevisionConflictError) ||
              attempt === 2
            ) {
              throw error;
            }
            completionTokenRef.current = null;
            completion = null;
            recoveredRevision = await activeWorkoutPersistence.recover();
          }
        }

        await clearConfirmedActiveSession(activeSession, "completed");
        completionTokenRef.current = null;
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

  async function updateWorkoutSettings(
    title: string,
    durationMinutes: number,
    description: string,
  ) {
    if (!selectedWorkout || !program) return;
    const syncQuickWorkoutTitle = program?.contentType === "quick_workout";
    const nextDescription = description.trim();
    if (repository) {
      await repository.updateWorkout(
        selectedWorkout.id,
        title,
        durationMinutes,
      );
      if (syncQuickWorkoutTitle) {
        await repository.updateProgramTitle(program.id, title);
        if (nextDescription !== program.description) {
          await repository.updateProgramDescription(program.id, nextDescription);
        }
      }
    }
    const nextProgram: Program = {
      ...program,
      title: syncQuickWorkoutTitle ? title : program.title,
      description: syncQuickWorkoutTitle ? nextDescription : program.description,
      weeks: program.weeks.map((week) => ({
        ...week,
        workouts: week.workouts.map((workout) =>
          workout.id === selectedWorkout.id
            ? { ...workout, title, durationMinutes }
            : workout,
        ),
      })),
    };
    replaceProgramEverywhere(nextProgram);
    setModal(null);
    notify("Workout details updated");
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

  function deleteWeek() {
    if (!currentWeek || !repository) return;
    setContentDeleteTarget({
      kind: "week",
      id: currentWeek.id,
      label: currentWeek.label || `Week ${currentWeek.index}`,
    });
    setModal("delete-content");
  }

  function deleteSelectedWorkout() {
    if (!selectedWorkout || !repository) return;
    setContentDeleteTarget({
      kind: "workout",
      id: selectedWorkout.id,
      title: selectedWorkout.title,
    });
    setModal("delete-content");
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

  function removeWorkoutItem(itemId: string) {
    if (!selectedWorkout) return;
    const item = selectedWorkout.sections
      .flatMap((section) => section.items)
      .find((candidate) => candidate.id === itemId);
    setContentDeleteTarget({
      kind: "workout-item",
      id: itemId,
      title: item?.title ?? "this exercise",
    });
    setModal("delete-content");
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
    discipline: ExerciseDiscipline,
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
          discipline,
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
      const fields = trackingFieldsForMode(mode);
      exercise = {
        id: `personal-${Date.now()}`,
        name,
        category,
        discipline,
        cue,
        scope: "personal",
        ownerName: viewer.name,
        defaultMode: mode,
        defaultFields: fields,
      };
    }
    setWorkspace((previous) => ({
      ...previous,
      personalExercises: [...previous.personalExercises, exercise],
    }));
    setExerciseScope("personal");
    setExerciseFilters(emptyExerciseLibraryFilters());
    setExerciseEditing(null);
    setExerciseDetailTarget(null);
    setModal(null);
    notify(`${name} saved to your library`);
  }

  async function updatePersonalExercise(
    original: Exercise,
    name: string,
    discipline: ExerciseDiscipline,
    category: string,
    mode: EntryMode,
    cue: string,
  ) {
    if (original.scope !== "personal") return;
    const input = {
      name,
      category,
      discipline,
      tags: original.tags,
      mode,
      fields:
        mode === original.defaultMode ? original.defaultFields : undefined,
      cue,
    };
    try {
      const exercise = repository
        ? await repository.updatePersonalExercise(original.id, input)
        : {
            ...original,
            name,
            category,
            discipline,
            cue,
            defaultMode: mode,
            defaultFields: trackingFieldsForMode(mode, input.fields),
          };
      setWorkspace((previous) => ({
        ...previous,
        personalExercises: previous.personalExercises.map((candidate) =>
          candidate.id === exercise.id ? exercise : candidate,
        ),
      }));
      setExerciseEditing(null);
      setExerciseDetailTarget(null);
      setModal(null);
      notify(`${name} updated`);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "The exercise could not be updated",
      );
    }
  }

  async function deletePersonalExercise(exercise: Exercise) {
    if (exercise.scope !== "personal") {
      throw new Error("Only exercises in My exercises can be deleted.");
    }
    if (repository) await repository.deletePersonalExercise(exercise.id);
    setWorkspace((previous) => ({
      ...previous,
      personalExercises: previous.personalExercises.filter(
        (candidate) => candidate.id !== exercise.id,
      ),
    }));
    setExerciseDeleteTarget(null);
    setModal(null);
    notify(`${exercise.name} removed from your library`);
  }

  async function copyLibraryExercise(exercise: Exercise) {
    if (exercise.scope !== "global" || copyingExerciseId) return;
    setCopyingExerciseId(exercise.id);
    try {
      const copy = repository
        ? await repository.createPersonalExercise({
            name: exercise.name,
            category: exercise.category,
            discipline: exercise.discipline,
            tags: exercise.tags,
            mode: exercise.defaultMode,
            fields: exercise.defaultFields,
            cue: exercise.cue,
          })
        : {
            ...exercise,
            id: `personal-${Date.now()}`,
            scope: "personal" as const,
            ownerName: viewer.name,
          };
      setWorkspace((previous) => ({
        ...previous,
        personalExercises: [...previous.personalExercises, copy],
      }));
      setExerciseScope("personal");
      setExerciseFilters(emptyExerciseLibraryFilters());
      setExerciseDetailTarget(copy);
      setModal("exercise-details");
      notify(`${exercise.name} copied to My exercises`);
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "The exercise could not be copied",
      );
    } finally {
      setCopyingExerciseId(null);
    }
  }

  async function publishProgram(title: string, description: string) {
    if (!program || programAction) return;
    const nextTitle = title.trim();
    const nextDescription = description.trim();
    if (!nextTitle) return;
    if (!repository) {
      notify("Program saved for the local demo");
      return;
    }
    setProgramAction({ id: program.id, kind: "publish" });
    try {
      requireCapability(capabilitiesForProgram(program), "publish");
      if (
        program.contentType === "quick_workout" &&
        selectedWorkout &&
        nextTitle !== selectedWorkout.title
      ) {
        await repository.updateWorkout(
          selectedWorkout.id,
          nextTitle,
          selectedWorkout.durationMinutes,
        );
      }
      if (nextTitle !== program.title) {
        await repository.updateProgramTitle(program.id, nextTitle);
      }
      if (nextDescription !== program.description) {
        await repository.updateProgramDescription(program.id, nextDescription);
      }
      await repository.publishProgram(program.versionId);
      await refreshProgramWorkspace(program.id);
      setProgram(null);
      setProgramOwnerId(viewer.id);
      notify(
        program.contentType === "quick_workout"
          ? "Workout saved. It is ready to schedule or assign."
          : program.sourceType === "coach"
          ? "Coach program saved · the athlete can schedule it"
          : "Program saved. It is ready to schedule.",
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
      requireCapability(capabilitiesForProgram(targetProgram), "edit");
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
        await refreshProgramWorkspace(program.id);
      } else {
        setWorkspace((previous) => ({
          ...previous,
          schedulablePrograms: previous.schedulablePrograms.filter(
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
        await refreshCoachWorkspace();
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
        await refreshCoachWorkspace();
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
          await refreshCoachWorkspace();
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
                  assignedProgramCount: 0,
                  detailsLoaded: false,
                  assignedPrograms: [],
                  agenda: [],
                },
              ]
            : previous.coachedAthletes,
      }));

      let refreshFailed = false;
      if (repository) {
        refreshFailed = !(await refreshCoachWorkspace());
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

  async function openAssignmentModal(seed: {
    programId?: string;
    athleteIds?: string[];
  }) {
    if (
      repository &&
      !loadedWorkspaceFeaturesRef.current.has("coaching")
    ) {
      await loadWorkspaceFeature("coaching");
      if (!loadedWorkspaceFeaturesRef.current.has("coaching")) {
        notify("Your athletes could not be loaded. Try again.");
        return;
      }
    }
    setAssignmentSeed(seed);
    setModal("assign-program");
  }

  async function assignProgramToAthletes(
    programId: string,
    athleteIds: string[],
  ): Promise<ProgramAssignment[]> {
    const sourceProgram = assignableOwnPrograms.find(
      (candidate) => candidate.id === programId,
    );
    if (!sourceProgram) throw new Error("Choose a finished Own program.");
    requireCapability(capabilitiesForProgram(sourceProgram), "assign");
    if (!athleteIds.length) throw new Error("Choose at least one athlete.");
    const assignments = repository
      ? await repository.assignOwnProgramToAthletes(
          programId,
          athleteIds,
          sourceProgram.versionId,
        )
      : athleteIds.map((athleteId) => ({
          athleteId,
          assignmentId: `assignment-${programId}-${athleteId}`,
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
          (candidate) =>
            candidate.id ===
            (assignment.assignmentId ?? assignment.programId),
        )
      )
        return athlete;
      return {
        ...athlete,
        assignedPrograms: [
          {
            id: assignment.assignmentId ?? assignment.programId,
            programId: assignment.programId,
            assignmentId: assignment.assignmentId,
            versionId: sourceProgram.versionId,
            title: sourceProgram.title,
            assignedAt,
            status: "awaiting_schedule" as const,
            totalWorkouts: workoutCount,
            scheduledWorkouts: 0,
            scheduledPercent: 0,
            completedWorkouts: 0,
            completionPercent: 0,
          },
          ...athlete.assignedPrograms,
        ],
      };
    };
    setWorkspace((previous) => ({
      ...previous,
      coachedAthletes: previous.coachedAthletes.map(withOptimisticAssignment),
    }));
    setAssignmentSeed({});
    setModal(null);

    let refreshFailed = false;
    if (repository) {
      refreshFailed = !(await refreshCoachWorkspace());
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
    requireCapability(
      capabilitiesForProgram(workout),
      "provideInitialAssignmentDate",
    );
    if (!athleteIds.length) throw new Error("Choose at least one athlete.");
    const assignments = repository
      ? await repository.assignQuickWorkoutToAthletes(
          programId,
          athleteIds,
          plannedDate,
        )
      : athleteIds.map((athleteId) => ({
          athleteId,
          assignmentId: `assignment-${programId}-${athleteId}`,
          programId: `assigned-${programId}-${athleteId}`,
          created: true,
        }));
    if (repository) await refreshCoachWorkspace();
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
        if (target.id === viewer.id) await refreshProgramWorkspace(programId);
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
        await refreshProgramWorkspace(workoutId);
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

  function deleteOwnProgram(targetProgram: Program) {
    if (programAction) return;
    try {
      requireCapability(capabilitiesForProgram(targetProgram), "deleteOwn");
    } catch {
      notify("This program cannot be deleted from the current account");
      return;
    }
    setContentDeleteTarget({ kind: "program", program: targetProgram });
    setModal("delete-content");
  }

  async function performProgramDeletion(targetProgram: Program) {
    setProgramAction({ id: targetProgram.id, kind: "delete" });
    try {
      if (repository) {
        await repository.deleteOwnProgram(targetProgram.id);
        await refreshProgramWorkspace(targetProgram.id);
      } else {
        setWorkspace((previous) => ({
          ...previous,
          programCatalog: previous.programCatalog.filter(
            (candidate) => candidate.id !== targetProgram.id,
          ),
          schedulableProgramIds: previous.schedulableProgramIds.filter(
            (id) => id !== targetProgram.id,
          ),
          schedulablePrograms: previous.schedulablePrograms.filter(
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
      throw error instanceof Error
        ? error
        : new Error("The program could not be deleted");
    } finally {
      setProgramAction(null);
    }
  }

  async function confirmContentDeletion(target: ContentDeleteTarget) {
    if (target.kind === "week") {
      if (!repository) throw new Error("The week could not be deleted.");
      await repository.deleteProgramWeek(target.id);
      await reloadCurrentProgram();
      notify("Week deleted");
      return;
    }
    if (target.kind === "workout") {
      if (!repository) throw new Error("The workout could not be deleted.");
      await repository.deleteWorkout(target.id);
      await reloadCurrentProgram();
      notify("Workout deleted");
      return;
    }
    if (target.kind === "workout-item") {
      if (repository) await repository.removeWorkoutItem(target.id);
      removeItemFromProgram(target.id);
      notify(`${target.title} removed from the workout`);
      return;
    }
    await performProgramDeletion(target.program);
  }

  async function loadScheduleCandidates(reset = false) {
    if (scheduleCandidatesLoading) return;
    setScheduleCandidatesLoading(true);
    setScheduleCandidatesError("");
    try {
      if (repository) {
        const page = await repository.listSchedulableWorkouts({
          limit: 50,
          ...(reset || !scheduleCandidateCursor
            ? {}
            : { cursor: scheduleCandidateCursor }),
        });
        setScheduleCandidates((current) =>
          reset
            ? page.items
            : [
                ...current,
                ...page.items.filter(
                  (item) =>
                    !current.some(
                      (existing) =>
                        existing.programVersionId === item.programVersionId &&
                        existing.workoutId === item.workoutId &&
                        existing.assignmentId === item.assignmentId,
                    ),
                ),
              ],
        );
        setScheduleCandidateCursor(page.nextCursor);
        return;
      }

      const demoCandidates = schedulablePrograms.flatMap((candidate) =>
        candidate.weeks.flatMap((week) =>
          week.workouts.map((workout, position) => {
            const occurrences = workspace.scheduledWorkouts.filter(
              (occurrence) =>
                occurrence.programVersionId === candidate.versionId &&
                occurrence.workoutId === workout.id,
            );
            const latest = occurrences.sort(
              (left, right) => right.sequenceNumber - left.sequenceNumber,
            )[0];
            return {
              kind: "program" as const,
              programId: candidate.id,
              programVersionId: candidate.versionId,
              workoutId: workout.id,
              programTitle: candidate.title,
              workoutTitle: workout.title,
              contentType: candidate.contentType ?? "program",
              isQuickWorkout: candidate.contentType === "quick_workout",
              weekIndex: week.index,
              weekLabel: week.label,
              workoutPosition: position,
              scheduleLabel: workout.dayLabel,
              estimatedMinutes: workout.durationMinutes,
              ...(latest
                ? {
                    latestOccurrence: {
                      id: latest.id,
                      plannedDate: latest.plannedDate,
                      status: latest.status,
                      sequenceNumber: latest.sequenceNumber,
                    },
                  }
                : {}),
            } satisfies SchedulableWorkoutCandidate;
          }),
        ),
      );
      setScheduleCandidates(demoCandidates);
      setScheduleCandidateCursor(undefined);
    } catch (error) {
      setScheduleCandidatesError(
        error instanceof Error
          ? error.message
          : "Workouts available to schedule could not be loaded.",
      );
    } finally {
      setScheduleCandidatesLoading(false);
    }
  }

  function openSchedule(scheduleId?: string, initialDate?: string) {
    setScheduleEditingId(scheduleId ?? null);
    setScheduleInitialDate(initialDate ?? null);
    setModal("schedule");
    if (!scheduleId) void loadScheduleCandidates(true);
  }

  async function saveSchedule(scheduleId: string, date: string | null) {
    const targetSchedule = workspace.scheduledWorkouts.find(
      (schedule) => schedule.id === scheduleId,
    );
    const previousDate = targetSchedule?.plannedDate;
    try {
      if (!targetSchedule)
        throw new Error("This scheduled workout is no longer available.");
      requireCapability(
        capabilitiesForOccurrence(targetSchedule),
        date === null ? "remove" : "reschedule",
      );
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
      setCalendarRangeData((previous) => ({
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

  async function saveScheduleCandidate(
    candidate: ScheduleCandidate,
    date: string | null,
  ) {
    if (candidate.scheduleId) {
      await saveSchedule(candidate.scheduleId, date);
      return;
    }
    if (!date) throw new Error("Choose a date for this workout.");

    const demoScheduleId = `schedule-${Date.now()}`;
    const created = repository
      ? await repository.createScheduledOccurrence(
          candidate.programId,
          candidate.assignmentId,
          candidate.workoutId,
          date,
        )
      : {
          id: demoScheduleId,
          programId: candidate.programId,
          programTitle: candidate.programTitle,
          programVersionId: candidate.programVersionId,
          workoutId: candidate.workoutId,
          workoutTitle: candidate.workoutTitle,
          slotLabel: candidate.quickWorkout
            ? candidate.workoutTitle
            : `${candidate.programTitle} · ${candidate.workoutTitle}`,
          plannedDate: date,
          sequenceNumber: workspace.scheduledWorkouts.length + 1,
          status: "planned" as const,
          workout: {
            id: candidate.workoutId,
            programVersionId: candidate.programVersionId,
            title: candidate.workoutTitle,
            dayLabel: candidate.scheduleLabel,
            durationMinutes: candidate.estimatedMinutes,
            sections: [],
            scheduledWorkoutId: demoScheduleId,
            plannedDate: date,
          },
          detailsLoaded: false,
        };
    setWorkspace((previous) => ({
      ...previous,
      scheduledWorkouts: [
        ...previous.scheduledWorkouts.filter(
          (schedule) => schedule.id !== created.id,
        ),
        created,
      ],
    }));
    const visibleRange = lastCalendarRangeRef.current;
    if (
      !visibleRange ||
      (date >= visibleRange.start && date <= visibleRange.end)
    ) {
      setCalendarRangeData((previous) => ({
        ...previous,
        scheduledWorkouts: [
          ...previous.scheduledWorkouts.filter(
            (schedule) => schedule.id !== created.id,
          ),
          created,
        ],
      }));
    }
    setModal(null);
    setScheduleEditingId(null);
    setScheduleInitialDate(null);
    notify("Workout added to your calendar");
  }

  async function setScheduledWorkoutStatus(
    scheduleId: string,
    status: "planned" | "skipped",
  ) {
    if (scheduleStatusAction) return;
    setScheduleStatusAction({ id: scheduleId, status });
    try {
      const targetSchedule = workspace.scheduledWorkouts.find(
        (schedule) => schedule.id === scheduleId,
      );
      if (!targetSchedule)
        throw new Error("This scheduled workout is no longer available.");
      const resettingActiveOccurrence =
        status === "planned" &&
        activeSession?.scheduledWorkoutId === targetSchedule.id;
      requireCapability(
        capabilitiesForOccurrence(targetSchedule),
        status === "planned"
          ? targetSchedule.status === "in_progress" || resettingActiveOccurrence
            ? "resetToPlanned"
            : "restore"
          : "skip",
      );
      if (repository) {
        await repository.setScheduledWorkoutStatus(scheduleId, status);
        if (activeSession?.scheduledWorkoutId === scheduleId) {
          await clearConfirmedActiveSession(activeSession, status);
        } else {
          setWorkspace((previous) => ({
            ...previous,
            scheduledWorkouts: previous.scheduledWorkouts.map((schedule) =>
              schedule.id === scheduleId ? { ...schedule, status } : schedule,
            ),
          }));
          setCalendarRangeData((previous) => ({
            ...previous,
            scheduledWorkouts: previous.scheduledWorkouts.map((schedule) =>
              schedule.id === scheduleId ? { ...schedule, status } : schedule,
            ),
          }));
        }
      } else {
        setWorkspace((previous) => ({
          ...previous,
          scheduledWorkouts: previous.scheduledWorkouts.map((schedule) =>
            schedule.id === scheduleId ? { ...schedule, status } : schedule,
          ),
        }));
        setCalendarRangeData((previous) => ({
          ...previous,
          scheduledWorkouts: previous.scheduledWorkouts.map((schedule) =>
            schedule.id === scheduleId ? { ...schedule, status } : schedule,
          ),
        }));
        if (activeSession?.scheduledWorkoutId === scheduleId) {
          await clearConfirmedActiveSession(activeSession, status);
        }
      }
      setDetail(null);
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
    setDetail({
      kind: "completed-workout",
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
      setDetail({
        kind: "completed-workout",
        session: detail ?? session,
        detail,
        loading: false,
        error: detail ? "" : "These workout results are no longer available.",
        returnView,
      });
    } catch (error) {
      if (completedWorkoutRequestRef.current !== requestId) return;
      setDetail({
        kind: "completed-workout",
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
            assignedProgram.programId ?? assignedProgram.id,
            programVersionId,
            assignedProgram.assignmentId,
          )
        : await repository.loadProgramForAthleteById(
            athlete.id,
            assignedProgram.programId ?? assignedProgram.id,
            assignedProgram.assignmentId,
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
      scrollToAppTop();
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
      (candidate) =>
        candidate.assignmentId === entry.assignmentId ||
        candidate.programId === entry.programId ||
        candidate.id === entry.programId,
    );
    if (assignedProgram)
      void openAthleteProgram(
        athlete,
        assignedProgram,
        entry.workoutId,
        entry.programVersionId,
      );
  }

  const showingWorkoutPreview = Boolean(workoutPreviewSchedule);
  const displayedSchedule = workoutPreviewSchedule ?? todaySchedule;

  return (
    <main className="app-shell">
      <Sidebar
        activeView={
          detail?.returnView ??
          (programOwnerId !== viewer.id ? "coaching" : activeView)
        }
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

        {loadingWorkspaceFeature && (
          <div className="feature-load-status" role="status" aria-live="polite">
            <LoaderCircle size={16} className="spin" />
            Loading {loadingWorkspaceFeature}…
          </div>
        )}
        {workspaceFeatureError && (
          <div className="feature-load-status error" role="alert">
            <span>{workspaceFeatureError.message}</span>
            <button
              className="text-button"
              onClick={() => {
                loadedWorkspaceFeaturesRef.current.delete(
                  workspaceFeatureError.feature,
                );
                void loadWorkspaceFeature(workspaceFeatureError.feature);
              }}
            >
              Try again
            </button>
          </div>
        )}

        {activeView === "today" && completedWorkoutView && (
          <CompletedWorkoutView
            state={completedWorkoutView}
            viewerId={viewer.id}
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
              setDetail(null);
              navigate(returnView);
            }}
          />
        )}
        {activeView === "today" &&
          !completedWorkoutView &&
          ((showingWorkoutPreview && workoutPreviewSchedule) ||
            (activeSession &&
              activeWorkoutVisible &&
              todayWorkout &&
              workoutFocus)) && (
          <TodayView
            program={showingWorkoutPreview ? previewProgram : todayProgram}
            viewerId={viewer.id}
            workout={
              showingWorkoutPreview
                ? workoutPreviewSchedule!.workout
                : todayWorkout!
            }
            weightUnit={workspace.profile.weightUnit}
            timing={showingWorkoutPreview ? "future" : workoutFocus!.timing}
            plannedDate={
              showingWorkoutPreview
                ? workoutPreviewSchedule!.plannedDate
                : workoutFocus!.plannedDate
            }
            workoutStarted={!showingWorkoutPreview && workoutStarted}
            workoutComplete={!showingWorkoutPreview && workoutComplete}
            workoutAction={showingWorkoutPreview ? null : workoutAction}
            setLogs={setLogs}
            resultLogs={resultLogs}
            sessionRpe={sessionRpe}
            sessionNote={sessionNote}
            sessionSaveStatus={sessionSaveStatus}
            localRecoveryAvailable={localRecoveryAvailable}
            online={isOnline}
            onStart={() =>
              void startWorkout(
                showingWorkoutPreview ? workoutPreviewSchedule! : todaySchedule!,
              )
            }
            allowStart={!showingWorkoutPreview || !activeSession}
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
              !showingWorkoutPreview && activeSession && todaySchedule
                ? () => void setScheduledWorkoutStatus(todaySchedule.id, "planned")
                : undefined
            }
            onSkip={
              displayedSchedule
                ? () =>
                    void setScheduledWorkoutStatus(
                      displayedSchedule.id,
                      "skipped",
                    )
                : undefined
            }
            statusAction={
              scheduleStatusAction?.id ===
              displayedSchedule?.id
                ? (scheduleStatusAction?.status ?? null)
                : null
            }
            viewMode={showingWorkoutPreview}
            onBack={
              showingWorkoutPreview
                ? () => {
                    const returnView = workoutPreviewReturnView;
                    setDetail(null);
                    navigate(returnView);
                  }
                : activeSession
                ? () => setActiveWorkoutVisible(false)
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
                    setDetail(null);
                    navigate("calendar");
                    void openSchedule(scheduleId);
                  }
                : undefined
            }
            onRemoveFromCalendar={
              workoutPreviewSchedule
                ? () => {
                    const scheduleId = workoutPreviewSchedule.id;
                    const returnView = workoutPreviewReturnView;
                    void saveSchedule(scheduleId, null)
                      .then(() => {
                        setDetail(null);
                        navigate(returnView);
                      })
                      .catch((error) =>
                        notify(
                          error instanceof Error
                            ? error.message
                            : "The workout could not be removed from the calendar",
                        ),
                      );
                  }
                : undefined
            }
            onViewProgram={
              showingWorkoutPreview &&
              workoutPreviewSchedule &&
              previewProgram?.contentType !== "quick_workout"
                ? () => void viewScheduledPlan(workoutPreviewSchedule)
                : undefined
            }
          />
        )}
        {activeView === "today" &&
          !completedWorkoutView &&
          (!activeSession || !activeWorkoutVisible) &&
          !workoutPreviewSchedule && (
          <NextWorkoutsView
            schedules={upcomingWorkouts}
            hasProgram={schedulablePrograms.length > 0}
            hasPublishedProgram={schedulablePrograms.some(
              (candidate) => candidate.versionStatus === "published",
            )}
            startingScheduleId={startingScheduleId}
            activeScheduleId={
              activeSession
                ? (todaySchedule?.id ?? activeSession.scheduledWorkoutId ?? null)
                : null
            }
            onNavigate={navigate}
            onSchedule={() => openSchedule()}
            onStart={(schedule) => {
              if (
                activeSession &&
                schedule.id ===
                  (todaySchedule?.id ?? activeSession.scheduledWorkoutId)
              ) {
                setActiveWorkoutVisible(true);
                return;
              }
              void startWorkout(schedule);
            }}
            onOpen={(schedule) => {
              if (
                activeSession &&
                schedule.id ===
                  (todaySchedule?.id ?? activeSession.scheduledWorkoutId)
              ) {
                setActiveWorkoutVisible(true);
                return;
              }
              openWorkoutPreview(schedule);
            }}
            onSetStatus={(scheduleId, status) => {
              void setScheduledWorkoutStatus(scheduleId, status);
            }}
            statusAction={scheduleStatusAction}
          />
        )}
        {activeView === "program" && program && currentWeek && (
          <Suspense
            fallback={
              <div className="feature-load-status" role="status">
                <LoaderCircle size={16} className="spin" />
                Opening program…
              </div>
            }
          >
            <ProgramView
            key={`${program.id}:${program.versionId}`}
            program={program}
            action={
              programAction?.id === program.id ? programAction.kind : null
            }
            mutationPending={builderMutationPending}
            viewerId={viewer.id}
            capabilities={capabilitiesForProgram(program)}
            currentWeek={currentWeek}
            selectedWeek={selectedWeek}
            selectedWorkout={selectedWorkout}
            selectedSectionId={selectedSectionId}
            onSearchExercises={searchBuilderExercises}
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
            onSave={(title, description) =>
              void publishProgram(title, description)
            }
            onCreateDraft={createEditableDraft}
            onBack={() => {
              setProgram(null);
              if (program.athleteId !== viewer.id) {
                setCoachMode("coach");
                setActiveView("coaching");
              }
            }}
            onAssignProgram={
              capabilitiesForProgram(program).assign
                ? () => void openAssignmentModal({ programId: program.id })
                : undefined
            }
            onEditWorkout={() => setModal("workout-settings")}
            onSchedule={
              capabilitiesForProgram(program).schedule
                ? () => openSchedule()
                : undefined
            }
            renderWorkoutDetails={(workout) => (
              <ProgramWorkoutDetails
                workout={workout}
                weightUnit={workspace.profile.weightUnit}
              />
            )}
            renderWorkoutItem={(item) => (
              <WorkoutLogItem
                item={item}
                active={false}
                weightUnit={workspace.profile.weightUnit}
                showSetControls={false}
                builderPreview
                setLogs={programPreviewSetLogs(item)}
                resultLog={programPreviewResultLog(item)}
                onUpdateSet={() => undefined}
                onAddSet={() => undefined}
                onRemoveSet={() => undefined}
                onUpdateResult={() => undefined}
              />
            )}
            />
          </Suspense>
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
              viewerId={viewer.id}
              schedules={workspace.scheduledWorkouts}
              source={programSource}
              hasCoach={hasCoach}
              hasMore={Boolean(programCursor)}
              loadingMore={programsLoadingMore}
              loadError={programsLoadError}
              action={programAction}
              capabilitiesForProgram={capabilitiesForProgram}
              onOpen={(targetProgram) => void openProgram(targetProgram)}
              onEdit={editProgram}
              onDelete={deleteOwnProgram}
              onSource={setProgramSource}
              onCreate={() => {
                setProgramTarget({
                  id: viewer.id,
                  name: workspace.profile.displayName,
                });
                setModal("program");
              }}
              onCreateWorkout={() => setModal("quick-workout")}
              onSchedule={() => openSchedule()}
              onLoadMore={() => void loadMorePrograms()}
            />
          ))}
        {activeView === "calendar" && (
          <>
            {calendarRangeLoading && (
              <div className="feature-load-status" role="status" aria-live="polite">
                <LoaderCircle size={16} className="spin" />
                Loading calendar…
              </div>
            )}
            {calendarRangeError && (
              <div className="feature-load-status error" role="alert">
                <span>{calendarRangeError}</span>
                <button
                  className="text-button"
                  onClick={() => {
                    const range = lastCalendarRangeRef.current;
                    if (range) {
                      void loadVisibleCalendarRange(range.start, range.end);
                    }
                  }}
                >
                  Try again
                </button>
              </div>
            )}
            <Suspense
              fallback={
                <div className="feature-load-status" role="status">
                  <LoaderCircle size={16} className="spin" />
                  Opening calendar…
                </div>
              }
            >
              <CalendarView
                sessions={calendarRangeData.completedSessions}
                schedules={calendarRangeData.scheduledWorkouts}
                weekStartsOnSunday={workspace.profile.weekStartsOnSunday}
                canSchedule={
                  Boolean(repository) ||
                  scheduleCandidates.length > 0 ||
                  schedulablePrograms.some(
                    (candidate) => candidate.versionStatus === "published",
                  )
                }
                onNavigate={navigate}
                onSchedule={() => openSchedule()}
                onOpenPlan={openCalendarPlan}
                onOpenResults={openCalendarResults}
                onScheduleDay={(date) => openSchedule(undefined, date)}
                onMoveSchedule={(scheduleId, date) => {
                  void saveSchedule(scheduleId, date);
                }}
                onRemoveSchedule={(scheduleId) => {
                  void saveSchedule(scheduleId, null);
                }}
                onVisibleRangeChange={loadVisibleCalendarRange}
              />
            </Suspense>
          </>
        )}
        {activeView === "exercises" && (
          <ExercisesHome
            scope={exerciseScope}
            query={exerciseQuery}
            filters={exerciseFilters}
            global={visibleGlobalExercises}
            personal={visiblePersonalExercises}
            copyingExerciseId={copyingExerciseId}
            loading={exerciseSearchLoading}
            loadError={exerciseSearchError}
            hasMore={Boolean(exerciseCursor)}
            onScope={(scope) => {
              setExerciseScope(scope);
              setExerciseFilters(emptyExerciseLibraryFilters());
            }}
            onQuery={setExerciseQuery}
            onFilters={setExerciseFilters}
            onAdd={() => {
              setExerciseEditing(null);
              setExerciseDetailTarget(null);
              setModal("exercise");
            }}
            onOpen={(exercise) => {
              setExerciseDetailTarget(exercise);
              setModal("exercise-details");
            }}
            onCopy={(exercise) => void copyLibraryExercise(exercise)}
            onEdit={(exercise) => {
              setExerciseEditing(exercise);
              setExerciseDetailTarget(exercise);
              setModal("exercise");
            }}
            onDelete={(exercise) => {
              setExerciseDeleteTarget(exercise);
              setModal("delete-exercise");
            }}
            onLoadMore={() => void loadMoreExercises()}
            onRetry={() =>
              setExerciseSearchRetryKey((current) => current + 1)
            }
          />
        )}
        {activeView === "coaching" && (
          <CoachingView
            mode={coachMode}
            viewerId={viewer.id}
            coachConnections={workspace.coachConnections}
            pendingInvites={workspace.pendingCoachInvites}
            outgoingInvites={outgoingCoachInvites}
            athletes={workspace.coachedAthletes}
            hasMoreAthletes={Boolean(coachAthleteCursor)}
            loadingMoreAthletes={coachAthletesLoadingMore}
            athletesLoadError={coachAthletesLoadError}
            selectedAthlete={selectedAthlete}
            loadingAthleteId={coachingDetailLoadingId}
            openingProgramId={openingCoachProgramId}
            onMode={changeCoachMode}
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
            onSelectAthlete={selectCoachedAthlete}
            onLoadMoreAthletes={() => void loadMoreCoachAthletes()}
            onOpenAssignedProgram={(athlete, assignedProgram, workoutId) =>
              void openAthleteProgram(athlete, assignedProgram, workoutId)
            }
            onOpenAgendaEntry={openCoachAgendaEntry}
            onAssignAthlete={(athlete) =>
              void openAssignmentModal({ athleteIds: [athlete.id] })
            }
          />
        )}
      </section>

      {modal === "exercise" && (
        <ExerciseModal
          exercise={exerciseEditing}
          onClose={() => {
            setExerciseEditing(null);
            setModal(exerciseDetailTarget ? "exercise-details" : null);
          }}
          onSave={(name, discipline, category, mode, cue) =>
            exerciseEditing
              ? updatePersonalExercise(
                  exerciseEditing,
                  name,
                  discipline,
                  category,
                  mode,
                  cue,
                )
              : addPersonalExercise(name, discipline, category, mode, cue)
          }
        />
      )}
      {modal === "exercise-details" && exerciseDetailTarget && (
        <ExerciseDetailsModal
          exercise={exerciseDetailTarget}
          copying={copyingExerciseId === exerciseDetailTarget.id}
          onClose={() => {
            setExerciseDetailTarget(null);
            setModal(null);
          }}
          onCopy={
            exerciseDetailTarget.scope === "global"
              ? () => void copyLibraryExercise(exerciseDetailTarget)
              : undefined
          }
          onEdit={
            exerciseDetailTarget.scope === "personal"
              ? () => {
                  setExerciseEditing(exerciseDetailTarget);
                  setModal("exercise");
                }
              : undefined
          }
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
      {modal === "delete-content" && contentDeleteTarget && (
        <DeleteContentModal
          target={contentDeleteTarget}
          onClose={() => {
            setContentDeleteTarget(null);
            setModal(null);
          }}
          onDelete={() => confirmContentDeletion(contentDeleteTarget)}
        />
      )}
      {modal === "workout" && (
        <WorkoutModal onClose={() => setModal(null)} onSave={addWorkout} />
      )}
      {modal === "workout-settings" && selectedWorkout && (
        <WorkoutSettingsModal
          workout={selectedWorkout}
          description={
            program?.contentType === "quick_workout"
              ? program.description
              : undefined
          }
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
          hasMoreAthletes={Boolean(coachAthleteCursor)}
          loadingMoreAthletes={coachAthletesLoadingMore}
          athletesLoadError={coachAthletesLoadError}
          initialProgramId={assignmentSeed.programId}
          initialAthleteIds={assignmentSeed.athleteIds}
          onClose={() => {
            setAssignmentSeed({});
            setModal(null);
          }}
          onAssign={assignProgramToAthletes}
          onAssignQuickWorkout={assignQuickWorkoutToAthletes}
          onLoadMoreAthletes={() => void loadMoreCoachAthletes()}
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
          key={`${scheduleEditingId ?? "new"}:${scheduleInitialDate ?? "today"}`}
          candidates={scheduleCandidates}
          schedules={workspace.scheduledWorkouts}
          editingId={scheduleEditingId}
          initialDate={scheduleInitialDate}
          loading={scheduleCandidatesLoading}
          error={scheduleCandidatesError}
          hasMore={Boolean(scheduleCandidateCursor)}
          onLoadMore={() => void loadScheduleCandidates(false)}
          onRetry={() => void loadScheduleCandidates(true)}
          onClose={() => {
            setScheduleEditingId(null);
            setScheduleInitialDate(null);
            setModal(null);
          }}
          onSave={saveScheduleCandidate}
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
      {sessionDraftConflict && (
        <ModalShell
          title="Workout changed elsewhere"
          description="Your entries are safe. Non-conflicting values from both copies were merged; choose which copy wins only where the same value changed in both."
          onClose={() => undefined}
          dismissible={false}
        >
          <InlineError>
            {sessionDraftConflict.conflicts[0] === "workout"
              ? "This older recovery copy has no trustworthy merge base, so choose the whole draft."
              : `${sessionDraftConflict.conflicts.length} conflicting ${sessionDraftConflict.conflicts.length === 1 ? "value needs" : "values need"} your choice.`}
          </InlineError>
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => resolveSessionDraftConflict(false)}
            >
              Use last saved
            </button>
            <button
              className="button primary"
              data-modal-initial-focus
              onClick={() => resolveSessionDraftConflict(true)}
            >
              Keep this device
            </button>
          </div>
        </ModalShell>
      )}
      {toast && <Toast message={toast} />}
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
                aria-current={activeView === item.id ? "page" : undefined}
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

function NextWorkoutsView({
  schedules,
  hasProgram,
  hasPublishedProgram,
  startingScheduleId,
  activeScheduleId,
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
  activeScheduleId: string | null;
  onNavigate: (view: ViewName) => void;
  onSchedule: () => void;
  onStart: (schedule: ScheduledWorkout) => void;
  onOpen: (schedule: ScheduledWorkout) => void;
  onSetStatus: (scheduleId: string, status: "planned" | "skipped") => void;
  statusAction: { id: string; status: "planned" | "skipped" } | null;
}) {
  const [page, setPage] = useState(0);
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(schedules.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleSchedules = schedules.slice(
    currentPage * pageSize,
    currentPage * pageSize + pageSize,
  );
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
          {visibleSchedules.map((schedule) => {
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
                    loadingLabel="Starting…"
                    icon={Activity}
                    onClick={() => onStart(schedule)}
                  >
                    {activeScheduleId === schedule.id
                      ? "Resume workout"
                      : "Start workout"}
                  </AsyncButton>
                )}
              </article>
            );
          })}
        </section>
        {pageCount > 1 && (
          <nav className="library-pagination" aria-label="Upcoming workout pages">
            <button
              className="button secondary small"
              disabled={currentPage === 0}
              onClick={() => setPage((current) => Math.max(0, current - 1))}
            >
              <ArrowLeft size={14} /> Previous
            </button>
            <span>Page {currentPage + 1} of {pageCount}</span>
            <button
              className="button secondary small"
              disabled={currentPage >= pageCount - 1}
              onClick={() =>
                setPage((current) => Math.min(pageCount - 1, current + 1))
              }
            >
              Next <ArrowRight size={14} />
            </button>
          </nav>
        )}
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
  viewerId,
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
  sessionSaveStatus,
  localRecoveryAvailable,
  online,
  onStart,
  allowStart = true,
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
  onViewProgram,
}: {
  program?: Program;
  viewerId: string;
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
  sessionSaveStatus: SessionDraftSaveStatus;
  localRecoveryAvailable: boolean;
  online: boolean;
  onStart: () => void;
  allowStart?: boolean;
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
  onViewProgram?: () => void;
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
  const isQuickWorkout = program?.contentType === "quick_workout";
  const planDescription = isQuickWorkout
    ? undefined
    : workoutWeek
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
        <div className={`workout-preview-actions${workoutStarted ? " started" : ""}`}>
        {program && (
          <SourceTag
            presentation={presentProgramProvenance(program, viewerId)}
          />
        )}
        {onBack && (
          <button className="button secondary workout-back-action" onClick={onBack}>
            <ArrowLeft size={15} />
            <span className="workout-action-full">{backLabel}</span>
            <span className="workout-action-compact">Workouts</span>
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
            className="button secondary"
            onClick={onRemoveFromCalendar}
            aria-label="Remove workout from calendar"
            title="Remove from calendar"
          >
            <CalendarMinus size={15} />
            <span className="workout-action-full">Remove from calendar</span>
            <span className="workout-action-compact">Unschedule</span>
          </button>
        )}
        {workoutStarted && onSetPlanned && onSkip && (
          <>
            <button
              className="button secondary workout-back-action"
              disabled={statusAction !== null}
              onClick={onSetPlanned}
              aria-label="Set back to planned"
            >
              {statusAction === "planned" ? (
                <>
                  <LoaderCircle className="button-spinner" size={15} />
                  Restoring…
                </>
              ) : (
                <>
                  <RefreshCw size={15} />
                  <span className="workout-action-full">Set back to planned</span>
                  <span className="workout-action-compact">Planned</span>
                </>
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
                <>
                  <span className="workout-action-full">Skip workout</span>
                  <span className="workout-action-compact">Skip</span>
                </>
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
              <>
                <span className="workout-action-full">Skip workout</span>
                <span className="workout-action-compact">Skip</span>
              </>
            )}
          </button>
        )}
        {viewMode && onViewProgram && (
          <button className="button secondary" onClick={onViewProgram}>
            <BookOpen size={15} />
            View program
          </button>
        )}
        </div>
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
              {!isQuickWorkout && (
                <p className="eyebrow">
                  {workoutWeek
                    ? `Session ${workoutIndex + 1} of ${workoutWeek.workouts.length}`
                    : "Scheduled session"}
                </p>
              )}
              <h2>{workout.title}</h2>
              {isQuickWorkout ? (
                program.description && <p>{program.description}</p>
              ) : (
                <p>
                  {workout.dayLabel} · follow the prescription and adjust to how
                  you feel on the day.
                </p>
              )}
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
                  setLogs={setLogs[item.id] ?? emptySetLogs}
                  resultLog={resultLogs[item.id] ?? emptyResultLog}
                  onUpdateSet={onUpdateSet}
                  onAddSet={onAddSet}
                  onRemoveSet={onRemoveSet}
                  onUpdateResult={onUpdateResult}
                />
              ))}
            </section>
          ))}
          {!workoutStarted && !workoutComplete && allowStart && (
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
              <div className="session-rpe-field" role="group" aria-labelledby="session-rpe-label">
                <span id="session-rpe-label">Session RPE</span>
                <small>How did the whole session feel?</small>
                <RpeChoiceButtons value={sessionRpe} onChange={onSessionRpe} />
              </div>
              <RpeLegend />
              <label>
                <span>
                  Session notes <em>optional</em>
                </span>
                <textarea
                  value={sessionNote}
                  onChange={(event) => onSessionNote(event.target.value)}
                  maxLength={4000}
                  placeholder="What felt good? Anything to adjust next time?"
                />
              </label>
              <SessionSaveIndicator
                status={sessionSaveStatus}
                online={online}
                localRecoveryAvailable={localRecoveryAvailable}
              />
              <AsyncButton
                className="button primary full"
                loading={workoutAction === "finishing"}
                loadingLabel="Finishing session…"
                icon={Check}
                disabled={!online}
                title={online ? undefined : "Reconnect before finishing this workout"}
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
  { value: "5", label: "Light", detail: "5+ left" },
  { value: "6", label: "Easy", detail: "4+ left" },
  { value: "7", label: "Moderate", detail: "3 left" },
  { value: "8", label: "Hard", detail: "2 left" },
  { value: "9", label: "Very hard", detail: "1 left" },
  { value: "10", label: "Max", detail: "None left" },
] as const;

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

export function RpeChoiceButtons({
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
          aria-pressed={value === option.value}
        >
          <strong>{option.value}</strong>
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

export function PlannedRpeSelect({
  value,
  onChange,
  disabled = false,
  ariaLabel = "Planned RPE",
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div className="planned-rpe-select">
      <RpeSelect
        disabled={disabled}
        ariaLabel={ariaLabel}
        value={value}
        emptyLabel="No target"
        intent="planned"
        onChange={onChange}
      />
    </div>
  );
}

export function RpeSelect({
  disabled,
  value,
  onChange,
  ariaLabel = "Actual RPE",
  emptyLabel = "Not logged",
  intent = "actual",
}: {
  disabled: boolean;
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  emptyLabel?: string;
  intent?: "actual" | "planned";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const helpId = useId();
  const selected = rpeOptions.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className={cn("rpe-select", open && "open")} ref={rootRef}>
      <button
        type="button"
        disabled={disabled}
        className={cn("rpe-select-trigger", value && "selected", value && `rpe-${rpeTone(value)}`)}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <strong>{selected?.value ?? "—"}</strong>
        <ChevronDown size={14} aria-hidden />
      </button>
      {open && !disabled && (
        <div className="rpe-select-menu">
          <p className="rpe-select-help" id={helpId}>
            <strong>RPE</strong>{" "}
            {intent === "planned"
              ? "sets the intended difficulty by how many good reps should remain."
              : "shows how hard the set felt by how many good reps you had left."}
          </p>
          <div
            className="rpe-select-options"
            role="listbox"
            aria-label={`${ariaLabel} options`}
            aria-describedby={helpId}
          >
            <button
              type="button"
              role="option"
              aria-selected={!value}
              className={!value ? "selected" : undefined}
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              <strong>—</strong>
              <span>{emptyLabel}</span>
            </button>
            {rpeOptions.map((option) => (
              <button
                type="button"
                role="option"
                key={option.value}
                aria-label={`RPE ${option.value}: ${option.detail}`}
                aria-selected={value === option.value}
                className={cn(
                  value === option.value && "selected",
                  `rpe-${rpeTone(option.value)}`,
                )}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <strong>{option.value}</strong>
                <span>{option.detail}</span>
              </button>
            ))}
          </div>
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

function workoutLogFields(item: Pick<WorkoutItem, "mode" | "fields">) {
  return trackingFieldsForMode(item.mode, item.fields);
}

const WorkoutLogItem = memo(function WorkoutLogItem({
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
  const fields = workoutLogFields(item);
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
            <>
              <div className="builder-exercise-title-row">
                <strong>{item.title}</strong>
              </div>
              {prescriptionSummary}
            </>
          ) : (
            <strong>{item.title}</strong>
          )}
          <small>{note}</small>
        </div>
        {!builderPreview && prescriptionSummary}
      </div>
      {item.mode === "sets" && (
        <div
          className={cn(
            "set-table",
            `tracking-${fields.length}`,
            showSetControls && "has-set-controls",
          )}
        >
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
                  aria-label={`${item.title}, set ${index + 1}, reps`}
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
                  aria-label={`${item.title}, set ${index + 1}, load in ${weightUnit}`}
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
                  ariaLabel={`${item.title}, set ${index + 1}, actual RPE`}
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
      {item.mode === "intervals" && (
        <IntervalLogTable
          item={item}
          active={active}
          resultLog={resultLog}
          onUpdate={(field, value) => onUpdateResult(item.id, field, value)}
        />
      )}
      {item.mode === "result" && (
        <div className="result-fields">
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
          {fields.includes("load") && (
            <ResultInput
              label="Load"
              unit={weightUnit}
              disabled={!active}
              value={weightInputValue(resultLog.load ?? "", weightUnit)}
              onChange={(value) =>
                onUpdateResult(item.id, "load", weightKgValue(value, weightUnit))
              }
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
});

function IntervalLogTable({
  item,
  active,
  resultLog,
  onUpdate,
}: {
  item: WorkoutItem;
  active: boolean;
  resultLog: Record<string, string>;
  onUpdate: (field: string, value: string) => void;
}) {
  const rounds = intervalPrescriptionEntries(item);
  const fields = workoutLogFields(item);
  const metricFields = (["duration", "distance", "heartRate", "rpe"] as const).filter(
    (field) => fields.includes(field),
  );
  const completedRounds = rounds.filter((_, index) =>
    Boolean(resultLog[`round.${index}.completed`]),
  ).length;
  const plannedSeconds = rounds.reduce(
    (total, round) =>
      total + (round.workSeconds ?? 0) + (round.restSeconds ?? 0),
    0,
  );
  const totalDistance = rounds.reduce(
    (total, _, index) =>
      total + (Number(resultLog[`round.${index}.distance`]) || 0),
    0,
  );

  return (
    <div className={cn("interval-log-table", `metrics-${metricFields.length}`)}>
      <div className="interval-log-header" aria-hidden>
        <span>Round</span>
        <span>Plan</span>
        {fields.includes("duration") && <span>Time</span>}
        {fields.includes("distance") && <span>Distance</span>}
        {fields.includes("heartRate") && <span>Avg HR</span>}
        {fields.includes("rpe") && <span>RPE</span>}
      </div>
      {rounds.map((round, index) => {
        const completedKey = `round.${index}.completed`;
        const completed = Boolean(resultLog[completedKey]);
        return (
          <div className="interval-log-row" key={index}>
            {fields.includes("rounds") ? (
              <button
                type="button"
                className={cn("interval-round-toggle", completed && "completed")}
                disabled={!active}
                aria-label={`Mark round ${index + 1} ${completed ? "incomplete" : "complete"}`}
                aria-pressed={completed}
                onClick={() => onUpdate(completedKey, completed ? "" : "1")}
              >
                {completed ? <Check size={13} /> : index + 1}
              </button>
            ) : (
              <span className="interval-round-number">{index + 1}</span>
            )}
            <span className="interval-plan-cell">
              {round.workSeconds ?? "—"}/{round.restSeconds ?? "—"}
              <small>s</small>
            </span>
            {fields.includes("duration") && (
              <input
                aria-label={`${item.title}, round ${index + 1}, actual duration in seconds`}
                disabled={!active}
                inputMode="numeric"
                placeholder="sec"
                value={resultLog[`round.${index}.duration`] ?? ""}
                onChange={(event) =>
                  onUpdate(`round.${index}.duration`, event.target.value)
                }
              />
            )}
            {fields.includes("distance") && (
              <input
                aria-label={`${item.title}, round ${index + 1}, distance in kilometres`}
                disabled={!active}
                inputMode="decimal"
                placeholder="km"
                value={resultLog[`round.${index}.distance`] ?? ""}
                onChange={(event) =>
                  onUpdate(`round.${index}.distance`, event.target.value)
                }
              />
            )}
            {fields.includes("heartRate") && (
              <input
                aria-label={`${item.title}, round ${index + 1}, average heart rate`}
                disabled={!active}
                inputMode="numeric"
                placeholder="bpm"
                value={resultLog[`round.${index}.heartRate`] ?? ""}
                onChange={(event) =>
                  onUpdate(`round.${index}.heartRate`, event.target.value)
                }
              />
            )}
            {fields.includes("rpe") && (
              <RpeSelect
                ariaLabel={`${item.title}, round ${index + 1}, actual RPE`}
                disabled={!active}
                value={resultLog[`round.${index}.rpe`] ?? ""}
                onChange={(value) => onUpdate(`round.${index}.rpe`, value)}
              />
            )}
          </div>
        );
      })}
      <div className="interval-log-summary">
        <span>{completedRounds}/{rounds.length} rounds completed</span>
        <span>{Math.round(plannedSeconds / 60)} min planned</span>
        {totalDistance > 0 && <span>{totalDistance.toFixed(2)} km total</span>}
      </div>
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
    load: prescription.loadKg?.toString() ?? "",
    rpe: "",
  };
}

function ProgramRow({
  program,
  viewerId,
  canEdit,
  canDelete,
  workoutStates,
  workoutStatus,
  action,
  onOpen,
  onEdit,
  onDelete,
  onSchedule,
}: {
  program: Program;
  viewerId: string;
  canEdit: boolean;
  canDelete: boolean;
  workoutStates?: ProgramWorkoutProgressState[];
  workoutStatus?: SingleWorkoutStatusSummary;
  action: Exclude<ProgramAction, null>["kind"] | null;
  onOpen: () => void;
  onEdit: () => void;
  onDelete?: () => void;
  onSchedule?: () => void;
}) {
  const isQuickWorkout = program.contentType === "quick_workout";
  const objectLabel = isQuickWorkout ? "Workout" : "Program";
  const weekCount = programWeekCount(program);
  const workoutCount = programWorkoutCount(program);
  const runStatus = deriveProgramRunStatus(
    program.versionStatus === "draft",
    workoutStates ?? [],
  );
  const completedWorkoutCount =
    workoutStates?.filter((state) => state === "completed").length ?? 0;
  const singleWorkoutStatus =
    workoutStatus?.status ??
    (program.versionStatus === "draft" ? "draft" : "ready");
  const showProgress =
    !isQuickWorkout &&
    program.versionStatus === "published";
  const runStatusTone = (status: ProgramRunStatus) => {
    if (status === "scheduled") return "planned" as const;
    if (status === "needs_attention") return "pending" as const;
    return status;
  };
  const cardDateLabel = (value?: string) =>
    value
      ? new Date(`${value}T12:00:00`).toLocaleDateString("en", {
          month: "short",
          day: "numeric",
        })
      : "Date unavailable";
  const singleWorkoutDetail = (() => {
    if (!workoutStatus) return "";
    if (workoutStatus.status === "scheduled") {
      return workoutStatus.upcomingCount > 1
        ? `${workoutStatus.upcomingCount} upcoming · Next ${cardDateLabel(workoutStatus.nextDate)}`
        : `Next ${cardDateLabel(workoutStatus.nextDate)}`;
    }
    if (workoutStatus.status === "in_progress") {
      return workoutStatus.nextDate
        ? `Started ${cardDateLabel(workoutStatus.nextDate)}`
        : "Workout started";
    }
    if (workoutStatus.status === "needs_attention") {
      return `Overdue ${cardDateLabel(workoutStatus.overdueDate)}`;
    }
    if (workoutStatus.status === "ready" && workoutStatus.lastCompletedDate) {
      return `Last completed ${cardDateLabel(workoutStatus.lastCompletedDate)}`;
    }
    return "";
  })();
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
            {program.sourceType !== "self" && (
              <SourceTag
                presentation={presentProgramProvenance(program, viewerId)}
                compact
              />
            )}
          </span>
          {action === "open" && (
            <span className="program-card-loading" aria-label={`Opening ${objectLabel.toLowerCase()}`}>
              <LoaderCircle className="button-spinner" size={16} />
            </span>
          )}
        </span>
        {program.description && (
          <span className="program-card-description">{program.description}</span>
        )}
        <span className="program-card-meta">
          {isQuickWorkout ? (
            <>
              <span>~{program.weeks[0]?.workouts[0]?.durationMinutes ?? 45} min</span>
              {singleWorkoutDetail && <span>{singleWorkoutDetail}</span>}
            </>
          ) : (
            <>
              <span>{formatWorkoutCount(workoutCount)}</span>
              <span>{weekCount} {weekCount === 1 ? "week" : "weeks"}</span>
            </>
          )}
        </span>
        {showProgress && workoutStates && (
          <span
            className="program-card-workout-progress"
            aria-label={`${program.title} workout scheduling progress`}
          >
            <small>
              <strong>{completedWorkoutCount} of {workoutStates.length}</strong> completed
            </small>
            <span>
              {workoutStates.map((state, index) => (
                <i
                  className={state}
                  key={`${index}-${state}`}
                  title={`Workout ${index + 1}: ${programWorkoutProgressLabel(state)}`}
                />
              ))}
            </span>
          </span>
        )}
      </button>
      <div className="program-card-footer">
        {isQuickWorkout ? (
          <StatusBadge
            status={runStatusTone(singleWorkoutStatus)}
            label={programRunStatusLabel(singleWorkoutStatus)}
          />
        ) : (
          <StatusBadge
            status={runStatusTone(runStatus)}
            label={programRunStatusLabel(runStatus)}
          />
        )}
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
          {canDelete && onDelete && (
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

function ProgramsHome({
  programs,
  viewerId,
  schedules,
  source,
  hasCoach,
  hasMore,
  loadingMore,
  loadError,
  action,
  capabilitiesForProgram,
  onOpen,
  onEdit,
  onDelete,
  onSource,
  onCreate,
  onCreateWorkout,
  onSchedule,
  onLoadMore,
}: {
  programs: Program[];
  viewerId: string;
  schedules: ScheduledWorkout[];
  source: ProgramSourceTab;
  hasCoach: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  loadError: string;
  action: ProgramAction;
  capabilitiesForProgram: (program: Program) => TrainingContentCapabilities;
  onOpen: (program: Program) => void;
  onEdit: (program: Program) => void;
  onDelete: (program: Program) => void;
  onSource: (source: ProgramSourceTab) => void;
  onCreate: () => void;
  onCreateWorkout: () => void;
  onSchedule: () => void;
  onLoadMore: () => void;
}) {
  const [contentQuery, setContentQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedTypes, setSelectedTypes] = useState<
    Array<"program" | "quick_workout">
  >([]);
  const [selectedStatuses, setSelectedStatuses] = useState<ProgramRunStatus[]>([]);
  const [page, setPage] = useState(0);
  const pageSize = 20;
  const own = programs.filter((program) => program.sourceType === "self");
  const coach = programs.filter((program) => program.sourceType === "coach");
  const progressByProgramId = useMemo(() => {
    const today = localDateOnly();
    const schedulesByVersion = new Map<string, ScheduledWorkout[]>();
    for (const schedule of schedules) {
      const group = schedulesByVersion.get(schedule.programVersionId) ?? [];
      group.push(schedule);
      schedulesByVersion.set(schedule.programVersionId, group);
    }
    const result = new Map<
      string,
      {
        workoutStates: ProgramWorkoutProgressState[];
        workoutStatus: SingleWorkoutStatusSummary;
      }
    >();
    for (const program of programs) {
      const programSchedules = schedulesByVersion.get(program.versionId) ?? [];
      const latestScheduleByWorkout = new Map<string, ScheduledWorkout>();
      for (const schedule of programSchedules) {
        const current = latestScheduleByWorkout.get(schedule.workoutId);
        if (!current || schedule.sequenceNumber > current.sequenceNumber)
          latestScheduleByWorkout.set(schedule.workoutId, schedule);
      }
      result.set(program.id, {
        workoutStates: programWorkoutIds(program).map((workoutId) =>
          deriveProgramWorkoutProgressState(
            latestScheduleByWorkout.get(workoutId),
            today,
          ),
        ),
        workoutStatus: deriveSingleWorkoutStatus(
          program.versionStatus === "draft",
          programSchedules,
          today,
        ),
      });
    }
    return result;
  }, [programs, schedules]);
  const scheduleProgress = (program: Program) =>
    progressByProgramId.get(program.id) ?? {
      workoutStates: [],
      workoutStatus: deriveSingleWorkoutStatus(
        program.versionStatus === "draft",
        [],
        localDateOnly(),
      ),
    };
  const content = source === "own" ? own : coach;
  const statusOptions: ProgramRunStatus[] = [
    "draft",
    "ready",
    "scheduled",
    "in_progress",
    "needs_attention",
    "completed",
  ];
  const statusForItem = (item: Program): ProgramRunStatus => {
    const progress = scheduleProgress(item);
    return item.contentType === "quick_workout"
      ? progress.workoutStatus.status
      : deriveProgramRunStatus(
          item.versionStatus === "draft",
          progress.workoutStates,
        );
  };
  const filteredContent = content.filter((item) => {
    const contentType = item.contentType ?? "program";
    return (
      `${item.title} ${item.description}`
        .toLowerCase()
        .includes(contentQuery.trim().toLowerCase()) &&
      (!selectedTypes.length || selectedTypes.includes(contentType)) &&
      (!selectedStatuses.length || selectedStatuses.includes(statusForItem(item)))
    );
  });
  const activeFilterCount = selectedTypes.length + selectedStatuses.length;
  function toggleProgramFilter<T extends string>(
    value: T,
    setValues: Dispatch<SetStateAction<T[]>>,
  ) {
    setPage(0);
    setValues((current) =>
      current.includes(value)
        ? current.filter((candidate) => candidate !== value)
        : [...current, value],
    );
  }
  function resetProgramFilters() {
    setPage(0);
    setSelectedTypes([]);
    setSelectedStatuses([]);
    setContentQuery("");
  }
  const sortDraftsFirst = (items: Program[]) =>
    [...items].sort(
      (left, right) =>
        Number(left.versionStatus !== "draft") -
        Number(right.versionStatus !== "draft"),
    );
  const programItems = sortDraftsFirst(
    filteredContent.filter((item) => item.contentType !== "quick_workout"),
  );
  const workoutItems = sortDraftsFirst(
    filteredContent.filter((item) => item.contentType === "quick_workout"),
  );
  const orderedContent = [...programItems, ...workoutItems];
  const pageCount = Math.max(1, Math.ceil(orderedContent.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleIds = new Set(
    orderedContent
      .slice(currentPage * pageSize, currentPage * pageSize + pageSize)
      .map((item) => item.id),
  );
  const visibleProgramItems = programItems.filter((item) => visibleIds.has(item.id));
  const visibleWorkoutItems = workoutItems.filter((item) => visibleIds.has(item.id));
  const renderRow = (item: Program) => (
    <ProgramRow
      key={item.id}
      program={item}
      viewerId={viewerId}
      {...scheduleProgress(item)}
      canEdit={capabilitiesForProgram(item).edit}
      canDelete={capabilitiesForProgram(item).deleteOwn}
      action={action?.id === item.id ? action.kind : null}
      onOpen={() => onOpen(item)}
      onEdit={() => onEdit(item)}
      onDelete={capabilitiesForProgram(item).deleteOwn ? () => onDelete(item) : undefined}
      onSchedule={capabilitiesForProgram(item).schedule ? onSchedule : undefined}
    />
  );
  return (
    <>
      <PageHeader
        eyebrow="Your training"
        title="Programs"
        description="Draft content stays editable. Final programs and workouts are ready to schedule."
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
      <section className="program-source-browser panel">
        <SegmentedTabs
          className="program-source-tabs"
          label="Program sources"
          panelId="program-source-panel"
          value={source}
          onChange={(nextSource) => {
            setPage(0);
            onSource(nextSource);
          }}
          tabs={[
            { value: "own", label: "Mine", icon: CircleUserRound },
            ...(hasCoach ? [{ value: "coach" as const, label: "Coach", icon: Users }] : []),
          ]}
        />
        <div className="library-toolbar program-filter-toolbar">
          <div className="library-filter-actions">
            <label className="search-field library-search">
              <Search size={17} />
              <input
                aria-label="Search programs and workouts"
                value={contentQuery}
                onChange={(event) => {
                  setPage(0);
                  setContentQuery(event.target.value);
                }}
                placeholder="Search programs and workouts"
              />
            </label>
            <button
              className={cn(
                "button secondary small library-filter-trigger",
                filtersOpen && "active",
              )}
              aria-expanded={filtersOpen}
              aria-controls="program-filter-panel"
              onClick={() => setFiltersOpen((open) => !open)}
            >
              <Settings2 size={15} />
              Filters{activeFilterCount ? ` · ${activeFilterCount}` : ""}
            </button>
          </div>
          {activeFilterCount > 0 && (
            <div className="library-active-filters" aria-label="Active program filters">
              {selectedTypes.map((type) => (
                <button
                  className="program-filter-type"
                  key={type}
                  onClick={() => toggleProgramFilter(type, setSelectedTypes)}
                >
                  {type === "program" ? "Programs" : "Single workouts"} <X size={12} />
                </button>
              ))}
              {selectedStatuses.map((status) => (
                <button
                  className="program-filter-status"
                  key={status}
                  onClick={() => toggleProgramFilter(status, setSelectedStatuses)}
                >
                  {programRunStatusLabel(status)} <X size={12} />
                </button>
              ))}
              <button className="clear" onClick={resetProgramFilters}>Clear</button>
            </div>
          )}
          {filtersOpen && (
            <div className="library-filter-panel program-filter-panel" id="program-filter-panel">
              <div>
                <span>Type</span>
                <div className="library-filter-chip-row">
                  {([
                    ["program", "Programs"],
                    ["quick_workout", "Single workouts"],
                  ] as const).map(([type, label]) => (
                    <button
                      className={cn(
                        "program-filter-type",
                        selectedTypes.includes(type) && "active",
                      )}
                      key={type}
                      onClick={() => toggleProgramFilter(type, setSelectedTypes)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span>Status</span>
                <div className="library-filter-chip-row">
                  {statusOptions.map((status) => (
                    <button
                      className={cn(
                        "program-filter-status",
                        selectedStatuses.includes(status) && "active",
                      )}
                      key={status}
                      onClick={() => toggleProgramFilter(status, setSelectedStatuses)}
                    >
                      {programRunStatusLabel(status)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="program-compact-list" id="program-source-panel" role="tabpanel">
          {filteredContent.length ? (
            <>
              {visibleProgramItems.length > 0 && (
                <section className="program-content-section" aria-labelledby="program-list-heading">
                  <div className="program-content-heading">
                    <span><Layers3 size={15} /><strong id="program-list-heading">Programs</strong></span>
                    <small>{programItems.length}</small>
                  </div>
                  <div className="program-content-cards">{visibleProgramItems.map(renderRow)}</div>
                </section>
              )}
              {visibleWorkoutItems.length > 0 && (
                <section className="program-content-section" aria-labelledby="workout-list-heading">
                  <div className="program-content-heading">
                    <span><Activity size={15} /><strong id="workout-list-heading">Single workouts</strong></span>
                    <small>{workoutItems.length}</small>
                  </div>
                  <div className="program-content-cards">{visibleWorkoutItems.map(renderRow)}</div>
                </section>
              )}
              {pageCount > 1 && (
                <nav className="library-pagination" aria-label="Program pages">
                  <button
                    className="button secondary small"
                    disabled={currentPage === 0}
                    onClick={() => setPage((current) => Math.max(0, current - 1))}
                  >
                    <ArrowLeft size={14} /> Previous
                  </button>
                  <span>Page {currentPage + 1} of {pageCount}</span>
                  <button
                    className="button secondary small"
                    disabled={currentPage >= pageCount - 1}
                    onClick={() =>
                      setPage((current) => Math.min(pageCount - 1, current + 1))
                    }
                  >
                    Next <ArrowRight size={14} />
                  </button>
                </nav>
              )}
              {loadError && <InlineError>{loadError}</InlineError>}
              {hasMore && (
                <button
                  className="button secondary small library-load-more"
                  disabled={loadingMore}
                  onClick={onLoadMore}
                >
                  {loadingMore && (
                    <LoaderCircle className="button-spinner" size={14} />
                  )}
                  {loadingMore ? "Loading…" : "Load more programs"}
                </button>
              )}
            </>
          ) : content.length ? (
            <div className="empty-state compact">
              <Search size={24} />
              <h3>No matching training content</h3>
              <p>Adjust the search or filters to see more programs and workouts.</p>
              <button className="button secondary small" onClick={resetProgramFilters}>
                Clear filters
              </button>
            </div>
          ) : (
            <div className="empty-state compact">
              <Dumbbell size={24} />
              <h3>{source === "own" ? "No training content yet" : "No coach content"}</h3>
              <p>{source === "own" ? "Create a program or a one-off workout when you are ready to plan training." : "Programs created for you by connected coaches will appear here."}</p>
            </div>
          )}
        </div>
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

function completedFieldLabel(
  field: TrackingField,
  weightUnit: OwnProfile["weightUnit"],
) {
  if (field === "reps") return "Reps";
  if (field === "load") return `Load ${weightUnit}`;
  if (field === "duration") return "Duration";
  if (field === "distance") return "Distance";
  if (field === "rounds") return "Rounds";
  if (field === "heartRate") return "Avg HR";
  return "RPE";
}

function completedFieldValue(
  entry: CompletedSessionDetail["items"][number]["entries"][number],
  field: TrackingField,
  weightUnit: OwnProfile["weightUnit"],
) {
  if (field === "reps") return entry.reps;
  if (field === "load")
    return entry.loadKg === undefined
      ? undefined
      : formatWeight(entry.loadKg, weightUnit);
  if (field === "duration") return entry.durationMinutes;
  if (field === "distance") return entry.distanceKm;
  if (field === "rounds") return entry.rounds;
  if (field === "heartRate") return entry.heartRate;
  return entry.rpe;
}

function CompletedWorkoutView({
  state,
  program,
  viewerId,
  weightUnit,
  onBack,
}: {
  state: CompletedWorkoutViewState;
  program?: Program;
  viewerId: string;
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
        {program && (
          <SourceTag
            presentation={presentProgramProvenance(program, viewerId)}
          />
        )}
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
              <strong
                className={
                  state.session.rpe
                    ? `rpe-${rpeTone(String(state.session.rpe))}`
                    : undefined
                }
              >
                {state.session.rpe || "—"}
              </strong>
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
            <InlineError>{state.error}</InlineError>
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
                    <div
                      className={cn(
                        "completed-log-table",
                        `tracking-${item.fields.length}`,
                      )}
                    >
                      <div className="completed-log-header" aria-hidden>
                        <span>{item.entries.length > 1 ? "Set" : "Result"}</span>
                        {item.fields.map((field) => (
                          <span key={field}>
                            {completedFieldLabel(field, weightUnit)}
                          </span>
                        ))}
                      </div>
                      {item.entries.map((entry) => (
                        <div
                          className="completed-log-entry"
                          key={entry.position}
                          aria-label={completedEntryLabel(entry, weightUnit)}
                        >
                          <span className="completed-log-position">
                            {item.entries.length > 1 ? entry.position + 1 : "—"}
                          </span>
                          {item.fields.map((field) => {
                            const value = completedFieldValue(
                              entry,
                              field,
                              weightUnit,
                            );
                            return (
                              <span
                                className={cn(
                                  "completed-log-value",
                                  field === "rpe" &&
                                    value !== undefined &&
                                    `rpe-${rpeTone(String(value))}`,
                                )}
                                key={field}
                              >
                                {value ?? "—"}
                              </span>
                            );
                          })}
                          {entry.note && (
                            <small className="completed-log-note">
                              {entry.note}
                            </small>
                          )}
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

const exerciseTrainingStyles: Array<{
  value: ExerciseDiscipline;
  label: string;
  icon: typeof Activity;
}> = [
  { value: "weightlifting", label: "Weightlifting", icon: Dumbbell },
  { value: "gym", label: "Gym", icon: BicepsFlexed },
  { value: "functional", label: "Functional", icon: Activity },
];

const exerciseCategories = [
  "General",
  "Bodybuilding",
  "Bodyweight",
  "Cardio",
  "Conditioning",
  "Core",
  "Functional fitness",
  "Gymnastics",
  "Mobility",
  "Strength",
] as const;

const exerciseFilterCategories = [
  "Weightlifting",
  ...exerciseCategories,
] as const;
const exerciseModeOptions: EntryMode[] = [
  "sets",
  "result",
  "intervals",
  "none",
];
const exerciseTrackingOptions: TrackingField[] = [
  "reps",
  "load",
  "duration",
  "distance",
  "rounds",
  "heartRate",
  "rpe",
];

function emptyExerciseLibraryFilters(): ExerciseLibraryFilters {
  return { disciplines: [], categories: [], modes: [], tracking: [] };
}

function toggleExerciseFilterValue<T extends string>(
  current: T[],
  value: T,
) {
  return current.includes(value)
    ? current.filter((candidate) => candidate !== value)
    : [...current, value];
}

function filterCompleteExerciseLibrary(
  exercises: Exercise[],
  query: string,
  filters: ExerciseLibraryFilters,
) {
  const normalizedQuery = query.trim().toLowerCase();
  return exercises.filter(
    (exercise) =>
      (!normalizedQuery ||
        `${exercise.name} ${exercise.category} ${modeLabel(exercise.defaultMode)} ${exercise.defaultFields.map(trackingFieldLabel).join(" ")}`
          .toLowerCase()
          .includes(normalizedQuery)) &&
      (!filters.disciplines.length ||
        filters.disciplines.includes(inferredExerciseDiscipline(exercise))) &&
      (!filters.categories.length ||
        filters.categories.includes(exercise.category)) &&
      (!filters.modes.length || filters.modes.includes(exercise.defaultMode)) &&
      filters.tracking.every((field) =>
        exercise.defaultFields.includes(field),
      ),
  );
}

function exerciseTrainingStyleLabel(style: ExerciseDiscipline) {
  return exerciseTrainingStyles.find((item) => item.value === style)?.label ?? "Gym";
}

function trackingFieldLabel(field: TrackingField) {
  return {
    reps: "Reps",
    load: "Load",
    duration: "Duration",
    distance: "Distance",
    rounds: "Rounds",
    heartRate: "Heart rate",
    rpe: "RPE",
  }[field];
}

function ExercisesHome({
  scope,
  query,
  filters,
  global,
  personal,
  copyingExerciseId,
  loading,
  loadError,
  hasMore,
  onScope,
  onQuery,
  onFilters,
  onAdd,
  onOpen,
  onCopy,
  onEdit,
  onDelete,
  onLoadMore,
  onRetry,
}: {
  scope: "global" | "personal";
  query: string;
  filters: ExerciseLibraryFilters;
  global: Exercise[];
  personal: Exercise[];
  copyingExerciseId: string | null;
  loading: boolean;
  loadError: string;
  hasMore: boolean;
  onScope: (scope: "global" | "personal") => void;
  onQuery: (query: string) => void;
  onFilters: (filters: ExerciseLibraryFilters) => void;
  onAdd: () => void;
  onOpen: (exercise: Exercise) => void;
  onCopy: (exercise: Exercise) => void;
  onEdit: (exercise: Exercise) => void;
  onDelete: (exercise: Exercise) => void;
  onLoadMore: () => void;
  onRetry: () => void;
}) {
  return (
    <>
      <PageHeader
        eyebrow="Exercise library"
        title="Exercises"
        description="Browse provided movements or build your own reusable exercise collection."
      >
        <button className="button primary" onClick={onAdd}>
          <Plus size={16} />
          New exercise
        </button>
      </PageHeader>
      <SegmentedTabs
        className="exercise-source-tabs"
        label="Exercise sources"
        panelId="exercise-library-results"
        value={scope}
        onChange={onScope}
        tabs={[
          {
            value: "global",
            label: `Library (${global.length}${scope === "global" && hasMore ? "+" : ""})`,
            icon: BookOpen,
          },
          {
            value: "personal",
            label: `My exercises (${personal.length}${scope === "personal" && hasMore ? "+" : ""})`,
            icon: CircleUserRound,
          },
        ]}
      />
      {loadError && (
        <div className="feature-load-status error" role="alert">
          <span>{loadError}</span>
          <button className="text-button" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
      <ExercisesView
        key={scope}
        scope={scope}
        query={query}
        filters={filters}
        global={global}
        personal={personal}
        copyingExerciseId={copyingExerciseId}
        loading={loading}
        hasMore={hasMore}
        onQuery={onQuery}
        onFilters={onFilters}
        onOpen={onOpen}
        onCopy={onCopy}
        onEdit={onEdit}
        onDelete={onDelete}
        onLoadMore={onLoadMore}
      />
    </>
  );
}

export function ExercisesView({
  scope,
  query,
  filters,
  global,
  personal,
  copyingExerciseId,
  loading,
  hasMore,
  onQuery,
  onFilters,
  onOpen,
  onCopy,
  onEdit,
  onDelete,
  onLoadMore,
}: {
  scope: "global" | "personal";
  query: string;
  filters: ExerciseLibraryFilters;
  global: Exercise[];
  personal: Exercise[];
  copyingExerciseId: string | null;
  loading: boolean;
  hasMore: boolean;
  onQuery: (query: string) => void;
  onFilters: (filters: ExerciseLibraryFilters) => void;
  onOpen: (exercise: Exercise) => void;
  onCopy: (exercise: Exercise) => void;
  onEdit: (exercise: Exercise) => void;
  onDelete: (exercise: Exercise) => void;
  onLoadMore: () => void;
}) {
  const source = scope === "global" ? global : personal;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(source.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleExercises = source.slice(
    currentPage * pageSize,
    currentPage * pageSize + pageSize,
  );
  const activeFilterCount =
    filters.disciplines.length +
    filters.categories.length +
    filters.modes.length +
    filters.tracking.length;
  function resetFilters() {
    setPage(0);
    onFilters(emptyExerciseLibraryFilters());
  }
  function toggleDiscipline(value: ExerciseDiscipline) {
    setPage(0);
    onFilters({
      ...filters,
      disciplines: toggleExerciseFilterValue(filters.disciplines, value),
    });
  }
  function toggleCategory(value: string) {
    setPage(0);
    onFilters({
      ...filters,
      categories: toggleExerciseFilterValue(filters.categories, value),
    });
  }
  function toggleMode(value: EntryMode) {
    setPage(0);
    onFilters({
      ...filters,
      modes: toggleExerciseFilterValue(filters.modes, value),
    });
  }
  function toggleTracking(value: TrackingField) {
    setPage(0);
    onFilters({
      ...filters,
      tracking: toggleExerciseFilterValue(filters.tracking, value),
    });
  }
  return (
    <>
      <div className="library-toolbar panel">
        <div className="library-filter-actions">
          <label className="search-field library-search">
            <Search size={17} />
            <input
              aria-label="Search exercises"
              value={query}
              onChange={(event) => {
                setPage(0);
                onQuery(event.target.value);
              }}
              placeholder="Search exercises"
            />
          </label>
          <button
            className={cn("button secondary small library-filter-trigger", filtersOpen && "active")}
            aria-expanded={filtersOpen}
            aria-controls="exercise-filter-panel"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <Settings2 size={15} />
            Filters{activeFilterCount ? ` · ${activeFilterCount}` : ""}
          </button>
        </div>
        {activeFilterCount > 0 && (
          <div className="library-active-filters" aria-label="Active filters">
            {filters.disciplines.map((style) => (
              <button key={style} onClick={() => toggleDiscipline(style)}>{exerciseTrainingStyleLabel(style)} <X size={12} /></button>
            ))}
            {filters.categories.map((category) => (
              <button className="filter-tag-category" key={category} onClick={() => toggleCategory(category)}>Category: {category} <X size={12} /></button>
            ))}
            {filters.modes.map((mode) => (
              <button className="filter-tag-logging" key={mode} onClick={() => toggleMode(mode)}>Logging: {modeLabel(mode)} <X size={12} /></button>
            ))}
            {filters.tracking.map((field) => (
              <button className="filter-tag-tracking" key={field} onClick={() => toggleTracking(field)}>Tracking: {trackingFieldLabel(field)} <X size={12} /></button>
            ))}
            <button className="clear" onClick={resetFilters}>Clear</button>
          </div>
        )}
        {filtersOpen && (
          <div className="library-filter-panel" id="exercise-filter-panel">
            <div>
              <span>Training style</span>
              <div className="library-filter-chip-row">
                {exerciseTrainingStyles.map(({ value, label }) => (
                  <button className={filters.disciplines.includes(value) ? "active" : ""} key={value} onClick={() => toggleDiscipline(value)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span>Category</span>
              <div className="library-filter-chip-row">
                {exerciseFilterCategories.map((category) => (
                  <button className={cn("filter-tag-category", filters.categories.includes(category) && "active")} key={category} onClick={() => toggleCategory(category)}>{category}</button>
                ))}
              </div>
            </div>
            <div>
              <span>Logging</span>
              <div className="library-filter-chip-row">
                {exerciseModeOptions.map((mode) => (
                  <button className={cn("filter-tag-logging", filters.modes.includes(mode) && "active")} key={mode} onClick={() => toggleMode(mode)}>{modeLabel(mode)}</button>
                ))}
              </div>
            </div>
            <div>
              <span>Tracking</span>
              <div className="library-filter-chip-row">
                {exerciseTrackingOptions.map((field) => (
                  <button className={cn("filter-tag-tracking", filters.tracking.includes(field) && "active")} key={field} onClick={() => toggleTracking(field)}>{trackingFieldLabel(field)}</button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      <div
        id="exercise-library-results"
        role="tabpanel"
        aria-busy={loading}
      >
      <div className="library-meta">
        <span>{source.length}{hasMore ? "+" : ""} exercises</span>
        {source.length > pageSize && (
          <span>
            {currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, source.length)}
          </span>
        )}
      </div>
      <div className="exercise-list panel">
        {visibleExercises.map((exercise) => (
          <article className="exercise-list-row" key={exercise.id}>
            {(() => {
              const style = inferredExerciseDiscipline(exercise);
              const StyleIcon = exerciseTrainingStyles.find(
                (item) => item.value === style,
              )?.icon ?? Dumbbell;
              return (
            <button
              className="exercise-list-main"
              onClick={() => onOpen(exercise)}
              aria-label={`Open ${exercise.name}`}
            >
              <span className="exercise-list-identity">
                <span
                  className={cn("exercise-style-icon", style)}
                  title={exerciseTrainingStyleLabel(style)}
                  aria-label={exerciseTrainingStyleLabel(style)}
                >
                  <StyleIcon size={15} />
                </span>
                <strong>{exercise.name}</strong>
              </span>
              <span className="exercise-list-parameters">
                {!(style === "weightlifting" && exercise.category === "Weightlifting") && (
                  <span className="exercise-parameter-tag category">{exercise.category}</span>
                )}
                <span className="exercise-parameter-tag logging">{modeLabel(exercise.defaultMode)}</span>
                {exercise.defaultFields.length ? exercise.defaultFields.map((field) => (
                  <span className="exercise-parameter-tag tracking" key={field}>{trackingFieldLabel(field)}</span>
                )) : <span className="exercise-parameter-tag tracking">No tracking</span>}
              </span>
            </button>
              );
            })()}
            <div className="exercise-list-actions">
              {exercise.scope === "global" ? (
                <button
                  className="icon-button"
                  disabled={copyingExerciseId === exercise.id}
                  aria-label={`Copy ${exercise.name} to My exercises`}
                  title="Copy to My exercises"
                  onClick={() => onCopy(exercise)}
                >
                  {copyingExerciseId === exercise.id ? (
                    <LoaderCircle className="button-spinner" size={15} />
                  ) : (
                    <Copy size={15} />
                  )}
                </button>
              ) : (
                <>
                  <button
                    className="icon-button"
                    aria-label={`Edit ${exercise.name}`}
                    title="Edit exercise"
                    onClick={() => onEdit(exercise)}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    className="icon-button danger"
                    aria-label={`Delete ${exercise.name}`}
                    title="Delete exercise"
                    onClick={() => onDelete(exercise)}
                  >
                    <Trash2 size={15} />
                  </button>
                </>
              )}
            </div>
          </article>
        ))}
      </div>
      {pageCount > 1 && (
        <nav className="library-pagination" aria-label="Exercise pages">
          <button
            className="button secondary small"
            disabled={currentPage === 0}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
          >
            <ArrowLeft size={14} /> Previous
          </button>
          <span>Page {currentPage + 1} of {pageCount}</span>
          <button
            className="button secondary small"
            disabled={currentPage >= pageCount - 1}
            onClick={() =>
              setPage((current) => Math.min(pageCount - 1, current + 1))
            }
          >
            Next <ArrowRight size={14} />
          </button>
        </nav>
      )}
      {hasMore && (
        <button
          className="button secondary small library-load-more"
          disabled={loading}
          onClick={onLoadMore}
        >
          {loading && <LoaderCircle className="button-spinner" size={14} />}
          {loading ? "Loading…" : "Load more exercises"}
        </button>
      )}
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
  viewerId,
  coachConnections,
  pendingInvites,
  outgoingInvites,
  athletes,
  hasMoreAthletes,
  loadingMoreAthletes,
  athletesLoadError,
  selectedAthlete,
  loadingAthleteId,
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
  onLoadMoreAthletes,
  onOpenAssignedProgram,
  onOpenAgendaEntry,
  onAssignAthlete,
}: {
  mode: "athlete" | "coach";
  viewerId: string;
  coachConnections: CoachConnection[];
  pendingInvites: PendingCoachInvite[];
  outgoingInvites: OutgoingCoachInvite[];
  athletes: AthleteSummary[];
  hasMoreAthletes: boolean;
  loadingMoreAthletes: boolean;
  athletesLoadError: string;
  selectedAthlete: AthleteSummary | null;
  loadingAthleteId: string | null;
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
  onLoadMoreAthletes: () => void;
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
          panelId="coaching-workspace-panel"
          value={mode}
          onChange={onMode}
          tabs={[
            { value: "athlete", label: "My coaches" },
            ...(hasAthleteWorkspace
              ? [{
                  value: "coach" as const,
                  label: refreshing ? <><LoaderCircle className="button-spinner" size={14} /> Refreshing…</> : "My athletes",
                  badge: pendingInvites.length,
                }]
              : []),
          ]}
        />
      </PageHeader>
      {mode === "athlete" || !hasAthleteWorkspace ? (
        <div
          className="coaching-athlete-layout"
          id="coaching-workspace-panel"
          role="tabpanel"
          aria-labelledby="coaching-workspace-panel-athlete-tab"
        >
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
                    View programs they authored for you and their linked results
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
                    Cannot view private notes, unrelated training, or edit history
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
        <div
          className="coach-dashboard"
          id="coaching-workspace-panel"
          role="tabpanel"
          aria-labelledby="coaching-workspace-panel-coach-tab"
        >
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
              <>
                {athletes.map((athlete) => (
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
                ))}
                {athletesLoadError && (
                  <InlineError>{athletesLoadError}</InlineError>
                )}
                {hasMoreAthletes && (
                  <button
                    className="button secondary small library-load-more"
                    disabled={loadingMoreAthletes}
                    onClick={onLoadMoreAthletes}
                  >
                    {loadingMoreAthletes && (
                      <LoaderCircle className="button-spinner" size={14} />
                    )}
                    {loadingMoreAthletes ? "Loading…" : "Load more athletes"}
                  </button>
                )}
              </>
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
          {selectedAthlete?.detailsLoaded === false ? (
            <section className="panel empty-state" aria-live="polite">
              {loadingAthleteId === selectedAthlete.id ? (
                <>
                  <LoaderCircle className="button-spinner" size={28} />
                  <h3>Loading athlete overview…</h3>
                  <p>Fetching your program progress and recent agenda.</p>
                </>
              ) : (
                <>
                  <Users size={28} />
                  <h3>Athlete overview unavailable</h3>
                  <p>Try this bounded read again.</p>
                  <button
                    className="button secondary"
                    onClick={() => onSelectAthlete(selectedAthlete)}
                  >
                    Retry
                  </button>
                </>
              )}
            </section>
          ) : selectedAthlete ? (
            <CoachAthleteOverview
              athlete={selectedAthlete}
              viewerId={viewerId}
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
  viewerId,
  openingProgramId,
  onAssign,
  onOpenProgram,
  onOpenAgenda,
}: {
  athlete: AthleteSummary;
  viewerId: string;
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
                      <SourceTag
                        presentation={presentProvenance({
                          origin: "coach",
                          viewerId,
                          athleteOwnerId: athlete.id,
                          athleteOwnerName: athlete.name,
                          authorId: viewerId,
                        })}
                        compact
                      />
                    </span>
                  </span>
                  <span
                    className="program-card-workout-progress"
                    aria-label={`${assignedProgram.title}: ${assignedProgram.completedWorkouts} of ${assignedProgram.totalWorkouts} workouts completed; ${assignedProgram.scheduledWorkouts} scheduled`}
                  >
                    <small>
                      <strong>{assignedProgram.completionPercent}% complete</strong>
                      {` · ${assignedProgram.completedWorkouts} of ${assignedProgram.totalWorkouts}`}
                    </small>
                    <small>
                      {assignedProgram.scheduledPercent}% scheduled
                      {assignedProgram.nextWorkout
                        ? ` · Next: ${assignedProgram.nextWorkout.title}`
                        : ""}
                    </small>
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

function ExerciseModal({
  exercise,
  onClose,
  onSave,
}: {
  exercise: Exercise | null;
  onClose: () => void;
  onSave: (
    name: string,
    discipline: ExerciseDiscipline,
    category: string,
    mode: EntryMode,
    cue: string,
  ) => void;
}) {
  const [name, setName] = useState(exercise?.name ?? "");
  const [discipline, setDiscipline] = useState<ExerciseDiscipline>(
    exercise ? inferredExerciseDiscipline(exercise) : "gym",
  );
  const [category, setCategory] = useState(exercise?.category ?? "General");
  const [mode, setMode] = useState<EntryMode>(exercise?.defaultMode ?? "sets");
  const [cue, setCue] = useState(exercise?.cue ?? "");
  const hasLegacyCategory = !exerciseCategories.some(
    (candidate) => candidate === category,
  );
  return (
    <ModalShell
      title={exercise ? "Edit exercise" : "Create an exercise"}
      description={
        exercise
          ? "Update the defaults used when you add this exercise to future workouts."
          : "Save it once, then reuse it in any program you build."
      }
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
          <span>Training style</span>
          <select
            aria-label="Training style"
            value={discipline}
            onChange={(event) =>
              setDiscipline(event.target.value as ExerciseDiscipline)
            }
          >
            {exerciseTrainingStyles.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>Category</span>
          <select
            aria-label="Category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            {hasLegacyCategory && <option value={category}>{category}</option>}
            {exerciseCategories.map((candidate) => (
              <option key={candidate} value={candidate}>
                {candidate}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field full">
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
          onClick={() =>
            onSave(name.trim(), discipline, category, mode, cue.trim())
          }
        >
          {exercise ? "Save changes" : "Save exercise"}
        </button>
      </div>
    </ModalShell>
  );
}

function ExerciseDetailsModal({
  exercise,
  copying,
  onClose,
  onCopy,
  onEdit,
}: {
  exercise: Exercise;
  copying: boolean;
  onClose: () => void;
  onCopy?: () => void;
  onEdit?: () => void;
}) {
  const tracking = exercise.defaultFields.length
    ? exercise.defaultFields.map(trackingFieldLabel).join(" · ")
    : "No tracking fields";
  const trainingStyle = exerciseTrainingStyleLabel(
    inferredExerciseDiscipline(exercise),
  );
  const hasSeparateCategory = !(
    trainingStyle === "Weightlifting" && exercise.category === "Weightlifting"
  );
  return (
    <ModalShell
      title={exercise.name}
      description={
        exercise.scope === "global"
          ? "A provided Lift Log exercise. Copy it to My exercises to make your own reusable version."
          : "Your reusable exercise. Its defaults will be used when you add it to a workout."
      }
      onClose={onClose}
      dismissible={!copying}
    >
      <div className="exercise-details">
        <dl>
          <div>
            <dt>Training style</dt>
            <dd>{trainingStyle}</dd>
          </div>
          {hasSeparateCategory && (
            <div>
              <dt>Category</dt>
              <dd>{exercise.category}</dd>
            </div>
          )}
          <div>
            <dt>Logging</dt>
            <dd>{modeLabel(exercise.defaultMode)}</dd>
          </div>
          <div>
            <dt>Tracking</dt>
            <dd>{tracking}</dd>
          </div>
        </dl>
        {exercise.cue ? (
          <div className="form-info full">
            <Info size={16} />
            <span>{exercise.cue}</span>
          </div>
        ) : null}
      </div>
      <div className="modal-actions">
        <button className="button secondary" disabled={copying} onClick={onClose}>
          Close
        </button>
        {onCopy && (
          <button className="button primary" disabled={copying} onClick={onCopy}>
            {copying ? (
              <>
                <LoaderCircle className="button-spinner" size={15} />
                Copying…
              </>
            ) : (
              <>
                <Copy size={15} />
                Copy to My exercises
              </>
            )}
          </button>
        )}
        {onEdit && (
          <button className="button primary" onClick={onEdit}>
            <Pencil size={15} />
            Edit exercise
          </button>
        )}
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

function WorkoutSettingsModal({
  workout,
  description,
  onClose,
  onSave,
}: {
  workout: PlannedWorkout;
  description?: string;
  onClose: () => void;
  onSave: (
    title: string,
    durationMinutes: number,
    description: string,
  ) => Promise<void>;
}) {
  const [title, setTitle] = useState(workout.title);
  const [duration, setDuration] = useState(String(workout.durationMinutes));
  const [nextDescription, setNextDescription] = useState(description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const durationMinutes = Number(duration);
  async function save() {
    setSaving(true);
    setError("");
    try {
      await onSave(title.trim(), durationMinutes, nextDescription.trim());
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
      description="Update the name, description and expected duration shown throughout the plan."
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
        {description !== undefined && (
          <label className="form-field full">
            <span>Description <em>optional</em></span>
            <textarea
              value={nextDescription}
              placeholder="What is this workout for?"
              onChange={(event) => setNextDescription(event.target.value)}
            />
          </label>
        )}
      </div>
      {error && <InlineError>{error}</InlineError>}
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
      {error && <InlineError>{error}</InlineError>}
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
      {error && <InlineError>{error}</InlineError>}
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
      {error && <InlineError>{error}</InlineError>}
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

function DeleteContentModal({
  target,
  onClose,
  onDelete,
}: {
  target: ContentDeleteTarget;
  onClose: () => void;
  onDelete: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const content = (() => {
    if (target.kind === "week") {
      return {
        title: `Delete ${target.label}?`,
        description: "Every workout in this week will be removed from the draft program.",
        label: "Delete week",
      };
    }
    if (target.kind === "workout") {
      return {
        title: `Delete ${target.title}?`,
        description: "This workout will be removed from its program week.",
        label: "Delete workout",
      };
    }
    if (target.kind === "workout-item") {
      return {
        title: `Remove ${target.title}?`,
        description: "It will be removed from this workout. The exercise remains available in Exercises.",
        label: "Remove exercise",
      };
    }
    const quickWorkout = target.program.contentType === "quick_workout";
    return {
      title: `Delete ${target.program.title}?`,
      description: `It will disappear from Mine, and its unstarted calendar ${quickWorkout ? "occurrences" : "workouts"} will be removed. Completed training history will stay.`,
      label: quickWorkout ? "Delete workout" : "Delete program",
    };
  })();

  async function remove() {
    setDeleting(true);
    setError("");
    try {
      await onDelete();
      onClose();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "The item could not be deleted.",
      );
      setDeleting(false);
    }
  }

  return (
    <ModalShell
      title={content.title}
      description={content.description}
      onClose={onClose}
      dismissible={!deleting}
    >
      {error && <InlineError>{error}</InlineError>}
      <div className="modal-actions">
        <button
          className="button secondary"
          data-modal-initial-focus
          disabled={deleting}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          className="button danger"
          disabled={deleting}
          onClick={() => void remove()}
        >
          {deleting ? (
            <>
              <LoaderCircle className="button-spinner" size={15} />
              Deleting…
            </>
          ) : (
            <>
              <Trash2 size={15} />
              {content.label}
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
  const [trackingFields, setTrackingFields] = useState<TrackingField[]>(() =>
    workoutLogFields(item),
  );
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
  const setPlanFields: PerEntryField[] = (["reps", "load", "rpe"] as const).filter(
    (field) => trackingFields.includes(field),
  );
  const intervalPlanFields: PerEntryField[] = trackingFields.includes("rpe")
    ? ["work", "rest", "rpe"]
    : ["work", "rest"];
  const tracks = (field: TrackingField) => trackingFields.includes(field);
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
    if (!checked) {
      setEntries((previous) => {
        const sharedValue = previous[0]?.[field] ?? "";
        return previous.map((entry) => ({ ...entry, [field]: sharedValue }));
      });
    }
  }
  function resetForMode(nextMode: EntryMode) {
    setMode(nextMode);
    setTrackingFields(trackingFieldsForMode(nextMode));
    setEntries(prescriptionDraftEntries(nextMode, item.prescription, weightUnit));
    setPerEntry({ reps: false, load: false, rpe: false, work: false, rest: false });
  }
  async function save() {
    setSaving(true);
    setError("");
    const nextFields = trackingFieldsForMode(mode, trackingFields);
    const savedEntries: PrescriptionEntry[] = entries.map((entry) => ({
      reps: nextFields.includes("reps")
        ? entry.reps.trim() || undefined
        : undefined,
      loadKg: nextFields.includes("load")
        ? numberOrUndefined(weightKgValue(entry.load, weightUnit))
        : undefined,
      durationMinutes:
        mode === "result" && nextFields.includes("duration")
          ? numberOrUndefined(entry.duration)
          : undefined,
      distance:
        mode === "result" && nextFields.includes("distance")
          ? numberOrUndefined(entry.distance)
          : undefined,
      distanceUnit:
        mode === "result" && nextFields.includes("distance") ? "km" : undefined,
      workSeconds:
        mode === "intervals" ? numberOrUndefined(entry.work) : undefined,
      restSeconds:
        mode === "intervals" ? numberOrUndefined(entry.rest) : undefined,
      targetRpe: nextFields.includes("rpe")
        ? wholeRpe(entry.rpe) || undefined
        : undefined,
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
                  distanceUnit: firstEntry.distanceUnit,
                  loadKg: firstEntry.loadKg,
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
      description="Set the target here. Actual results are logged during training."
      onClose={onClose}
      className="prescription-modal"
    >
      <div className="form-grid prescription-form">
        <label className="form-field full">
          <span>Format</span>
          <select
            value={mode}
            onChange={(event) => resetForMode(event.target.value as EntryMode)}
          >
            <option value="sets">Sets × reps</option>
            <option value="result">Time / distance</option>
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
            {tracks("reps") && (
              <div className="form-field">
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
                    aria-label="Repetitions"
                    value={entries[0]?.reps ?? ""}
                    onChange={(event) => updateShared("reps", event.target.value)}
                    placeholder="5 or 8–10"
                  />
                )}
              </div>
            )}
            {tracks("load") && (
              <div className="form-field">
                <FieldLabel
                  label={`Weight (${weightUnit})`}
                  optional
                  perEntryLabel={entryLabel}
                  checked={perEntry.load}
                  onToggle={(checked) => togglePerEntry("load", checked)}
                />
                {perEntry.load ? (
                  <PerEntryValue label={entryLabel} />
                ) : (
                  <input
                    aria-label={`Target weight in ${weightUnit}`}
                    inputMode="decimal"
                    value={entries[0]?.load ?? ""}
                    onChange={(event) => updateShared("load", event.target.value)}
                    placeholder="Optional"
                  />
                )}
              </div>
            )}
            {tracks("rpe") && (
              <div className="form-field planned-rpe-field">
                <FieldLabel
                  label="Target RPE"
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
            )}
            {setPlanFields.length > 0 && (
              <PrescriptionEntryTable
                label="Set plan"
                rows={entries}
                weightUnit={weightUnit}
                fields={setPlanFields}
                editable={perEntry}
                onChange={updateEntry}
              />
            )}
          </>
        )}
        {mode === "result" && (
          <>
            {tracks("duration") && (
              <label className="form-field">
                <span>Duration (min)</span>
                <input
                  type="number"
                  min="0"
                  value={entries[0]?.duration ?? ""}
                  onChange={(event) => updateEntry(0, "duration", event.target.value)}
                />
              </label>
            )}
            {tracks("distance") && (
              <label className="form-field">
                <span>Distance (km)</span>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={entries[0]?.distance ?? ""}
                  onChange={(event) => updateEntry(0, "distance", event.target.value)}
                />
              </label>
            )}
            {tracks("load") && (
              <label className="form-field">
                <span>Weight ({weightUnit})</span>
                <input
                  inputMode="decimal"
                  value={entries[0]?.load ?? ""}
                  onChange={(event) => updateEntry(0, "load", event.target.value)}
                  placeholder="Optional"
                />
              </label>
            )}
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
            <div className="form-field">
              <FieldLabel
                label="Work (sec)"
                perEntryLabel={entryLabel}
                checked={perEntry.work}
                onToggle={(checked) => togglePerEntry("work", checked)}
              />
              {perEntry.work ? (
                <PerEntryValue label={entryLabel} />
              ) : (
                <input
                  aria-label="Work seconds"
                  inputMode="numeric"
                  value={entries[0]?.work ?? ""}
                  onChange={(event) => updateShared("work", event.target.value)}
                />
              )}
            </div>
            <div className="form-field">
              <FieldLabel
                label="Rest (sec)"
                perEntryLabel={entryLabel}
                checked={perEntry.rest}
                onToggle={(checked) => togglePerEntry("rest", checked)}
              />
              {perEntry.rest ? (
                <PerEntryValue label={entryLabel} />
              ) : (
                <input
                  aria-label="Rest seconds"
                  inputMode="numeric"
                  value={entries[0]?.rest ?? ""}
                  onChange={(event) => updateShared("rest", event.target.value)}
                />
              )}
            </div>
            {tracks("rpe") && (
              <div className="form-field planned-rpe-field">
                <FieldLabel
                  label="Target RPE"
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
            )}
            <PrescriptionEntryTable
              label="Round plan"
              rows={entries}
              weightUnit={weightUnit}
              fields={intervalPlanFields}
              editable={perEntry}
              onChange={updateEntry}
            />
          </>
        )}
        {mode === "result" && tracks("rpe") && (
          <div className="form-field planned-rpe-field result-rpe-field">
            <span>Target RPE <em>optional</em></span>
            <PlannedRpeSelect
              value={entries[0]?.rpe ?? ""}
              onChange={(value) => updateEntry(0, "rpe", value)}
            />
          </div>
        )}
        <label className="form-field full">
          <span>
            Coaching notes <em>optional</em>
          </span>
          <textarea
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Technique cues, tempo, substitutions…"
          />
        </label>
      </div>
      {error && <InlineError>{error}</InlineError>}
      <div className="modal-actions prescription-actions">
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
          {saving ? "Saving…" : "Save"}
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
      <b>{label}</b>
      {optional && <em>optional</em>}
      <label className="per-entry-toggle">
        <input
          type="checkbox"
          checked={checked}
          aria-label={`${perEntryLabel} values for ${label}`}
          onChange={(event) => onToggle(event.target.checked)}
        />
        <i aria-hidden />
        <small>{perEntryLabel}</small>
      </label>
    </span>
  );
}

function PerEntryValue({ label }: { label: string }) {
  return (
    <div className="per-entry-value" aria-label={`${label} values are edited below`}>
      <Settings2 size={13} />
      Edit below
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
    <div
      className={cn(
        "prescription-entry-table",
        "full",
        `tracking-${fields.length}`,
      )}
    >
      <div className="prescription-entry-heading">
        <strong>{label}</strong>
      </div>
      <div className="prescription-entry-grid">
        <div className="prescription-entry-row prescription-entry-header">
          <span>#</span>
          {fields.map((field) => (
            <span key={field}>
              {field === "load"
                ? `Load ${weightUnit}`
                : field === "rpe"
                  ? "RPE"
                  : field === "work"
                    ? "Work s"
                    : field === "rest"
                      ? "Rest s"
                      : field[0].toUpperCase() + field.slice(1)}
            </span>
          ))}
        </div>
        {rows.map((row, index) => (
          <div className="prescription-entry-row" key={index}>
            <span>{index + 1}</span>
            {fields.map((field) =>
              field === "rpe" ? (
                <PlannedRpeSelect
                  ariaLabel={`${label}, ${index + 1}, planned RPE`}
                  key={field}
                  disabled={!editable.rpe}
                  value={row.rpe}
                  onChange={(value) => onChange(index, "rpe", value)}
                />
              ) : (
                <input
                  aria-label={`${label}, ${index + 1}, ${field === "load" ? `weight in ${weightUnit}` : field}`}
                  key={field}
                  disabled={!editable[field]}
                  inputMode={field === "load" ? "decimal" : field === "reps" ? "text" : "numeric"}
                  placeholder="—"
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
      {error && <InlineError>{error}</InlineError>}
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
              View only programs they author for you and linked results
            </span>
            <span>
              <Check size={14} />
              Create and publish future program content
            </span>
            <span>
              <LockKeyhole size={14} />
              Cannot view private notes, unrelated training, or edit completed logs
            </span>
          </div>
      {error && <InlineError>{error}</InlineError>}
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
      {error && <InlineError>{error}</InlineError>}
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
  hasMoreAthletes,
  loadingMoreAthletes,
  athletesLoadError,
  initialProgramId,
  initialAthleteIds = [],
  onClose,
  onAssign,
  onAssignQuickWorkout,
  onLoadMoreAthletes,
}: {
  programs: Program[];
  athletes: AthleteSummary[];
  hasMoreAthletes: boolean;
  loadingMoreAthletes: boolean;
  athletesLoadError: string;
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
  onLoadMoreAthletes: () => void;
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
                  {athletesLoadError && (
                    <InlineError>{athletesLoadError}</InlineError>
                  )}
                  {hasMoreAthletes && (
                    <button
                      type="button"
                      className="button secondary small library-load-more"
                      disabled={saving || loadingMoreAthletes}
                      onClick={onLoadMoreAthletes}
                    >
                      {loadingMoreAthletes && (
                        <LoaderCircle className="button-spinner" size={14} />
                      )}
                      {loadingMoreAthletes ? "Loading…" : "Load more athletes"}
                    </button>
                  )}
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
                  : "Assigning shared program to"}{" "}
                {athleteIds.size} {athleteIds.size === 1 ? "athlete" : "athletes"}…
              </span>
            </div>
          )}
      {error && <InlineError>{error}</InlineError>}
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
      {error && <InlineError>{error}</InlineError>}
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
  candidates,
  schedules,
  editingId,
  initialDate,
  loading,
  error: loadError,
  hasMore,
  onLoadMore,
  onRetry,
  onClose,
  onSave,
}: {
  candidates: SchedulableWorkoutCandidate[];
  schedules: ScheduledWorkout[];
  editingId: string | null;
  initialDate: string | null;
  loading: boolean;
  error: string;
  hasMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  onClose: () => void;
  onSave: (candidate: ScheduleCandidate, date: string | null) => Promise<void>;
}) {
  const availableCandidates = useMemo<ScheduleCandidate[]>(() => {
    if (editingId) {
      const schedule = schedules.find((candidate) => candidate.id === editingId);
      if (!schedule) return [];
      const source = candidates.find(
        (candidate) =>
          candidate.programVersionId === schedule.programVersionId &&
          candidate.workoutId === schedule.workoutId &&
          candidate.assignmentId === schedule.assignmentId,
      );
      return [{
        id: schedule.id,
        scheduleId: schedule.id,
        programId: schedule.programId,
        assignmentId: schedule.assignmentId,
        programVersionId: schedule.programVersionId,
        programTitle: schedule.programTitle,
        workoutId: schedule.workoutId,
        workoutTitle: schedule.workoutTitle,
        scheduleLabel: schedule.slotLabel,
        estimatedMinutes: schedule.workout.durationMinutes,
        quickWorkout: source?.isQuickWorkout ?? false,
        plannedDate: schedule.plannedDate,
      }];
    }

    return candidates.flatMap((candidate): ScheduleCandidate[] => {
      const latest = candidate.latestOccurrence;
      if (
        !candidate.isQuickWorkout &&
        latest &&
        (latest.status === "in_progress" ||
          latest.status === "completed" ||
          (latest.status === "planned" && Boolean(latest.plannedDate)))
      ) {
        return [];
      }
      const reusableOccurrence =
        latest?.status === "planned" && !latest.plannedDate
          ? latest
          : undefined;
      return [{
        id: `${candidate.assignmentId ?? candidate.programId}:${candidate.workoutId}`,
        scheduleId: reusableOccurrence?.id,
        programId: candidate.programId,
        assignmentId: candidate.assignmentId,
        programVersionId: candidate.programVersionId,
        programTitle: candidate.programTitle,
        workoutId: candidate.workoutId,
        workoutTitle: candidate.workoutTitle,
        scheduleLabel: candidate.scheduleLabel,
        estimatedMinutes: candidate.estimatedMinutes,
        quickWorkout: candidate.isQuickWorkout,
        plannedDate: reusableOccurrence?.plannedDate,
      }];
    });
  }, [candidates, editingId, schedules]);

  const initial =
    availableCandidates.find((candidate) => candidate.scheduleId === editingId) ??
    availableCandidates[0];
  const [candidateId, setCandidateId] = useState(initial?.id ?? "");
  const [date, setDate] = useState(
    initial?.plannedDate ?? initialDate ?? localDateOnly(),
  );
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [savingAction, setSavingAction] = useState<
    "add" | "reschedule" | "unschedule" | null
  >(null);
  const [error, setError] = useState("");
  const effectiveCandidateId = availableCandidates.some(
    (candidate) => candidate.id === candidateId,
  )
    ? candidateId
    : (availableCandidates[0]?.id ?? "");
  const selected = availableCandidates.find(
    (candidate) => candidate.id === effectiveCandidateId,
  );
  const originalDate = selected?.plannedDate ?? "";
  const action = originalDate
    ? !date || date === originalDate
      ? "unschedule"
      : "reschedule"
    : "add";

  async function save(
    nextDate: string | null,
    nextAction: "add" | "reschedule" | "unschedule",
  ) {
    if (!selected || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSavingAction(nextAction);
    setError("");
    try {
      await onSave(selected, nextDate);
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
      description="Choose a workout and date. Nothing is created until you add it to Calendar."
      onClose={onClose}
      dismissible={!saving}
    >
      {loadError && !editingId && (
        <InlineError>
          <span>{loadError}</span>{" "}
          <button
            type="button"
            className="text-button"
            disabled={loading}
            onClick={onRetry}
          >
            Try again
          </button>
        </InlineError>
      )}
      {loading && !availableCandidates.length ? (
        <div className="feature-load-status modal-empty" role="status">
          <LoaderCircle size={22} className="button-spinner" />
          <span>Loading workouts…</span>
        </div>
      ) : availableCandidates.length ? (
        <>
          <div className="form-grid">
            <label className="form-field full">
              <span>Workout</span>
              <select
                value={effectiveCandidateId}
                disabled={Boolean(editingId) || saving}
                onChange={(event) => {
                  const next = availableCandidates.find(
                    (candidate) => candidate.id === event.target.value,
                  );
                  setCandidateId(event.target.value);
                  setDate((currentDate) => next?.plannedDate ?? currentDate);
                }}
              >
                {availableCandidates.map((candidate) => (
                  <option value={candidate.id} key={candidate.id}>
                    {candidate.quickWorkout
                      ? candidate.workoutTitle
                      : `${candidate.programTitle} · ${candidate.workoutTitle}`}
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
            <span>Only your account can add or move this date.</span>
          </div>
          {!editingId && hasMore && (
            <button
              type="button"
              className="button secondary schedule-load-more"
              disabled={loading || saving}
              onClick={onLoadMore}
            >
              {loading && <LoaderCircle size={15} className="button-spinner" />}
              {loading ? "Loading…" : "Show more workouts"}
            </button>
          )}
          {error && <InlineError>{error}</InlineError>}
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
            Save a workout or program first. Workouts already on your calendar
            remain available from Calendar.
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
      {error && <InlineError>{error}</InlineError>}
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
