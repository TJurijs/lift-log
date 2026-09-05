import {
  Activity,
  ArrowLeft,
  ArrowRight,
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
} from "react";
import type {
  ActiveSession,
  AthleteSummary,
  CalendarCursor,
  CalendarWorkspaceData,
  CoachAgendaEntry,
  CoachAthleteCursor,
  CoachConnection,
  CoachingWorkspaceData,
  CoachInviteReceipt,
  CoachInviteTarget,
  CompletedSession,
  CompletedSessionDetail,
  EntryMode,
  Exercise,
  ExerciseDiscipline,
  FrequentSchedulableWorkoutCandidate,
  LoggingFormat,
  OwnProfile,
  OutgoingCoachInvite,
  PendingCoachInvite,
  PlannedWorkout,
  PrescriptionEntry,
  Program,
  ProgramAssignment,
  ProgramCursor,
  ProgramRunDetail,
  ProgramRunSummary,
  ProgramRunWorkoutDate,
  ScheduledWorkout,
  SchedulableWorkoutCandidate,
  SchedulableWorkoutCursor,
  SessionSetValue,
  TrackingField,
  ViewName,
  WorkoutItem,
  WorkspaceData,
} from "../lib/domain";
import {
  entryModeForLoggingFormat,
  loggingFormatFor,
  loggingFormatLabel,
  optionalTrackingFieldsForLoggingFormat,
  requiredTrackingFieldsForLoggingFormat,
  trackingFieldsForLoggingFormat,
  trackingFieldsForMode,
} from "../lib/domain";
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
} from "../lib/presentation";
import {
  presentProgramProvenance,
} from "../lib/provenance";
import {
  formatWeight,
  weightInputValue,
  weightKgValue,
} from "../lib/units";
import {
  programWorkoutCount,
  programWorkouts,
  reorderProgramWorkoutItems,
  reorderProgramWorkoutSequence,
} from "../lib/program-tree";
import { nextIncompleteRunWorkoutId } from "../lib/program-progress";
import {
  listUpcomingWorkouts,
  selectNextWorkoutFocus,
} from "../lib/workout-focus";
import {
  appDetailDataFromHistory,
  appDetailFromHistory,
  leaveAppDetailHistory,
  parseAppView,
  pushAppDetailHistory,
  type AppDetailData,
  updateAppViewUrl,
} from "../lib/app-route";
import {
  AsyncButton,
  DetailNavigation,
  InlineError,
  ModalShell,
  PageHeader,
  PersonAvatar,
  SegmentedTabs,
  SessionSaveIndicator,
  SourceTag,
  StatusBadge,
  Toast,
} from "./ui-primitives";
import {
  ExerciseCategoryMark,
} from "./exercise-category-icons";
import { ExerciseVideoLink } from "./exercise-video-link";
import { useActiveWorkoutPersistence } from "./features/active-workout/useActiveWorkoutPersistence";
import type { CoachWorkspaceProgram } from "./features/coaching/CoachWorkspace";
import type { ProgramRunWizardSubmission } from "./features/program-runs/ProgramRunWizard";
import { useCompletedHistory } from "./features/next-workouts/useCompletedHistory";
import "./features/feature-styles.css";

import { emptyExerciseLibraryFilters, exerciseCategories, exerciseTrainingStyles, exerciseTrainingStyleLabel, filterCompleteExerciseLibrary, inferredExerciseDiscipline, trackingFieldLabel, type ExerciseLibraryFilters } from "./features/exercises/exercise-library";
import { useExerciseSearch } from "./features/exercises/useExerciseSearch";

const ExercisesHome = lazy(() => import("./features/exercises/ExercisesHome"));
const CalendarView = lazy(() => import("./features/calendar/CalendarView"));
const NextWorkoutsView = lazy(() => import("./features/next-workouts/NextWorkoutsView"));
const loadProgramView = () => import("./features/programs/ProgramView");
const ProgramView = lazy(loadProgramView);
const CoachWorkspace = lazy(() =>
  import("./features/coaching/CoachWorkspace").then(
    ({ CoachWorkspace: component }) => ({ default: component }),
  ),
);
const ProgramRunWizard = lazy(() =>
  import("./features/program-runs/ProgramRunWizard"),
);
const ProgramRunScheduleWizard = lazy(() =>
  import("./features/program-runs/ProgramRunScheduleWizard"),
);
const CoachProgramRuns = lazy(() =>
  import("./features/program-runs/SelfProgramRuns").then(
    ({ CoachProgramRuns: component }) => ({ default: component }),
  ),
);

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
  | "delete-exercise"
  | "delete-content"
  | "invite"
  | "assign-program"
  | "run-schedule"
  | "program"
  | "quick-workout"
  | "deactivate-program"
  | "schedule"
  | "account"
  | null;
type ContentDeleteTarget =
  | { kind: "workout"; id: string; title: string }
  | { kind: "workout-item"; id: string; title: string }
  | { kind: "assignment"; id: string; title: string }
  | {
      kind: "program-run";
      id: string;
      title: string;
      contentType?: ProgramRunSummary["contentType"];
    }
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
  kind: "delete" | "save" | "duplicate" | "edit" | "open";
} | null;
type CompletedWorkoutViewState = {
  session: CompletedSession;
  detail: CompletedSessionDetail | null;
  loading: boolean;
  error: string;
  returnView: "today" | "calendar" | "coaching" | "program";
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
  usageCount?: number;
  lastUsedAt?: string;
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

function modeLabel(mode: EntryMode, fields: readonly TrackingField[] = []) {
  return loggingFormatLabel(loggingFormatFor(mode, fields));
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
  initialWorkspace,
  repository,
}: {
  viewer: AppViewer;
  onSignOut: () => void;
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
  const [viewingProgramRunId, setViewingProgramRunId] = useState<string | null>(
    null,
  );
  const [viewingProgramRunDetail, setViewingProgramRunDetail] =
    useState<ProgramRunDetail | null>(null);
  const [programReturnView, setProgramReturnView] =
    useState<ViewName>("program");
  const [selectedWeek, setSelectedWeek] = useState(1);
  const [selectedWorkoutId, setSelectedWorkoutId] = useState("");
  const [selectedSectionId, setSelectedSectionId] = useState("");
  const [prescriptionItem, setPrescriptionItem] = useState<WorkoutItem | null>(
    null,
  );
  const [newPrescriptionItemId, setNewPrescriptionItemId] = useState<
    string | null
  >(null);
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
  const completedWorkoutRequestRef = useRef(0);
  const completedWorkoutRestoreKeyRef = useRef<string | null>(null);
  const programHistoryRequestRef = useRef(0);
  const programHistoryRestoreKeyRef = useRef<string | null>(null);
  const programHistoryRestoreRef = useRef<
    (history: Extract<AppDetailData, { kind: "program" }>) => void
  >(() => undefined);
  const notify = useCallback((message: string) => {
    if (toastTimerRef.current !== null)
      window.clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = window.setTimeout(() => {
      toastTimerRef.current = null;
      setToast("");
    }, 2600);
  }, []);
  const restoreCompletedWorkoutFromHistory = useCallback(
    (history: Extract<AppDetailData, { kind: "workout-log" }>) => {
      const restoreKey = `${history.session.id}:${history.athleteId ?? "self"}`;
      if (completedWorkoutRestoreKeyRef.current === restoreKey) return;
      completedWorkoutRestoreKeyRef.current = restoreKey;
      const requestId = completedWorkoutRequestRef.current + 1;
      completedWorkoutRequestRef.current = requestId;
      const pending: CompletedWorkoutViewState = {
        session: history.session,
        detail: repository ? null : { ...history.session, items: [] },
        loading: Boolean(repository),
        error: "",
        returnView: history.returnView,
      };
      setDetail({ kind: "completed-workout", ...pending });
      setActiveWorkoutVisible(false);
      if (!repository) return;
      void repository
        .loadCompletedSessionDetail(history.session.id, history.athleteId)
        .then((completedDetail) => {
          if (
            completedWorkoutRequestRef.current !== requestId ||
            appDetailFromHistory() !== "workout-log"
          ) {
            return;
          }
          setDetail({
            kind: "completed-workout",
            session: completedDetail ?? history.session,
            detail: completedDetail,
            loading: false,
            error: completedDetail
              ? ""
              : "These workout results are no longer available.",
            returnView: history.returnView,
          });
        })
        .catch((error: unknown) => {
          if (
            completedWorkoutRequestRef.current !== requestId ||
            appDetailFromHistory() !== "workout-log"
          ) {
            return;
          }
          completedWorkoutRestoreKeyRef.current = null;
          setDetail({
            kind: "completed-workout",
            session: history.session,
            detail: null,
            loading: false,
            error:
              error instanceof Error
                ? error.message
                : "The workout results could not be loaded.",
            returnView: history.returnView,
          });
        });
    },
    [repository],
  );
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
      const nextView = parseAppView(window.location.hash);
      const nextDetail = appDetailFromHistory();
      setActiveView(nextView);
      if (!nextDetail) {
        completedWorkoutRequestRef.current += 1;
        completedWorkoutRestoreKeyRef.current = null;
        programHistoryRequestRef.current += 1;
        programHistoryRestoreKeyRef.current = null;
        setDetail(null);
        setActiveWorkoutVisible(false);
        if (nextView === "program") {
          setProgram(null);
          setViewingProgramRunId(null);
          setViewingProgramRunDetail(null);
        }
      } else if (nextDetail === "program") {
        completedWorkoutRequestRef.current += 1;
        completedWorkoutRestoreKeyRef.current = null;
        setDetail(null);
        setActiveWorkoutVisible(false);
        const history = appDetailDataFromHistory();
        if (history?.kind === "program") {
          programHistoryRestoreRef.current(history);
        }
      } else if (nextDetail === "workout" && activeSession) {
        setActiveWorkoutVisible(true);
      } else if (nextDetail === "workout-log") {
        const history = appDetailDataFromHistory();
        if (history?.kind === "workout-log") {
          restoreCompletedWorkoutFromHistory(history);
        } else {
          setDetail(null);
          setActiveWorkoutVisible(false);
        }
      }
      scrollToAppTop();
    };
    window.addEventListener("popstate", restoreViewFromHistory);
    window.addEventListener("hashchange", restoreViewFromHistory);
    if (
      appDetailFromHistory() === "workout-log" ||
      appDetailFromHistory() === "program"
    ) {
      restoreViewFromHistory();
    }
    return () => {
      window.removeEventListener("popstate", restoreViewFromHistory);
      window.removeEventListener("hashchange", restoreViewFromHistory);
    };
  }, [activeSession, activeView, restoreCompletedWorkoutFromHistory]);
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
          const [page, programRunPage, coachProgramRunPage] = await Promise.all([
            repository.listProgramSummaries({ limit: 25 }),
            repository.listProgramRuns(),
            repository.listProgramRuns(undefined, { creatorScope: "coach" }),
          ]);
          setProgramCursor(page.nextCursor);
          setWorkspace((previous) => ({
            ...mergeProgramCatalog(previous, page.items, true),
            programRuns: programRunPage.items,
            programRunCursor: programRunPage.nextCursor,
            hasMoreProgramRuns: programRunPage.hasMore,
            coachProgramRuns: coachProgramRunPage.items,
            coachProgramRunCursor: coachProgramRunPage.nextCursor,
            hasMoreCoachProgramRuns: coachProgramRunPage.hasMore,
          }));
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
          : activeView === "program" || activeView === "today"
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
  const [coachingHistoryLoadingId, setCoachingHistoryLoadingId] = useState<
    string | null
  >(null);
  const [coachingProgramRunsLoadingId, setCoachingProgramRunsLoadingId] =
    useState<string | null>(null);
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
    mode: "self" | "coach";
    programId?: string;
    athleteIds?: string[];
    repeatRun?: ProgramRunSummary;
  }>({ mode: "coach" });
  const [assignmentProgramOverride, setAssignmentProgramOverride] =
    useState<Program | null>(null);
  const [programRunScheduleTarget, setProgramRunScheduleTarget] =
    useState<ProgramRunSummary | null>(null);
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
  const [frequentScheduleCandidates, setFrequentScheduleCandidates] = useState<
    FrequentSchedulableWorkoutCandidate[]
  >([]);
  const [scheduleCandidateCursor, setScheduleCandidateCursor] =
    useState<SchedulableWorkoutCursor>();
  const [scheduleCandidatesLoading, setScheduleCandidatesLoading] =
    useState(false);
  const [scheduleCandidatesError, setScheduleCandidatesError] = useState("");
  const [programCursor, setProgramCursor] = useState<ProgramCursor>();
  const [programsLoadingMore, setProgramsLoadingMore] = useState(false);
  const [programsLoadError, setProgramsLoadError] = useState("");
  const [coachProgramRunsLoadingMore, setCoachProgramRunsLoadingMore] =
    useState(false);
  const [coachProgramRunsLoadError, setCoachProgramRunsLoadError] =
    useState("");
  const [upcomingCursor, setUpcomingCursor] = useState<CalendarCursor>();
  const [upcomingLoading, setUpcomingLoading] = useState(false);
  const [upcomingLoadError, setUpcomingLoadError] = useState("");
  const {
    sessions: completedHistory,
    loading: completedHistoryLoading,
    error: completedHistoryError,
    cursor: completedHistoryCursor,
    load: loadCompletedHistory,
    invalidate: invalidateCompletedHistory,
  } = useCompletedHistory(repository, initialWorkspace.completedSessions);
  const upcomingLoadingRef = useRef(false);
  const upcomingInitializedRef = useRef(false);
  const upcomingCursorRef = useRef<CalendarCursor | undefined>(undefined);
  const upcomingFailedResetRef = useRef(false);
  const upcomingPendingResetRef = useRef(false);
  const upcomingLoaderRef = useRef<
    ((reset?: boolean) => Promise<void>) | undefined
  >(undefined);
  const calendarRangeRequestRef = useRef(0);
  const lastCalendarRangeRef = useRef<{
    start: string;
    end: string;
  } | null>(null);
  const [calendarRangeLoading, setCalendarRangeLoading] = useState(false);
  const [calendarRangeError, setCalendarRangeError] = useState("");
  const [programOwnerId, setProgramOwnerId] = useState(viewer.id);
  const [requestedProgramSource, setProgramSource] =
    useState<ProgramSourceTab>("own");
  const [programAction, setProgramAction] = useState<ProgramAction>(null);
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

  const loadMoreCoachAssignedRuns = useCallback(async () => {
    const cursor = workspace.coachProgramRunCursor;
    if (!repository || !cursor || coachProgramRunsLoadingMore) return;
    setCoachProgramRunsLoadingMore(true);
    setCoachProgramRunsLoadError("");
    try {
      const page = await repository.listProgramRuns(undefined, {
        limit: 25,
        cursor,
        creatorScope: "coach",
      });
      setWorkspace((previous) => {
        const runsById = new Map(
          (previous.coachProgramRuns ?? []).map((run) => [run.id, run]),
        );
        for (const run of page.items) runsById.set(run.id, run);
        return {
          ...previous,
          coachProgramRuns: [...runsById.values()],
          coachProgramRunCursor: page.nextCursor,
          hasMoreCoachProgramRuns: page.hasMore,
        };
      });
    } catch (error) {
      setCoachProgramRunsLoadError(
        error instanceof Error
          ? error.message
          : "More coach-assigned training could not be loaded.",
      );
    } finally {
      setCoachProgramRunsLoadingMore(false);
    }
  }, [
    coachProgramRunsLoadingMore,
    repository,
    workspace.coachProgramRunCursor,
  ]);

  const loadUpcomingWorkouts = useCallback(
    async (reset = false) => {
      if (!repository) return;
      if (upcomingLoadingRef.current) {
        if (reset) upcomingPendingResetRef.current = true;
        return;
      }
      if (
        !reset &&
        upcomingInitializedRef.current &&
        !upcomingCursorRef.current
      ) return;
      upcomingLoadingRef.current = true;
      setUpcomingLoading(true);
      setUpcomingLoadError("");
      try {
        const page = await repository.listUpcomingScheduledWorkouts({
          limit: 20,
          ...(reset || !upcomingCursorRef.current
            ? {}
            : { cursor: upcomingCursorRef.current }),
        });
        const today = localDateOnly();
        setWorkspace((previous) => {
          const retained = reset
            ? previous.scheduledWorkouts.filter(
                (schedule) =>
                  !schedule.plannedDate ||
                  schedule.plannedDate < today ||
                  (schedule.status !== "planned" &&
                    schedule.status !== "in_progress" &&
                    schedule.status !== "skipped"),
              )
            : previous.scheduledWorkouts;
          const merged = new Map(
            retained.map((schedule) => [schedule.id, schedule] as const),
          );
          for (const schedule of page.items) merged.set(schedule.id, schedule);
          return { ...previous, scheduledWorkouts: [...merged.values()] };
        });
        upcomingCursorRef.current = page.nextCursor;
        setUpcomingCursor(page.nextCursor);
        upcomingInitializedRef.current = true;
        upcomingFailedResetRef.current = false;
      } catch (error) {
        upcomingFailedResetRef.current = reset;
        setUpcomingLoadError(
          error instanceof Error
            ? error.message
            : "More upcoming workouts could not be loaded.",
        );
      } finally {
        upcomingLoadingRef.current = false;
        setUpcomingLoading(false);
      }

      if (upcomingPendingResetRef.current) {
        upcomingPendingResetRef.current = false;
        void upcomingLoaderRef.current?.(true);
      }
    },
    [repository],
  );
  upcomingLoaderRef.current = loadUpcomingWorkouts;

  useEffect(() => {
    if (
      repository &&
      activeView === "today" &&
      !upcomingInitializedRef.current
    ) {
      void loadUpcomingWorkouts(true);
    }
  }, [activeView, loadUpcomingWorkouts, repository]);

  const loadProgramForRunWizard = useCallback(
    async (targetProgram: Program) => {
      if (
        targetProgram.detailsLoaded !== false &&
        programWorkouts(targetProgram).length > 0
      ) {
        return targetProgram;
      }
      if (!repository) return targetProgram;
      return repository.loadProgramDetail(
        targetProgram.athleteId,
        targetProgram.id,
        targetProgram.versionId,
        targetProgram.assignmentId,
      );
    },
    [repository],
  );

  const loadProgramRunDetail = useCallback(
    async (runId: string): Promise<ProgramRunDetail | null> => {
      if (repository) return repository.loadProgramRunDetail(runId);
      const run = (workspace.programRuns ?? []).find(
        (candidate) => candidate.id === runId,
      );
      const source = run
        ? workspace.programCatalog.find(
            (candidate) => candidate.id === run.programId,
          )
        : undefined;
      if (!run || !source) return null;
      return {
        ...run,
        workouts: programWorkouts(source).map((workout, position) => ({
          id: `${run.id}:${workout.id}`,
          runId: run.id,
          workoutId: workout.id,
          title: workout.title,
          position,
          estimatedMinutes: workout.durationMinutes,
          status: "unscheduled" as const,
          prescriptionOverrides: {},
        })),
      };
    },
    [repository, workspace.programCatalog, workspace.programRuns],
  );

  const refreshProgramRunSummaries = useCallback(async () => {
    if (!repository) return;
    const [page, coachPage] = await Promise.all([
      repository.listProgramRuns(),
      repository.listProgramRuns(undefined, { creatorScope: "coach" }),
    ]);
    setCoachProgramRunsLoadError("");
    setWorkspace((previous) => ({
      ...previous,
      programRuns: page.items,
      programRunCursor: page.nextCursor,
      hasMoreProgramRuns: page.hasMore,
      coachProgramRuns: coachPage.items,
      coachProgramRunCursor: coachPage.nextCursor,
      hasMoreCoachProgramRuns: coachPage.hasMore,
    }));
  }, [repository]);

  const loadProgramForCurrentRunWizard = useCallback(
    async (targetProgram: Program) => {
      if (
        assignmentProgramOverride &&
        assignmentProgramOverride.id === targetProgram.id
      ) {
        return assignmentProgramOverride;
      }
      if (assignmentSeed.repeatRun && repository) {
        return repository.loadProgramForRun(assignmentSeed.repeatRun.id);
      }
      return loadProgramForRunWizard(targetProgram);
    },
    [
      assignmentProgramOverride,
      assignmentSeed.repeatRun,
      loadProgramForRunWizard,
      repository,
    ],
  );

  const applyExerciseSearchPage = useCallback((items: Exercise[], scope: "global" | "personal", append: boolean) => {
    setWorkspace((previous) => {
      const key = scope === "global" ? "globalExercises" : "personalExercises";
      const existingIds = new Set(previous[key].map((exercise) => exercise.id));
      return {
        ...previous,
        [key]: append
          ? [...previous[key], ...items.filter((exercise) => !existingIds.has(exercise.id))]
          : items,
      };
    });
  }, []);
  const {
    cursor: exerciseCursor,
    loading: exerciseSearchLoading,
    error: exerciseSearchError,
    loadMore: loadMoreExercises,
    retry: retryExerciseSearch,
  } = useExerciseSearch({
    repository,
    enabled: activeView === "exercises",
    query: exerciseQuery,
    scope: exerciseScope,
    filters: exerciseFilters,
    onPage: applyExerciseSearchPage,
  });

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
  const coachProgramRuns =
    workspace.coachProgramRuns ??
    (workspace.programRuns ?? []).filter(
      (run) => run.athleteId === viewer.id && run.createdById !== viewer.id,
    );
  const hasCoachTraining = hasCoach || coachProgramRuns.length > 0;
  const programSource =
    requestedProgramSource === "coach" && !hasCoachTraining
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
  const viewingProgramRun =
    viewingProgramRunDetail ??
    (viewingProgramRunId
      ? [
          ...(workspace.programRuns ?? []),
          ...(selectedAthlete?.programRuns ?? []),
        ].find((candidate) => candidate.id === viewingProgramRunId)
      : undefined);
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
  function capabilitiesForViewedProgram(
    targetProgram: Program,
  ): TrainingContentCapabilities {
    const capabilities = capabilitiesForProgram(targetProgram);
    const canCopyExactRun = Boolean(
      viewingProgramRunId &&
        viewingProgramRun?.id === viewingProgramRunId &&
        (viewingProgramRun.athleteId === viewer.id ||
          viewingProgramRun.createdById === viewer.id),
    );
    return canCopyExactRun && !capabilities.copyToOwn
      ? { ...capabilities, copyToOwn: true }
      : capabilities;
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
  const selfRunnablePrograms = programCatalog.filter(
    (candidate) =>
      candidate.sourceType === "self" &&
      candidate.athleteId === viewer.id &&
      candidate.createdById === viewer.id,
  );
  const runWizardPrograms = [
    ...(assignmentProgramOverride ? [assignmentProgramOverride] : []),
    ...(assignmentSeed.mode === "coach"
      ? assignableOwnPrograms
      : selfRunnablePrograms
    ).filter((candidate) => candidate.id !== assignmentProgramOverride?.id),
  ];
  const exerciseCategoriesById = useMemo(
    () =>
      new Map(
        [...workspace.globalExercises, ...workspace.personalExercises].map(
          (exercise) => [exercise.id, exercise.category] as const,
        ),
      ),
    [workspace.globalExercises, workspace.personalExercises],
  );
  const exerciseCategoriesByName = useMemo(
    () =>
      new Map(
        [...workspace.globalExercises, ...workspace.personalExercises].map(
          (exercise) => [exercise.name.trim().toLowerCase(), exercise.category] as const,
        ),
      ),
    [workspace.globalExercises, workspace.personalExercises],
  );
  const exerciseCategoryForItem = useCallback(
    (item: WorkoutItem) =>
      item.category ??
      (item.exerciseId ? exerciseCategoriesById.get(item.exerciseId) : undefined) ??
      exerciseCategoriesByName.get(item.title.trim().toLowerCase()) ??
      "General",
    [exerciseCategoriesById, exerciseCategoriesByName],
  );
  const exerciseCategoryForName = useCallback(
    (name: string) =>
      exerciseCategoriesByName.get(name.trim().toLowerCase()) ?? "General",
    [exerciseCategoriesByName],
  );
  const programWorkoutSequence = program ? programWorkouts(program) : [];
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
    programWorkoutSequence.find(
      (workout) => workout.id === selectedWorkoutId,
    ) ?? programWorkoutSequence[0];
  const currentWeek =
    program?.weeks.find((week) =>
      week.workouts.some((workout) => workout.id === selectedWorkout?.id),
    ) ??
    program?.weeks[selectedWeek - 1] ??
    program?.weeks[0];
  const completeRunActivity = useMemo<CoachAgendaEntry[]>(() => {
    if (!viewingProgramRunDetail) return [];
    const today = localDateOnly();
    return viewingProgramRunDetail.workouts.flatMap(
      (slot): CoachAgendaEntry[] => {
      const common = {
        programRunId: viewingProgramRunDetail.id,
        programRunWorkoutId: slot.id,
        programId: viewingProgramRunDetail.programId,
        programVersionId: viewingProgramRunDetail.programVersionId,
        programTitle: viewingProgramRunDetail.title,
        workoutId: slot.workoutId,
        workoutTitle: slot.title,
        scheduleId: slot.scheduledWorkoutId,
      };
      const completedDate =
        slot.completedForDate ?? slot.completedAt?.slice(0, 10);
      if (slot.status === "completed" && slot.sessionId && completedDate) {
        return [{
          ...common,
          id: `session:${slot.sessionId}`,
          kind: "completed" as const,
          status: "completed" as const,
          date: completedDate,
          sessionId: slot.sessionId,
          rpe: slot.sessionRpe,
        }];
      }
      if (
        slot.plannedDate &&
        (slot.status === "scheduled" || slot.status === "in_progress")
      ) {
        return [{
          ...common,
          id: `run-slot:${slot.id}`,
          kind: "upcoming" as const,
          status:
            slot.status === "in_progress"
              ? "in_progress" as const
              : slot.plannedDate < today
                ? "overdue" as const
                : "planned" as const,
          date: slot.plannedDate,
        }];
      }
        return [];
      },
    );
  }, [viewingProgramRunDetail]);

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
    preferred?: {
      weekIndex?: number;
      workoutId?: string;
      sectionId?: string;
      programRunId?: string;
      programRunDetail?: ProgramRunDetail | null;
      returnView?: ViewName;
    },
    options: { writeHistory?: boolean } = {},
  ) {
    const preferredWorkoutWeek = preferred?.workoutId
      ? nextProgram.weeks.find((week) =>
          week.workouts.some(
            (workout) => workout.id === preferred.workoutId,
          ),
        )
      : undefined;
    const requestedWeek = Math.min(
      preferredWorkoutWeek?.index ?? preferred?.weekIndex ?? nextProgram.activeWeek,
      nextProgram.weeks.at(-1)?.index ?? 1,
    );
    const nextWeek =
      nextProgram.weeks.find((week) => week.index === requestedWeek) ??
      nextProgram.weeks[nextProgram.activeWeek - 1] ??
      nextProgram.weeks[0];
    const nextWorkout = preferred?.workoutId
      ? nextProgram.weeks
          .flatMap((week) => week.workouts)
          .find((workout) => workout.id === preferred.workoutId) ??
        nextWeek?.workouts[0]
      : nextWeek?.workouts[0];
    const nextSection =
      nextWorkout?.sections.find(
        (section) => section.id === preferred?.sectionId,
      ) ?? nextWorkout?.sections[0];
    setProgram(nextProgram);
    setViewingProgramRunId(
      preferred?.programRunDetail?.id ?? preferred?.programRunId ?? null,
    );
    setViewingProgramRunDetail(preferred?.programRunDetail ?? null);
    const returnView = preferred?.returnView ?? "program";
    setProgramReturnView(returnView);
    if (options.writeHistory !== false) {
      programHistoryRequestRef.current += 1;
      const programRunId =
        preferred?.programRunDetail?.id ?? preferred?.programRunId;
      const historyData: Extract<AppDetailData, { kind: "program" }> = {
        kind: "program",
        programId: nextProgram.id,
        programVersionId: nextProgram.versionId,
        athleteId: nextProgram.athleteId,
        ...(nextProgram.assignmentId
          ? { assignmentId: nextProgram.assignmentId }
          : {}),
        ...(programRunId ? { programRunId } : {}),
        ...(nextWorkout?.id ? { workoutId: nextWorkout.id } : {}),
        returnView,
      };
      programHistoryRestoreKeyRef.current = [
        historyData.athleteId,
        historyData.programId,
        historyData.programVersionId,
        historyData.assignmentId ?? "unassigned",
        historyData.programRunId ?? "template",
        historyData.workoutId ?? "first",
        historyData.returnView,
      ].join(":");
      pushAppDetailHistory("program", "program", { data: historyData });
    }
    setSelectedWeek(nextWeek?.index ?? 1);
    setSelectedWorkoutId(nextWorkout?.id ?? "");
    setSelectedSectionId(nextSection?.id ?? "");
    setProgramOwnerId(nextProgram.athleteId);
  }

  programHistoryRestoreRef.current = (history) => {
    const restoreKey = [
      history.athleteId,
      history.programId,
      history.programVersionId,
      history.assignmentId ?? "unassigned",
      history.programRunId ?? "template",
      history.workoutId ?? "first",
      history.returnView,
    ].join(":");
    if (programHistoryRestoreKeyRef.current === restoreKey) return;
    programHistoryRestoreKeyRef.current = restoreKey;
    const requestId = programHistoryRequestRef.current + 1;
    programHistoryRequestRef.current = requestId;
    const applyRestoredProgram = (
      nextProgram: Program,
      runDetail: ProgramRunDetail | null = null,
    ) => {
      if (
        programHistoryRequestRef.current !== requestId ||
        appDetailFromHistory() !== "program"
      ) {
        return;
      }
      selectProgram(
        nextProgram,
        {
          workoutId: history.workoutId,
          programRunId: history.programRunId,
          programRunDetail: runDetail,
          returnView: history.returnView,
        },
        { writeHistory: false },
      );
    };

    const currentProgramMatches =
      program?.id === history.programId &&
      program.versionId === history.programVersionId &&
      program.athleteId === history.athleteId;
    const currentRunDetail =
      history.programRunId &&
      viewingProgramRunDetail?.id === history.programRunId
        ? viewingProgramRunDetail
        : null;
    if (currentProgramMatches && (!history.programRunId || currentRunDetail)) {
      applyRestoredProgram(program, currentRunDetail);
      return;
    }

    if (!repository) {
      const cachedProgram = programCatalog.find(
        (candidate) =>
          candidate.id === history.programId &&
          candidate.versionId === history.programVersionId &&
          candidate.athleteId === history.athleteId,
      );
      if (cachedProgram) applyRestoredProgram(cachedProgram, currentRunDetail);
      else programHistoryRestoreKeyRef.current = null;
      return;
    }

    const programPromise = history.programRunId
      ? repository.loadProgramForRun(history.programRunId)
      : repository.loadProgramDetail(
          history.athleteId,
          history.programId,
          history.programVersionId,
          history.assignmentId,
        );
    const runPromise = history.programRunId
      ? repository.loadProgramRunDetail(history.programRunId)
      : Promise.resolve(null);
    void Promise.all([programPromise, runPromise])
      .then(([nextProgram, runDetail]) => {
        if (!nextProgram) {
          throw new Error("This program revision is no longer available.");
        }
        applyRestoredProgram(nextProgram, runDetail);
      })
      .catch((error: unknown) => {
        if (
          programHistoryRequestRef.current !== requestId ||
          appDetailFromHistory() !== "program"
        ) {
          return;
        }
        programHistoryRestoreKeyRef.current = null;
        notify(
          error instanceof Error
            ? error.message
            : "The program could not be restored.",
        );
      });
  };

  async function openProgram(targetProgram: Program) {
    void loadProgramView();
    if (!repository || targetProgram.detailsLoaded !== false) {
      selectProgram(targetProgram);
      setActiveView("program");
      return;
    }
    if (programAction) return;
    const requestId = ++programHistoryRequestRef.current;
    setProgramAction({ id: targetProgram.id, kind: "open" });
    try {
      const detail = await repository.loadProgramDetail(
        targetProgram.athleteId,
        targetProgram.id,
        targetProgram.versionId,
        targetProgram.assignmentId,
      );
      if (programHistoryRequestRef.current !== requestId) return;
      if (!detail) throw new Error("This program is no longer available.");
      selectProgram(detail);
      setActiveView("program");
    } catch (error) {
      if (programHistoryRequestRef.current !== requestId) return;
      notify(
        error instanceof Error
          ? error.message
          : "The program could not be opened",
      );
    } finally {
      setProgramAction(null);
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
    const [page, programRunPage, coachProgramRunPage] = await Promise.all([
      repository.listProgramSummaries({ limit: 25 }),
      repository.listProgramRuns(),
      repository.listProgramRuns(undefined, { creatorScope: "coach" }),
    ]);
    setProgramCursor(page.nextCursor);
    setWorkspace((previous) => ({
      ...mergeProgramCatalog(previous, page.items, true),
      programRuns: programRunPage.items,
      programRunCursor: programRunPage.nextCursor,
      hasMoreProgramRuns: programRunPage.hasMore,
      coachProgramRuns: coachProgramRunPage.items,
      coachProgramRunCursor: coachProgramRunPage.nextCursor,
      hasMoreCoachProgramRuns: coachProgramRunPage.hasMore,
    }));
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
      returnView: programReturnView,
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
    completedWorkoutRequestRef.current += 1;
    completedWorkoutRestoreKeyRef.current = null;
    programHistoryRequestRef.current += 1;
    programHistoryRestoreKeyRef.current = null;
    setDetail(null);
    if (view === "today" && activeSession && activeWorkoutVisible) {
      setActiveWorkoutVisible(false);
      setDetail(null);
    }
    if (view === "program") {
      setProgram(null);
      setViewingProgramRunId(null);
      setViewingProgramRunDetail(null);
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

  function leaveDetail(returnView: ViewName) {
    programHistoryRequestRef.current += 1;
    setDetail(null);
    setActiveWorkoutVisible(false);
    if (!leaveAppDetailHistory()) {
      setActiveView(returnView);
      updateAppViewUrl(returnView);
    }
    scrollToAppTop();
  }

  function showActiveWorkout() {
    pushAppDetailHistory("workout", "today");
    setActiveWorkoutVisible(true);
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

  async function loadMoreCoachHistory(athleteId: string) {
    if (!repository || coachingHistoryLoadingId) return;
    const athlete = workspace.coachedAthletes.find(
      (candidate) => candidate.id === athleteId,
    );
    if (!athlete?.historyCursor || !athlete.hasMoreHistory) return;
    setCoachingHistoryLoadingId(athleteId);
    try {
      const page = await repository.listCoachCompletedHistory(athleteId, {
        limit: 25,
        cursor: athlete.historyCursor,
      });
      setWorkspace((previous) => ({
        ...previous,
        coachedAthletes: previous.coachedAthletes.map((candidate) => {
          if (candidate.id !== athleteId) return candidate;
          const agendaById = new Map(
            candidate.agenda.map((entry) => [entry.id, entry]),
          );
          for (const entry of page.items) agendaById.set(entry.id, entry);
          const agenda = [...agendaById.values()].sort((left, right) => {
            if (left.kind !== right.kind) return left.kind === "upcoming" ? -1 : 1;
            return left.kind === "upcoming"
              ? left.date.localeCompare(right.date)
              : right.date.localeCompare(left.date);
          });
          return {
            ...candidate,
            agenda,
            historyCursor: page.nextCursor,
            hasMoreHistory: page.hasMore,
          };
        }),
      }));
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "More workout results could not be loaded.",
      );
    } finally {
      setCoachingHistoryLoadingId(null);
    }
  }

  async function loadMoreCoachProgramRuns(athleteId: string) {
    if (!repository || coachingProgramRunsLoadingId) return;
    const athlete = workspace.coachedAthletes.find(
      (candidate) => candidate.id === athleteId,
    );
    if (!athlete?.programRunCursor || !athlete.hasMoreProgramRuns) return;
    setCoachingProgramRunsLoadingId(athleteId);
    try {
      const page = await repository.listProgramRuns(athleteId, {
        limit: 25,
        cursor: athlete.programRunCursor,
      });
      setWorkspace((previous) => ({
        ...previous,
        coachedAthletes: previous.coachedAthletes.map((candidate) => {
          if (candidate.id !== athleteId) return candidate;
          const runsById = new Map(
            (candidate.programRuns ?? []).map((run) => [run.id, run]),
          );
          for (const run of page.items) runsById.set(run.id, run);
          return {
            ...candidate,
            programRuns: [...runsById.values()],
            programRunCursor: page.nextCursor,
            hasMoreProgramRuns: page.hasMore,
          };
        }),
      }));
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "More program history could not be loaded.",
      );
    } finally {
      setCoachingProgramRunsLoadingId(null);
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
        showActiveWorkout();
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
      showActiveWorkout();
      setWorkspace((previous) => ({
        ...previous,
        scheduledWorkouts: previous.scheduledWorkouts.map((candidate) =>
          candidate.id === schedule.id
            ? { ...candidate, status: "in_progress" }
            : candidate,
        ),
      }));
      setCalendarRangeData((previous) => ({
        ...previous,
        scheduledWorkouts: previous.scheduledWorkouts.map((candidate) =>
          candidate.id === schedule.id
            ? { ...candidate, status: "in_progress" }
            : candidate,
        ),
      }));
      void refreshProgramRunSummaries().catch(() => undefined);
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
    recordHistory = true,
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
      if (recordHistory) pushAppDetailHistory("workout", "today");
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
    setCalendarRangeData((previous) => ({
      ...previous,
      scheduledWorkouts: previous.scheduledWorkouts.map((scheduled) =>
        scheduled.id === session.scheduledWorkoutId
          ? { ...scheduled, status: scheduleStatus }
          : scheduled,
      ),
    }));
  }

  async function finishWorkout() {
    if (activeSession && !activeWorkoutPersistence.editable) return;
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
        invalidateCompletedHistory();
        const visibleRange = lastCalendarRangeRef.current;
        await Promise.allSettled([
          refreshProgramRunSummaries(),
          loadUpcomingWorkouts(true),
          ...(visibleRange
            ? [loadVisibleCalendarRange(visibleRange.start, visibleRange.end)]
            : []),
        ]);
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
        workout = await repository.addWorkout(program, title);
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
        dayLabel: `Workout ${programWorkoutSequence.length + 1}`,
        durationMinutes: 45,
        sections: [
          {
            id: `section-${Date.now()}`,
            title: "Exercises",
            kind: "main",
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
              week.id === currentWeek.id
                ? { ...week, workouts: [...week.workouts, workout] }
                : week,
            ),
          }
        : previous,
    );
    setSelectedWorkoutId(workout.id);
    setSelectedWeek(currentWeek.index);
    setSelectedSectionId(workout.sections[0]?.id ?? "");
    setModal(null);
    notify("Workout added to the program");
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
  ) {
    if (!selectedWorkout) return;
    const targetSection = selectedWorkout.sections[0];
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
        category: exercise.category,
        videoUrl: exercise.videoUrl,
        title: exercise.name,
        cue: exercise.cue,
        mode: exercise.defaultMode,
        fields: exercise.defaultFields,
        prescription:
          exercise.defaultMode === "sets"
            ? { sets: 3, reps: "8", targetRpe: "7–8" }
            : exercise.defaultMode === "intervals"
              ? { rounds: 5, workSeconds: 60, restSeconds: 60 }
              : exercise.defaultMode === "result" &&
                  exercise.defaultFields.includes("duration")
                ? { durationMinutes: 20 }
                : {},
      };
    }
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
            })),
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

  function deleteSelectedWorkout() {
    if (!selectedWorkout || !repository) return;
    setContentDeleteTarget({
      kind: "workout",
      id: selectedWorkout.id,
      title: selectedWorkout.title,
    });
    setModal("delete-content");
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
    const optimisticProgram = reorderProgramWorkoutSequence(snapshot, workoutIds);
    builderMutationPendingRef.current = true;
    setBuilderMutationPending(true);
    replaceProgramEverywhere(optimisticProgram);
    try {
      await repository.reorderWorkouts(snapshot, workoutIds);
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

  async function reorderWorkoutItems(itemIds: string[]) {
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
    const optimisticProgram = reorderProgramWorkoutItems(
      snapshot,
      selectedWorkout.id,
      itemIds,
    );
    builderMutationPendingRef.current = true;
    setBuilderMutationPending(true);
    replaceProgramEverywhere(optimisticProgram);
    try {
      await repository.reorderWorkoutItems(selectedWorkout.id, itemIds);
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

  function removeItemFromProgram(itemId: string) {
    if (!selectedWorkout) return;
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
                      sections: workout.sections.map((section) => ({
                        ...section,
                        items: section.items.filter(
                          (item) => item.id !== itemId,
                        ),
                      })),
                    },
              ),
            })),
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
    fields: TrackingField[],
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
          fields,
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
      exercise = {
        id: `personal-${Date.now()}`,
        name,
        category,
        discipline,
        cue,
        scope: "personal",
        ownerName: viewer.name,
        defaultMode: mode,
        defaultFields: trackingFieldsForMode(mode, fields),
      };
    }
    setWorkspace((previous) => ({
      ...previous,
      personalExercises: [...previous.personalExercises, exercise],
    }));
    setExerciseScope("personal");
    setExerciseQuery("");
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
    fields: TrackingField[],
    cue: string,
  ) {
    if (original.scope !== "personal") return;
    const input = {
      name,
      category,
      discipline,
      tags: original.tags,
      sourceProvider: original.sourceProvider,
      sourceExternalId: original.sourceExternalId,
      sourceUrl: original.sourceUrl,
      videoUrl: original.videoUrl,
      mode,
      fields,
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
      retryExerciseSearch();
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
    retryExerciseSearch();
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
            sourceProvider: exercise.sourceProvider,
            sourceExternalId: exercise.sourceExternalId,
            sourceUrl: exercise.sourceUrl,
            videoUrl: exercise.videoUrl,
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
      setExerciseQuery("");
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

  async function saveProgram(title: string, description: string) {
    if (!program || programAction) return;
    const nextTitle = title.trim();
    const nextDescription = description.trim();
    if (!nextTitle) return;
    if (!repository) {
      notify("Program saved for the local demo");
      return;
    }
    setProgramAction({ id: program.id, kind: "save" });
    try {
      requireCapability(capabilitiesForProgram(program), "save");
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
      await refreshProgramWorkspace(program.id);
      setProgram(null);
      setProgramOwnerId(viewer.id);
      notify(
        program.contentType === "quick_workout"
          ? "Workout saved for future uses."
          : program.sourceType === "coach"
          ? "Coach program saved."
          : "Program saved for future runs.",
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

  async function editProgram(targetProgram: Program) {
    if (!repository) {
      selectProgram(targetProgram);
      return;
    }
    if (programAction) return;
    const requestId = ++programHistoryRequestRef.current;
    setProgramAction({ id: targetProgram.id, kind: "edit" });
    try {
      requireCapability(capabilitiesForProgram(targetProgram), "edit");
      const editableProgram = await repository.loadEditableProgram(
        targetProgram.athleteId,
        targetProgram.id,
      );
      if (programHistoryRequestRef.current !== requestId) return;
      selectProgram(editableProgram);
      setActiveView("program");
    } catch (error) {
      if (programHistoryRequestRef.current !== requestId) return;
      notify(
        error instanceof Error
          ? error.message
          : "The program could not be opened for editing",
      );
    } finally {
      setProgramAction(null);
    }
  }

  async function duplicateProgram(
    targetProgram: Program,
    sourceRunId?: string,
  ) {
    if (!repository || programAction) return;
    setProgramAction({ id: targetProgram.id, kind: "duplicate" });
    try {
      requireCapability(
        sourceRunId
          ? capabilitiesForViewedProgram(targetProgram)
          : capabilitiesForProgram(targetProgram),
        "copyToOwn",
      );
      const copyId = sourceRunId
        ? await repository.copyProgramRunToOwn(sourceRunId)
        : await repository.copyProgramToOwn(targetProgram.id);
      await refreshProgramWorkspace(copyId);
      const copy = await repository.loadEditableProgram(viewer.id, copyId);
      selectProgram(copy, { returnView: programReturnView });
      setActiveView("program");
      notify(`${targetProgram.title} duplicated. The new copy is editable.`);
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "The content could not be duplicated",
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

  async function openProgramRunWizard(seed: {
    mode: "self" | "coach";
    programId?: string;
    athleteIds?: string[];
    repeatRun?: ProgramRunSummary;
  }) {
    if (repository) {
      const requiredFeatures: LazyWorkspaceFeature[] = ["programs"];
      if (seed.mode === "coach") requiredFeatures.push("coaching");
      await Promise.all(
        requiredFeatures.map((feature) => loadWorkspaceFeature(feature)),
      );
      const missingFeature = requiredFeatures.find(
        (feature) => !loadedWorkspaceFeaturesRef.current.has(feature),
      );
      if (missingFeature) {
        notify(
          missingFeature === "coaching"
            ? "Your athletes could not be loaded. Try again."
            : "Your programs could not be loaded. Try again.",
        );
        return;
      }
    }
    if (seed.repeatRun) {
      try {
        const exactProgram = repository
          ? await repository.loadProgramForRun(seed.repeatRun.id)
          : programCatalog.find(
              (candidate) => candidate.id === seed.repeatRun?.programId,
            ) ?? null;
        if (!exactProgram) {
          throw new Error("This completed program revision is no longer available.");
        }
        setAssignmentProgramOverride(exactProgram);
      } catch (error) {
        notify(
          error instanceof Error
            ? error.message
            : "This program could not be prepared for repeating.",
        );
        return;
      }
    } else {
      setAssignmentProgramOverride(null);
    }
    setAssignmentSeed(seed);
    setModal("assign-program");
  }

  async function createProgramRun(
    submission: ProgramRunWizardSubmission,
  ): Promise<void> {
    const { programId, athleteIds, workoutDates, idempotencyKey } = submission;
    const repeatRun = assignmentSeed.repeatRun;
    const sourceProgram =
      (assignmentProgramOverride?.id === programId
        ? assignmentProgramOverride
        : undefined) ??
      assignableOwnPrograms.find((candidate) => candidate.id === programId) ??
      programCatalog.find((candidate) => candidate.id === programId);
    if (!sourceProgram) throw new Error("Choose one of your programs.");
    if (!athleteIds.length) throw new Error("Choose at least one athlete.");
    const isSelfRun = athleteIds.length === 1 && athleteIds[0] === viewer.id;
    if (repeatRun) {
      if (
        athleteIds.length !== 1 ||
        athleteIds[0] !== repeatRun.athleteId ||
        (repeatRun.athleteId !== viewer.id &&
          repeatRun.createdById !== viewer.id)
      ) {
        throw new Error("This program run cannot be repeated for that athlete.");
      }
    } else {
      if (!isSelfRun) {
        requireCapability(capabilitiesForProgram(sourceProgram), "assign");
      } else if (
        sourceProgram.athleteId !== viewer.id ||
        sourceProgram.createdById !== viewer.id ||
        sourceProgram.sourceType !== "self"
      ) {
        throw new Error("Only your own reusable training can be started.");
      }
    }

    if (!repository) {
      const createdAt = new Date().toISOString();
      const demoRuns = athleteIds.map((athleteId, index) => ({
        id: `run-${Date.now()}-${index}`,
        athleteId,
        createdById: viewer.id,
        programId: sourceProgram.id,
        programVersionId: sourceProgram.versionId,
        title: sourceProgram.title,
        contentType: sourceProgram.contentType ?? "program",
        status: "not_started" as const,
        totalWorkouts: workoutDates.length,
        scheduledWorkouts: workoutDates.filter((entry) => entry.plannedDate).length,
        completedWorkouts: 0,
        completionPercent: 0,
        createdAt,
      }));
      setWorkspace((previous) => ({
        ...previous,
        programRuns: isSelfRun
          ? [...demoRuns, ...(previous.programRuns ?? [])]
          : previous.programRuns,
        coachedAthletes: previous.coachedAthletes.map((athlete) => {
          const run = demoRuns.find((candidate) => candidate.athleteId === athlete.id);
          return run
            ? { ...athlete, programRuns: [run, ...(athlete.programRuns ?? [])] }
            : athlete;
        }),
      }));
    } else if (repeatRun) {
      await repository.repeatProgramRun(
        repeatRun.id,
        workoutDates as ProgramRunWorkoutDate[],
        idempotencyKey,
      );
    } else {
      await repository.createProgramRuns(
        programId,
        athleteIds,
        workoutDates as ProgramRunWorkoutDate[],
        idempotencyKey,
      );
    }

    const scheduledCount = workoutDates.filter((entry) => entry.plannedDate).length;
    setAssignmentSeed({ mode: "coach" });
    setAssignmentProgramOverride(null);
    setModal(null);
    let refreshFailed = false;
    if (repository) {
      try {
        await refreshProgramWorkspace(programId);
        if (isSelfRun) await loadUpcomingWorkouts(true);
        if (
          program?.id === programId &&
          program.athleteId === viewer.id &&
          program.createdById === viewer.id
        ) {
          selectProgram(await repository.loadEditableProgram(viewer.id, programId));
        }
        if (!isSelfRun) {
          const refreshed = await refreshCoachWorkspace();
          refreshFailed = !refreshed;
        }
      } catch {
        refreshFailed = true;
      }
    }
    const successMessage =
      repeatRun
        ? `${sourceProgram.title} added as a new run`
        : isSelfRun
          ? `${sourceProgram.title} started${scheduledCount ? ` · ${scheduledCount} workouts scheduled` : ""}`
          : `${sourceProgram.title} assigned to ${athleteIds.length} ${athleteIds.length === 1 ? "athlete" : "athletes"}${scheduledCount ? " and scheduled" : ""}`;
    notify(
      refreshFailed
        ? `${successMessage} · saved successfully; refresh to update this screen`
        : successMessage,
    );
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
          { returnView: target.id === viewer.id ? "program" : "coaching" },
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
        selectProgram(emptyProgram, {
          returnView: target.id === viewer.id ? "program" : "coaching",
        });
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
                { id: `exercises-${now}`, title: "Exercises", kind: "main", items: [] },
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

  function unassignProgram(assignmentId: string | undefined, title: string) {
    if (!assignmentId) {
      notify("This assignment cannot be removed.");
      return;
    }
    setContentDeleteTarget({ kind: "assignment", id: assignmentId, title });
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
    if (target.kind === "program-run") {
      if (!repository) throw new Error("The program run could not be ended.");
      await repository.endProgramRun(target.id);
      await Promise.all([
        refreshProgramWorkspace(),
        loadUpcomingWorkouts(true),
      ]);
      if (coachMode === "coach") await refreshCoachWorkspace();
      notify(`${target.title} ended · completed results remain in history`);
      return;
    }
    if (target.kind === "assignment") {
      if (!repository) throw new Error("The program could not be unassigned.");
      await repository.unassignProgram(target.id);
      setProgram((current) =>
        current?.assignmentId === target.id ? null : current,
      );
      await Promise.all([refreshProgramWorkspace(), refreshCoachWorkspace()]);
      notify(`${target.title} unassigned · completed history preserved`);
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
        const [page, frequent] = await Promise.all([
          repository.listSchedulableWorkouts({
            limit: 50,
            ...(reset || !scheduleCandidateCursor
              ? {}
              : { cursor: scheduleCandidateCursor }),
          }),
          reset
            ? repository.listFrequentSchedulableWorkouts(6).catch(() => [])
            : Promise.resolve(null),
        ]);
        if (frequent) setFrequentScheduleCandidates(frequent);
        const quickWorkoutItems = page.items.filter(
          (candidate) => candidate.isQuickWorkout,
        );
        setScheduleCandidates((current) =>
          reset
            ? quickWorkoutItems
            : [
                ...current,
                ...quickWorkoutItems.filter(
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

      const demoCandidates = schedulablePrograms
        .filter((candidate) => candidate.contentType === "quick_workout")
        .flatMap((candidate) =>
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
      setFrequentScheduleCandidates(
        demoCandidates
          .filter(
            (candidate) =>
              candidate.isQuickWorkout &&
              (candidate.latestOccurrence?.sequenceNumber ?? 0) > 0,
          )
          .sort(
            (left, right) =>
              (right.latestOccurrence?.sequenceNumber ?? 0) -
                (left.latestOccurrence?.sequenceNumber ?? 0) ||
              left.workoutTitle.localeCompare(right.workoutTitle),
          )
          .slice(0, 6)
          .map((candidate) => ({
            ...candidate,
            usageCount: candidate.latestOccurrence?.sequenceNumber ?? 1,
            lastUsedAt: candidate.latestOccurrence?.plannedDate ?? "1970-01-01",
          })),
      );
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

  async function openScheduleForProgram(targetProgram: Program) {
    try {
      const detail = targetProgram.detailsLoaded === false && repository
        ? await repository.loadProgramDetail(
            targetProgram.athleteId,
            targetProgram.id,
            targetProgram.versionId,
            targetProgram.assignmentId,
          )
        : targetProgram;
      if (!detail) throw new Error("This content is no longer available.");
      const candidates = detail.weeks.flatMap((week) =>
        week.workouts.map((workout, workoutPosition) => {
          const latestOccurrence = workspace.scheduledWorkouts
            .filter(
              (occurrence) =>
                occurrence.programVersionId === detail.versionId &&
                occurrence.workoutId === workout.id,
            )
            .sort((left, right) => right.sequenceNumber - left.sequenceNumber)[0];
          return {
            kind: detail.assignmentId ? "assignment" as const : "program" as const,
            programId: detail.id,
            assignmentId: detail.assignmentId,
            programVersionId: detail.versionId,
            workoutId: workout.id,
            programTitle: detail.title,
            workoutTitle: workout.title,
            contentType: detail.contentType ?? "program",
            isQuickWorkout: detail.contentType === "quick_workout",
            weekIndex: week.index,
            weekLabel: week.label,
            workoutPosition,
            scheduleLabel: workout.dayLabel,
            estimatedMinutes: workout.durationMinutes,
            ...(latestOccurrence
              ? {
                  latestOccurrence: {
                    id: latestOccurrence.id,
                    plannedDate: latestOccurrence.plannedDate,
                    status: latestOccurrence.status,
                    sequenceNumber: latestOccurrence.sequenceNumber,
                  },
                }
              : {}),
          } satisfies SchedulableWorkoutCandidate;
        }),
      );
      setScheduleCandidates(candidates);
      setFrequentScheduleCandidates([]);
      setScheduleCandidateCursor(undefined);
      setScheduleCandidatesError("");
      setScheduleEditingId(null);
      setScheduleInitialDate(null);
      setModal("schedule");
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "The workout could not be prepared for scheduling",
      );
    }
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
      if (repository) {
        await Promise.allSettled([
          loadUpcomingWorkouts(true),
          refreshProgramRunSummaries(),
        ]);
      }
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
    idempotencyKey: string,
  ) {
    if (candidate.scheduleId) {
      await saveSchedule(candidate.scheduleId, date);
      return;
    }
    if (!date) throw new Error("Choose a date for this workout.");

    const demoScheduleId = `schedule-${Date.now()}`;
    const demoRunId = `run-${Date.now()}`;
    const demoRunWorkoutId = `${demoRunId}:${candidate.workoutId}`;
    if (repository && candidate.assignmentId) {
      throw new Error(
        "This older assignment is read-only. Schedule its migrated program run instead.",
      );
    }
    const created = repository
      ? await repository.createScheduledQuickWorkoutRun(
          candidate.programId,
          date,
          idempotencyKey,
        )
      : {
          id: demoScheduleId,
          programRunId: demoRunId,
          programRunWorkoutId: demoRunWorkoutId,
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
      ...(!repository && !candidate.assignmentId
        ? {
            programRuns: [
              {
                id: demoRunId,
                athleteId: viewer.id,
                createdById: viewer.id,
                programId: candidate.programId,
                programVersionId: candidate.programVersionId,
                title: candidate.programTitle,
                contentType: "quick_workout" as const,
                status: "not_started" as const,
                totalWorkouts: 1,
                scheduledWorkouts: 1,
                completedWorkouts: 0,
                completionPercent: 0,
                nextWorkout: {
                  id: demoRunWorkoutId,
                  title: candidate.workoutTitle,
                  plannedDate: date,
                  status: "scheduled" as const,
                },
                createdAt: new Date().toISOString(),
              },
              ...(previous.programRuns ?? []),
            ],
          }
        : {}),
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
    if (repository && !candidate.assignmentId) {
      try {
        await refreshProgramWorkspace(candidate.programId);
      } catch {
        notify("Workout scheduled · refresh Programs to see the new editable copy");
        return;
      }
    }
    notify("Workout added to your calendar");
  }

  async function setScheduledWorkoutStatus(
    scheduleId: string,
    status: "planned" | "skipped",
  ) {
    if (activeSession?.scheduledWorkoutId === scheduleId && !activeWorkoutPersistence.editable) return;
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
      if (repository) {
        await refreshProgramRunSummaries().catch(() => undefined);
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
    if (await openWorkoutPreview(schedule, "calendar", false)) {
      setActiveView("today");
      pushAppDetailHistory("workout", "today");
      scrollToAppTop();
    }
  }

  async function openCalendarResults(
    session: CompletedSession,
    athleteId?: string,
    returnView: "today" | "calendar" | "coaching" | "program" = "calendar",
  ) {
    setActiveView("today");
    pushAppDetailHistory("workout-log", "today", {
      stackOnDetail: returnView === "program" || returnView === "coaching",
      data: {
        kind: "workout-log",
        session,
        ...(athleteId ? { athleteId } : {}),
        returnView,
      },
    });
    completedWorkoutRestoreKeyRef.current = null;
    restoreCompletedWorkoutFromHistory({
      kind: "workout-log",
      session,
      ...(athleteId ? { athleteId } : {}),
      returnView,
    });
    scrollToAppTop();
  }

  async function openAthleteProgram(
    athlete: AthleteSummary,
    assignedProgram: CoachWorkspaceProgram,
    workoutId?: string,
    programVersionId?: string,
  ) {
    if (openingCoachProgramId) return;
    const requestId = ++programHistoryRequestRef.current;
    setOpeningCoachProgramId(assignedProgram.id);
    try {
      if (!repository) {
        navigate("program");
        return;
      }
      const resolvedVersionId =
        programVersionId ??
        ("programVersionId" in assignedProgram
          ? assignedProgram.programVersionId
          : assignedProgram.versionId);
      const assignmentId = assignedProgram.assignmentId;
      const programRunId =
        "programVersionId" in assignedProgram && !assignedProgram.legacy
          ? assignedProgram.id
          : undefined;
      const [nextProgram, runDetail] = programRunId
        ? await Promise.all([
            repository.loadProgramForRun(programRunId),
            repository.loadProgramRunDetail(programRunId),
          ])
        : [
            resolvedVersionId
              ? await repository.loadProgramVersionForAthleteById(
                  athlete.id,
                  assignedProgram.programId ?? assignedProgram.id,
                  resolvedVersionId,
                  assignmentId,
                )
              : await repository.loadProgramForAthleteById(
                  athlete.id,
                  assignedProgram.programId ?? assignedProgram.id,
                  assignmentId,
                ),
            null,
          ];
      if (programHistoryRequestRef.current !== requestId) return;
      setProgramOwnerId(athlete.id);
      if (nextProgram) {
        const targetWorkoutId =
          workoutId ??
          (runDetail
            ? nextIncompleteRunWorkoutId(runDetail.workouts) ??
              runDetail.workouts[0]?.workoutId
            : undefined);
        const workoutWeek = targetWorkoutId
          ? nextProgram.weeks.find((week) =>
              week.workouts.some((workout) => workout.id === targetWorkoutId),
            )
          : undefined;
        selectProgram(nextProgram, {
          weekIndex: workoutWeek?.index,
          workoutId: targetWorkoutId,
          programRunId,
          programRunDetail: runDetail,
          returnView: "coaching",
        });
      }
      else setProgram(null);
      setActiveView("program");
      scrollToAppTop();
    } catch (error) {
      if (programHistoryRequestRef.current !== requestId) return;
      notify(
        error instanceof Error
          ? error.message
          : "The athlete program could not be opened",
      );
    } finally {
      setOpeningCoachProgramId(null);
    }
  }

  async function openOwnProgramRun(
    run: ProgramRunSummary,
    returnView: "today" | "program" = "today",
  ) {
    if (openingCoachProgramId) return;
    const requestId = ++programHistoryRequestRef.current;
    setOpeningCoachProgramId(run.id);
    try {
      const [nextProgram, runDetail] = await Promise.all([
        repository
          ? repository.loadProgramForRun(run.id)
          : Promise.resolve(
              programCatalog.find((candidate) => candidate.id === run.programId) ??
                null,
            ),
        loadProgramRunDetail(run.id),
      ]);
      if (programHistoryRequestRef.current !== requestId) return;
      if (!nextProgram) throw new Error("This program revision is no longer available.");
      const workoutId =
        (runDetail && nextIncompleteRunWorkoutId(runDetail.workouts)) ??
        runDetail?.workouts[0]?.workoutId;
      setProgramOwnerId(viewer.id);
      selectProgram(nextProgram, {
        programRunId: run.id,
        programRunDetail: runDetail,
        workoutId,
        returnView,
      });
      setActiveView("program");
      updateAppViewUrl("program");
      scrollToAppTop();
    } catch (error) {
      if (programHistoryRequestRef.current !== requestId) return;
      notify(
        error instanceof Error
          ? error.message
          : "The program run could not be opened",
      );
    } finally {
      setOpeningCoachProgramId(null);
    }
  }

  function openProgramRunActivity(entry: CoachAgendaEntry) {
    if (entry.kind !== "completed" || !entry.sessionId) return;
    void openCalendarResults(
      {
        id: entry.sessionId,
        programRunId: entry.programRunId,
        programRunWorkoutId: entry.programRunWorkoutId,
        programVersionId: entry.programVersionId,
        workoutId: entry.workoutId,
        workoutTitle: entry.workoutTitle,
        date: entry.date,
        durationMinutes: 0,
        rpe: entry.rpe ?? 0,
      },
      program?.athleteId !== viewer.id ? program?.athleteId : undefined,
      "program",
    );
  }

  function openCoachAgendaEntry(
    athlete: AthleteSummary,
    entry: CoachAgendaEntry,
  ) {
    if (entry.kind === "completed" && entry.sessionId) {
      void openCalendarResults(
        {
          id: entry.sessionId,
          programRunId: entry.programRunId,
          programRunWorkoutId: entry.programRunWorkoutId,
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
    const run = entry.programRunId
      ? athlete.programRuns?.find((candidate) => candidate.id === entry.programRunId)
      : undefined;
    if (run) {
      void openAthleteProgram(
        athlete,
        run,
        entry.workoutId,
        entry.programVersionId,
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
        coachingRequestCount={workspace.pendingCoachInvites.length}
      />

      <section
        className={cn(
          "app-content",
          (completedWorkoutView ||
            showingWorkoutPreview ||
            (activeSession && activeWorkoutVisible) ||
            (activeView === "program" && program)) &&
            "has-detail-navigation",
        )}
      >
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
            exerciseCategoryForName={exerciseCategoryForName}
            program={
              programCatalog.find(
                (candidate) =>
                  candidate.versionId === completedWorkoutView.session.programVersionId,
              )
            }
            onBack={() => {
              completedWorkoutRequestRef.current += 1;
              completedWorkoutRestoreKeyRef.current = null;
              const returnView = completedWorkoutView.returnView;
              if (returnView === "program") {
                leaveDetail("program");
              } else {
                leaveDetail(returnView);
              }
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
            exerciseCategoryForItem={exerciseCategoryForItem}
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
            editable={activeWorkoutPersistence.editable}
            editingBlockedReason={activeWorkoutPersistence.editingBlockedReason}
            onRetryEditing={activeWorkoutPersistence.retryEditing}
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
                    leaveDetail(returnView);
                  }
                : activeSession
                ? () => leaveDetail("today")
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
          />
        )}
        {activeView === "today" &&
          !completedWorkoutView &&
          (!activeSession || !activeWorkoutVisible) &&
          !workoutPreviewSchedule && (
          <Suspense fallback={<div className="feature-load-status" role="status">Loading workouts…</div>}>
          <NextWorkoutsView
            schedules={upcomingWorkouts}
            completedSessions={completedHistory}
            completedLoading={completedHistoryLoading}
            completedError={completedHistoryError}
            completedHasMore={Boolean(completedHistoryCursor)}
            onLoadMoreCompleted={() => void loadCompletedHistory(true)}
            hasMore={Boolean(upcomingCursor)}
            loading={upcomingLoading}
            error={upcomingLoadError}
            onLoadMore={() =>
              void loadUpcomingWorkouts(
                upcomingFailedResetRef.current ||
                  !upcomingInitializedRef.current,
              )
            }
            onLoadCompleted={() => void loadCompletedHistory()}
            onOpenCompleted={(session) =>
              void openCalendarResults(session, undefined, "today")
            }
            hasProgram={programCatalog.some(
              (candidate) =>
                candidate.sourceType === "self" &&
                (candidate.workoutCount ?? programWorkoutCount(candidate)) > 0,
            )}
            hasPublishedProgram={programCatalog.some(
              (candidate) =>
                candidate.sourceType === "self" &&
                (candidate.workoutCount ?? programWorkoutCount(candidate)) > 0,
            )}
            startingScheduleId={startingScheduleId}
            activeScheduleId={
              activeSession
                ? (todaySchedule?.id ?? activeSession.scheduledWorkoutId ?? null)
                : null
            }
            onNavigate={navigate}
            onSchedule={() =>
              void openProgramRunWizard({
                mode: "self",
                athleteIds: [viewer.id],
              })
            }
            onStart={(schedule) => {
              if (
                activeSession &&
                schedule.id ===
                  (todaySchedule?.id ?? activeSession.scheduledWorkoutId)
              ) {
                showActiveWorkout();
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
                showActiveWorkout();
                return;
              }
              openWorkoutPreview(schedule);
            }}
            onSetStatus={(scheduleId, status) => {
              void setScheduledWorkoutStatus(scheduleId, status);
            }}
            statusAction={scheduleStatusAction}
          />
          </Suspense>
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
            programRun={viewingProgramRun}
            action={
              programAction?.id === program.id ? programAction.kind : null
            }
            mutationPending={builderMutationPending}
            viewerId={viewer.id}
            capabilities={capabilitiesForViewedProgram(program)}
            backLabel={
              programReturnView === "coaching"
                ? "Coaching"
                : programReturnView === "calendar"
                  ? "Calendar"
                  : programReturnView === "today"
                    ? "Next"
                    : "Programs"
            }
            workouts={programWorkoutSequence}
            selectedWorkout={selectedWorkout}
            runWorkouts={viewingProgramRunDetail?.workouts ?? []}
            onSearchExercises={searchBuilderExercises}
            onSelectWorkout={(id) => {
              setSelectedWorkoutId(id);
              const workoutWeek = program.weeks.find((week) =>
                week.workouts.some((item) => item.id === id),
              );
              const workout = workoutWeek?.workouts.find((item) => item.id === id);
              if (workoutWeek) setSelectedWeek(workoutWeek.index);
              setSelectedSectionId(workout?.sections[0]?.id ?? "");
            }}
            onAddWorkout={() => setModal("workout")}
            onDeleteWorkout={deleteSelectedWorkout}
            onReorderWorkouts={reorderWorkouts}
            onAddExercise={addExerciseToWorkout}
            onEditItem={(item) => {
              setPrescriptionItem(item);
              setNewPrescriptionItemId(null);
              setModal("prescription");
            }}
            onRemoveItem={removeWorkoutItem}
            onReorderItems={reorderWorkoutItems}
            onSave={(title, description) =>
              void saveProgram(title, description)
            }
            onDuplicate={
              capabilitiesForViewedProgram(program).copyToOwn
                ? () =>
                    void duplicateProgram(
                      program,
                      viewingProgramRunId ?? undefined,
                    )
                : undefined
            }
            onBack={() => {
              const returnView = programReturnView;
              setProgram(null);
              setViewingProgramRunId(null);
              setViewingProgramRunDetail(null);
              if (program.athleteId !== viewer.id) {
                setCoachMode("coach");
              }
              leaveDetail(returnView);
            }}
            onAssignProgram={
              !viewingProgramRunId && capabilitiesForProgram(program).assign
                ? () => void openProgramRunWizard({
                    mode: "coach",
                    programId: program.id,
                  })
                : undefined
            }
            onEditWorkout={() => setModal("workout-settings")}
            onSchedule={
              !viewingProgramRunId && capabilitiesForProgram(program).schedule
                ? () =>
                    void (program.sourceType === "self"
                      ? openProgramRunWizard({
                          mode: "self",
                          programId: program.id,
                          athleteIds: [viewer.id],
                        })
                      : openScheduleForProgram(program))
                : undefined
            }
            renderWorkoutItem={(item) => (
              <WorkoutLogItem
                item={item}
                category={exerciseCategoryForItem(item)}
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
            workoutActivity={
              viewingProgramRunDetail
                ? completeRunActivity
                : program.athleteId !== viewer.id && selectedAthlete && selectedWorkout
                ? selectedAthlete.agenda.filter(
                    (entry) =>
                      entry.workoutId === selectedWorkout.id &&
                      (viewingProgramRunId
                        ? entry.programRunId === viewingProgramRunId
                        : entry.assignmentId === program.assignmentId ||
                          entry.programId === program.id ||
                          entry.programVersionId === program.versionId),
                  )
                : []
            }
            onOpenActivity={
              viewingProgramRunDetail
                ? openProgramRunActivity
                : program.athleteId !== viewer.id && selectedAthlete
                ? (entry) => openCoachAgendaEntry(selectedAthlete, entry)
                : undefined
            }
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
              programRuns={[
                ...new Map(
                  [...(workspace.programRuns ?? []), ...coachProgramRuns].map((run) => [run.id, run]),
                ).values(),
              ]}
              hasMoreProgramRuns={Boolean(workspace.hasMoreCoachProgramRuns)}
              programRunsLoadingMore={coachProgramRunsLoadingMore}
              programRunsLoadError={coachProgramRunsLoadError}
              viewerId={viewer.id}
              source={programSource}
              hasCoach={hasCoachTraining}
              hasMore={Boolean(programCursor)}
              loadingMore={programsLoadingMore}
              loadError={programsLoadError}
              action={programAction}
              capabilitiesForProgram={capabilitiesForProgram}
              onOpen={(targetProgram) => void openProgram(targetProgram)}
              onEdit={editProgram}
              onDuplicate={duplicateProgram}
              onDelete={deleteOwnProgram}
              onUnassign={(targetProgram) =>
                unassignProgram(targetProgram.assignmentId, targetProgram.title)
              }
              onSource={setProgramSource}
              onCreate={() => {
                setProgramTarget({
                  id: viewer.id,
                  name: workspace.profile.displayName,
                });
                setModal("program");
              }}
              onCreateWorkout={() => setModal("quick-workout")}
              onSchedule={(targetProgram) =>
                void (targetProgram.sourceType === "self"
                  ? openProgramRunWizard({
                      mode: "self",
                      programId: targetProgram.id,
                      athleteIds: [viewer.id],
                    })
                  : openScheduleForProgram(targetProgram))
              }
              onOpenRun={(run) => void openOwnProgramRun(run, "program")}
              onScheduleRun={(run) => {
                setProgramRunScheduleTarget(run);
                setModal("run-schedule");
              }}
              onEndRun={(run) => {
                setContentDeleteTarget({
                  kind: "program-run",
                  id: run.id,
                  title: run.title,
                  contentType: run.contentType,
                });
                setModal("delete-content");
              }}
              onRepeatRun={(run) =>
                void openProgramRunWizard({
                  mode: "self",
                  programId: run.programId,
                  athleteIds: [viewer.id],
                  repeatRun: run,
                })
              }
              onLoadMore={() => void loadMorePrograms()}
              onLoadMoreProgramRuns={() => void loadMoreCoachAssignedRuns()}
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
          <Suspense fallback={<div className="feature-load-status" role="status">Loading exercises…</div>}>
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
            onRetry={() => exerciseCursor ? void loadMoreExercises() : retryExerciseSearch()}
          />
          </Suspense>
        )}
        {activeView === "coaching" && (
          <CoachingView
            mode={coachMode}
            coachConnections={workspace.coachConnections}
            pendingInvites={workspace.pendingCoachInvites}
            outgoingInvites={outgoingCoachInvites}
            athletes={workspace.coachedAthletes}
            hasMoreAthletes={Boolean(coachAthleteCursor)}
            loadingMoreAthletes={coachAthletesLoadingMore}
            athletesLoadError={coachAthletesLoadError}
            selectedAthlete={selectedAthlete}
            loadingAthleteId={coachingDetailLoadingId}
            loadingHistoryAthleteId={coachingHistoryLoadingId}
            loadingProgramRunsAthleteId={coachingProgramRunsLoadingId}
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
            onLoadMoreHistory={(athlete) =>
              void loadMoreCoachHistory(athlete.id)
            }
            onLoadMoreProgramRuns={(athlete) =>
              void loadMoreCoachProgramRuns(athlete.id)
            }
            onOpenAssignedProgram={(athlete, assignedProgram, workoutId) =>
              void openAthleteProgram(athlete, assignedProgram, workoutId)
            }
            onOpenAgendaEntry={(athlete, entry) =>
              void openCoachAgendaEntry(athlete, entry)
            }
            onAssignAthlete={(athlete) =>
              void openProgramRunWizard({
                mode: "coach",
                athleteIds: [athlete.id],
              })
            }
            onScheduleAthlete={(athlete, assignedProgram) => {
              if (
                assignedProgram &&
                "programVersionId" in assignedProgram &&
                !assignedProgram.legacy
              ) {
                setProgramRunScheduleTarget(assignedProgram);
                setModal("run-schedule");
                return;
              }
              if (!assignedProgram) {
                void openProgramRunWizard({
                  mode: "coach",
                  athleteIds: [athlete.id],
                });
                return;
              }
              notify(
                "This older assignment is read-only. Use its migrated program run instead.",
              );
            }}
            onUnassignAthlete={(_athlete, assignedProgram) => {
              if (
                "programVersionId" in assignedProgram &&
                !assignedProgram.legacy
              ) {
                setContentDeleteTarget({
                  kind: "program-run",
                  id: assignedProgram.id,
                  title: assignedProgram.title,
                  contentType: assignedProgram.contentType,
                });
                setModal("delete-content");
                return;
              }
              unassignProgram(
                assignedProgram.assignmentId,
                assignedProgram.title,
              );
            }}
            onRepeatAthlete={(athlete, assignedProgram) => {
              if (
                "programVersionId" in assignedProgram &&
                !assignedProgram.legacy
              ) {
                void openProgramRunWizard({
                  mode: "coach",
                  programId: assignedProgram.programId,
                  athleteIds: [athlete.id],
                  repeatRun: assignedProgram,
                });
              }
            }}
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
          onSave={(name, discipline, category, mode, fields, cue) =>
            exerciseEditing
              ? updatePersonalExercise(
                  exerciseEditing,
                  name,
                  discipline,
                  category,
                  mode,
                  fields,
                  cue,
                )
              : addPersonalExercise(
                  name,
                  discipline,
                  category,
                  mode,
                  fields,
                  cue,
                )
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
      {modal === "invite" && (
        <InviteModal
          onClose={() => setModal(null)}
          onResolve={resolveCoachInvite}
          onInvite={createCoachInvite}
        />
      )}
      {modal === "assign-program" && (
        <Suspense
          fallback={
            <div className="feature-load-status" role="status">
              <LoaderCircle size={16} className="spin" />
              Opening training setup…
            </div>
          }
        >
          <ProgramRunWizard
            mode={assignmentSeed.mode}
            viewerId={viewer.id}
            viewerName={workspace.profile.displayName}
            programs={runWizardPrograms}
            athletes={workspace.coachedAthletes}
            hasMorePrograms={Boolean(programCursor)}
            loadingMorePrograms={programsLoadingMore}
            onLoadMorePrograms={() => void loadMorePrograms()}
            hasMoreAthletes={Boolean(coachAthleteCursor)}
            loadingMoreAthletes={coachAthletesLoadingMore}
            onLoadMoreAthletes={() => void loadMoreCoachAthletes()}
            initialProgramId={
              assignmentSeed.repeatRun?.programId ?? assignmentSeed.programId
            }
            initialAthleteIds={assignmentSeed.athleteIds}
            onLoadProgram={loadProgramForCurrentRunWizard}
            onClose={() => {
              setAssignmentSeed({ mode: "coach" });
              setAssignmentProgramOverride(null);
              setModal(null);
            }}
            onCreate={createProgramRun}
          />
        </Suspense>
      )}
      {modal === "run-schedule" && programRunScheduleTarget && (
        <Suspense
          fallback={
            <div className="feature-load-status" role="status">
              <LoaderCircle size={16} className="spin" />
              Opening schedule…
            </div>
          }
        >
          <ProgramRunScheduleWizard
            run={programRunScheduleTarget}
            athleteName={
              programRunScheduleTarget.athleteId === viewer.id
                ? undefined
                : workspace.coachedAthletes.find(
                    (athlete) => athlete.id === programRunScheduleTarget.athleteId,
                  )?.name
            }
            onLoad={loadProgramRunDetail}
            onClose={() => {
              setProgramRunScheduleTarget(null);
              setModal(null);
            }}
            onSave={async (workoutDates, idempotencyKey) => {
              let refreshFailed = false;
              if (repository) {
                await repository.scheduleProgramRunWorkouts(
                  programRunScheduleTarget.id,
                  workoutDates,
                  idempotencyKey,
                );
              }
              const dated = workoutDates.filter((entry) => entry.plannedDate).length;
              const targetAthleteId = programRunScheduleTarget.athleteId;
              setProgramRunScheduleTarget(null);
              setModal(null);
              if (repository) {
                try {
                  await Promise.all([
                    refreshProgramWorkspace(),
                    targetAthleteId === viewer.id
                      ? loadUpcomingWorkouts(true)
                      : Promise.resolve(),
                  ]);
                  if (targetAthleteId !== viewer.id) {
                    const refreshed = await refreshCoachWorkspace();
                    refreshFailed = !refreshed;
                  }
                } catch {
                  refreshFailed = true;
                }
              }
              const successMessage =
                dated
                  ? `${dated} ${dated === 1 ? "workout" : "workouts"} added to the calendar`
                  : "Program dates updated";
              notify(
                refreshFailed
                  ? `${successMessage} · saved successfully; refresh to update this screen`
                  : successMessage,
              );
            }}
          />
        </Suspense>
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
          frequentCandidates={frequentScheduleCandidates}
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
  coachingRequestCount,
}: {
  activeView: ViewName;
  onNavigate: (view: ViewName) => void;
  viewer: AppViewer;
  profile: WorkspaceData["profile"];
  onAccount: () => void;
  onSignOut: () => void;
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
                {viewer.isDemo ? "Local demo workspace" : viewer.email}
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

function TodayView({
  program,
  viewerId,
  workout,
  weightUnit,
  exerciseCategoryForItem,
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
  editable,
  editingBlockedReason,
  onRetryEditing,
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
}: {
  program?: Program;
  viewerId: string;
  workout: PlannedWorkout;
  weightUnit: OwnProfile["weightUnit"];
  exerciseCategoryForItem: (item: WorkoutItem) => string;
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
  editable: boolean;
  editingBlockedReason: string | null;
  onRetryEditing: () => void;
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
  const orderedWorkouts = workoutBelongsToProgram
    ? program?.weeks.flatMap((week) => week.workouts) ?? []
    : [];
  const workoutIndex = orderedWorkouts.findIndex(
    (item) => item.id === workout.id,
  );
  const isQuickWorkout = program?.contentType === "quick_workout";
  const planDescription = isQuickWorkout
    ? undefined
    : workoutBelongsToProgram && program
      ? program.title
      : "Scheduled from an earlier program version";
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
      {onBack && (
        <DetailNavigation
          backLabel={backLabel}
          title={workout.title}
          onBack={onBack}
        />
      )}
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
          <button className="button secondary workout-back-action desktop-detail-action" onClick={onBack}>
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
            className="icon-button"
            onClick={onRemoveFromCalendar}
            aria-label="Remove workout from calendar"
            title="Remove from calendar"
          >
            <CalendarMinus size={15} />
          </button>
        )}
        {workoutStarted && onSetPlanned && onSkip && (
          <>
            <button
              className="button secondary workout-back-action"
              disabled={statusAction !== null || !editable}
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
              disabled={statusAction !== null || !editable}
              onClick={onSkip}
            >
              {statusAction === "skipped" ? (
                <>
                  <LoaderCircle className="button-spinner" size={15} />
                  Skipping…
                </>
              ) : (
                "Skip"
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
              "Skip"
            )}
          </button>
        )}
        </div>
      </PageHeader>
      {workoutStarted && !editable && (
        <div className="feature-load-status" role="status">
          <span>{editingBlockedReason ?? "Preparing your saved workout…"}</span>
          {editingBlockedReason && <button type="button" className="text-button" onClick={onRetryEditing}>Try again</button>}
        </div>
      )}
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
        <fieldset className="workout-card" aria-label="Workout log" disabled={workoutStarted && !editable}>
          <div className="workout-heading">
            <div>
              {!isQuickWorkout && (
                <p className="eyebrow">
                  {workoutIndex >= 0
                    ? `Session ${workoutIndex + 1} of ${orderedWorkouts.length}`
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
          <section className="workout-section workout-exercise-sequence">
            {workout.sections.flatMap((section) => section.items).map((item) => (
              <div className="workout-sequence-item" key={item.id}>
                <WorkoutLogItem
                  item={item}
                  category={exerciseCategoryForItem(item)}
                  active={workoutStarted}
                  weightUnit={weightUnit}
                  setLogs={setLogs[item.id] ?? emptySetLogs}
                  resultLog={resultLogs[item.id] ?? emptyResultLog}
                  onUpdateSet={onUpdateSet}
                  onAddSet={onAddSet}
                  onRemoveSet={onRemoveSet}
                  onUpdateResult={onUpdateResult}
                />
              </div>
            ))}
          </section>
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
        </fieldset>
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
  category,
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
  category?: string;
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
        <ExerciseCategoryMark category={category ?? item.category} compact />
        <div>
          <span className="exercise-title-with-video">
            <strong>{item.title}</strong>
            <ExerciseVideoLink url={item.videoUrl} exerciseName={item.title} />
          </span>
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
                <ExerciseCategoryMark category={category ?? item.category} compact />
                <strong>{item.title}</strong>
                <ExerciseVideoLink url={item.videoUrl} exerciseName={item.title} />
              </div>
              {prescriptionSummary}
            </>
          ) : (
            <div className="exercise-name-with-icon">
              <ExerciseCategoryMark category={category ?? item.category} compact />
              <strong>{item.title}</strong>
              <ExerciseVideoLink url={item.videoUrl} exerciseName={item.title} />
            </div>
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
  activeRun,
  viewerId,
  canEdit,
  canDuplicate,
  canDelete,
  action,
  onOpen,
  onEdit,
  onDuplicate,
  onDelete,
  deleteLabel = "Delete",
  onSchedule,
  onOpenActiveRun,
}: {
  program: Program;
  activeRun?: ProgramRunSummary;
  viewerId: string;
  canEdit: boolean;
  canDuplicate: boolean;
  canDelete: boolean;
  action: Exclude<ProgramAction, null>["kind"] | null;
  onOpen: () => void;
  onEdit: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  deleteLabel?: "Delete" | "Unassign";
  onSchedule?: () => void;
  onOpenActiveRun?: () => void;
}) {
  const isQuickWorkout = program.contentType === "quick_workout";
  const objectLabel = isQuickWorkout ? "Workout" : "Program";
  const workoutCount = programWorkoutCount(program);
  const estimatedMinutes = program.weeks[0]?.workouts[0]?.durationMinutes;
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
      </button>
      <div className="program-card-footer">
        <div className="program-card-status-row">
          <span className="program-card-meta">
            {isQuickWorkout ? (
              estimatedMinutes ? <span>~{estimatedMinutes} min</span> : null
            ) : (
              <span>{formatWorkoutCount(workoutCount)}</span>
            )}
          </span>
          {activeRun ? (
            <button
              type="button"
              className="program-card-active-run"
              onClick={onOpenActiveRun}
              aria-label={`Open active ${program.title} training`}
            >
              {isQuickWorkout ? <Activity size={13} /> : <CalendarPlus size={13} />}
              {isQuickWorkout
                ? "In use"
                : `In use · ${activeRun.completedWorkouts}/${activeRun.totalWorkouts} completed`}
              <ChevronRight size={13} />
            </button>
          ) : program.versionStatus === "draft" ? (
            <StatusBadge status="editable" label="Editable template" />
          ) : program.sourceType === "coach" ? (
            <StatusBadge status="planned" label="Assigned to you" />
          ) : (
            <span className="program-card-ready">Ready to use</span>
          )}
        </div>
        <div className="program-card-actions">
          {canEdit && (
            <button
              className="icon-button program-card-action-template"
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
          {canDuplicate && onDuplicate && (
            <button
              className="icon-button program-card-action-template"
              disabled={Boolean(action)}
              onClick={onDuplicate}
              aria-label={`Duplicate ${program.title} ${objectLabel.toLowerCase()}`}
              title={`Duplicate ${objectLabel.toLowerCase()}`}
            >
              {action === "duplicate" ? (
                <LoaderCircle className="button-spinner" size={15} />
              ) : (
                <Copy size={15} />
              )}
            </button>
          )}
          {onSchedule && (
            <button
              className="icon-button program-card-action-schedule"
              disabled={Boolean(action)}
              onClick={onSchedule}
              aria-label={`${program.sourceType === "coach" ? "Schedule" : "Start"} ${program.title}`}
              title={program.sourceType === "coach" ? "Schedule workout" : `Start ${objectLabel.toLowerCase()}`}
            >
              {program.sourceType === "coach" || !isQuickWorkout ? (
                <CalendarPlus size={15} />
              ) : (
                <Activity size={15} />
              )}
            </button>
          )}
          {canDelete && onDelete && (
            <button
              className="icon-button danger program-card-action-delete"
              disabled={Boolean(action)}
              onClick={onDelete}
              aria-label={`${deleteLabel} ${program.title}`}
              title={deleteLabel === "Unassign" ? "Unassign program" : `Delete ${objectLabel.toLowerCase()}`}
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
  programRuns,
  hasMoreProgramRuns,
  programRunsLoadingMore,
  programRunsLoadError,
  viewerId,
  source,
  hasCoach,
  hasMore,
  loadingMore,
  loadError,
  action,
  capabilitiesForProgram,
  onOpen,
  onEdit,
  onDuplicate,
  onDelete,
  onUnassign,
  onSource,
  onCreate,
  onCreateWorkout,
  onSchedule,
  onOpenRun,
  onScheduleRun,
  onEndRun,
  onRepeatRun,
  onLoadMore,
  onLoadMoreProgramRuns,
}: {
  programs: Program[];
  programRuns: ProgramRunSummary[];
  hasMoreProgramRuns: boolean;
  programRunsLoadingMore: boolean;
  programRunsLoadError: string;
  viewerId: string;
  source: ProgramSourceTab;
  hasCoach: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  loadError: string;
  action: ProgramAction;
  capabilitiesForProgram: (program: Program) => TrainingContentCapabilities;
  onOpen: (program: Program) => void;
  onEdit: (program: Program) => void;
  onDuplicate: (program: Program) => void;
  onDelete: (program: Program) => void;
  onUnassign: (program: Program) => void;
  onSource: (source: ProgramSourceTab) => void;
  onCreate: () => void;
  onCreateWorkout: () => void;
  onSchedule: (program: Program) => void;
  onOpenRun: (run: ProgramRunSummary) => void;
  onScheduleRun: (run: ProgramRunSummary) => void;
  onEndRun: (run: ProgramRunSummary) => void;
  onRepeatRun: (run: ProgramRunSummary) => void;
  onLoadMore: () => void;
  onLoadMoreProgramRuns: () => void;
}) {
  const [contentQuery, setContentQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedTypes, setSelectedTypes] = useState<
    Array<"program" | "quick_workout">
  >([]);
  const [page, setPage] = useState(0);
  const pageSize = 20;
  const own = programs.filter((program) => program.sourceType === "self");
  const content = source === "own" ? own : [];
  const normalizedQuery = contentQuery.trim().toLowerCase();
  const coachRuns = programRuns.filter(
    (run) => run.athleteId === viewerId && run.createdById !== viewerId,
  );
  const activeSelfRuns = programRuns.filter(
    (run) =>
      run.athleteId === viewerId &&
      run.createdById === viewerId &&
      (run.status === "not_started" || run.status === "in_progress"),
  );
  const activeRunByProgramId = new Map<string, ProgramRunSummary>();
  for (const run of activeSelfRuns) {
    if (!activeRunByProgramId.has(run.programId)) {
      activeRunByProgramId.set(run.programId, run);
    }
  }
  const filteredCoachRuns = coachRuns.filter((run) => {
    const contentType = run.contentType ?? "program";
    return (
      run.title.toLowerCase().includes(normalizedQuery) &&
      (!selectedTypes.length || selectedTypes.includes(contentType))
    );
  });
  const filteredContent = content.filter((item) => {
    const contentType = item.contentType ?? "program";
    return (
      `${item.title} ${item.description}`
        .toLowerCase()
        .includes(normalizedQuery) &&
      (!selectedTypes.length || selectedTypes.includes(contentType))
    );
  });
  const activeFilterCount = selectedTypes.length;
  function toggleProgramType(value: "program" | "quick_workout") {
    setPage(0);
    setSelectedTypes((current) =>
      current.includes(value)
        ? current.filter((candidate) => candidate !== value)
        : [...current, value],
    );
  }
  function resetProgramFilters() {
    setPage(0);
    setSelectedTypes([]);
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
  const renderRow = (item: Program) => {
    const activeRun = activeRunByProgramId.get(item.id);
    return (
      <ProgramRow
      key={item.id}
      program={item}
      activeRun={activeRun}
      viewerId={viewerId}
      canEdit={capabilitiesForProgram(item).edit}
      canDuplicate={capabilitiesForProgram(item).copyToOwn}
      canDelete={
        capabilitiesForProgram(item).deleteOwn ||
        (item.sourceType === "coach" && Boolean(item.assignmentId))
      }
      action={action?.id === item.id ? action.kind : null}
      onOpen={() => onOpen(item)}
      onEdit={() => onEdit(item)}
      onDuplicate={capabilitiesForProgram(item).copyToOwn ? () => onDuplicate(item) : undefined}
      onDelete={
        capabilitiesForProgram(item).deleteOwn
          ? () => onDelete(item)
          : item.sourceType === "coach" && item.assignmentId
            ? () => onUnassign(item)
            : undefined
      }
      deleteLabel={item.sourceType === "coach" ? "Unassign" : "Delete"}
      onSchedule={capabilitiesForProgram(item).schedule ? () => onSchedule(item) : undefined}
      onOpenActiveRun={activeRun ? () => onOpenRun(activeRun) : undefined}
    />
    );
  };
  return (
    <>
      <PageHeader
        eyebrow="Your training"
        title="Programs"
        description="Build reusable training. Changes are saved for future uses without altering active or completed plans."
      >
        <details className="program-create-menu">
          <summary className="button primary small"><Plus size={15} />New</summary>
          <div>
            <button type="button" onClick={onCreate}><Layers3 size={15} /><span><strong>Program</strong><small>Multiple ordered workouts</small></span></button>
            <button type="button" onClick={onCreateWorkout}><Activity size={15} /><span><strong>Workout</strong><small>One reusable session</small></span></button>
          </div>
        </details>
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
            ...(hasCoach ? [{ value: "coach" as const, label: "From coach", icon: Users }] : []),
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
                  onClick={() => toggleProgramType(type)}
                >
                  {type === "program" ? "Programs" : "Single workouts"} <X size={12} />
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
                      onClick={() => toggleProgramType(type)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="program-compact-list" id="program-source-panel" role="tabpanel">
          {source === "coach" ? (
            coachRuns.length > 0 && !filteredCoachRuns.length ? (
              <div className="empty-state compact">
                <Search size={24} />
                <h3>No matching training</h3>
                <p>Adjust the search or filters to see assigned programs and workouts.</p>
                <button className="button secondary small" onClick={resetProgramFilters}>
                  Clear filters
                </button>
                {programRunsLoadError ? (
                  <div className="feature-load-status error" role="alert">
                    <span>{programRunsLoadError}</span>
                    <button className="text-button" onClick={onLoadMoreProgramRuns}>
                      Try again
                    </button>
                  </div>
                ) : hasMoreProgramRuns ? (
                  <button
                    className="button secondary small library-load-more"
                    disabled={programRunsLoadingMore}
                    onClick={onLoadMoreProgramRuns}
                  >
                    {programRunsLoadingMore && (
                      <LoaderCircle className="button-spinner" size={14} />
                    )}
                    {programRunsLoadingMore ? "Loading…" : "Search older training"}
                  </button>
                ) : null}
              </div>
            ) : (
              <Suspense fallback={null}>
                <CoachProgramRuns
                  viewerId={viewerId}
                  runs={filteredCoachRuns}
                  hasMore={hasMoreProgramRuns}
                  loadingMore={programRunsLoadingMore}
                  loadError={programRunsLoadError}
                  onLoadMore={onLoadMoreProgramRuns}
                  onOpen={onOpenRun}
                  onSchedule={onScheduleRun}
                  onEnd={onEndRun}
                  onRepeat={onRepeatRun}
                />
              </Suspense>
            )
          ) : filteredContent.length ? (
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
              <p>{hasMore ? "No matches in the programs loaded so far. Search older programs or adjust your filters." : "Adjust the search or filters to see more programs and workouts."}</p>
              <button className="button secondary small" onClick={resetProgramFilters}>
                Clear filters
              </button>
              {loadError && <InlineError>{loadError}</InlineError>}
              {hasMore && (
                <AsyncButton className="button secondary small library-load-more" loading={loadingMore} loadingLabel="Loading…" onClick={onLoadMore}>
                  Search older programs
                </AsyncButton>
              )}
            </div>
          ) : (
            <div className="empty-state compact">
              <Dumbbell size={24} />
              <h3>No training content yet</h3>
              <p>Create a program or a one-off workout when you are ready to plan training.</p>
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
  exerciseCategoryForName,
  onBack,
}: {
  state: CompletedWorkoutViewState;
  program?: Program;
  viewerId: string;
  weightUnit: OwnProfile["weightUnit"];
  exerciseCategoryForName: (name: string) => string;
  onBack: () => void;
}) {
  const dateLabel = new Date(`${state.session.date}T12:00:00`).toLocaleDateString(
    "en",
    { weekday: "long", month: "long", day: "numeric" },
  );
  const returnLabel =
    state.returnView === "today"
      ? "Next workouts"
      : state.returnView === "calendar"
      ? "Calendar"
      : state.returnView === "program"
        ? "Program"
        : "Coaching";
  return (
    <>
      <DetailNavigation
        backLabel={returnLabel}
        title="Workout log"
        onBack={onBack}
      />
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
        <button className="button secondary desktop-detail-action" onClick={onBack}>
          <ArrowLeft size={15} />
          {returnLabel}
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
                    <ExerciseCategoryMark
                      category={item.category ?? exerciseCategoryForName(item.title)}
                      compact
                    />
                    <div className="calendar-result-copy">
                      <span className="exercise-title-with-video">
                        <strong>{item.title}</strong>
                        <ExerciseVideoLink
                          url={item.videoUrl}
                          exerciseName={item.title}
                        />
                      </span>
                      {item.cue && <small>{item.cue}</small>}
                    </div>
                    <span>{modeLabel(item.mode, item.fields)}</span>
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

function FormatTrackingFields({
  format,
  value,
  onChange,
}: {
  format: LoggingFormat;
  value: TrackingField[];
  onChange: (fields: TrackingField[]) => void;
}) {
  const required = requiredTrackingFieldsForLoggingFormat(format);
  const optional = optionalTrackingFieldsForLoggingFormat(format);
  const available = [...required, ...optional];
  if (!available.length) {
    return (
      <div className="format-tracking-empty full">
        No values to enter—show instructions only.
      </div>
    );
  }
  return (
    <fieldset className="format-tracking-field full">
      <legend>
        Track during workout <em>choose only what matters</em>
      </legend>
      <div
        className={cn(
          "format-tracking-options",
          `tracking-${available.length}`,
        )}
      >
        {available.map((field) => {
          const isRequired = required.includes(field);
          const checked = isRequired || value.includes(field);
          return (
            <label
              className={cn(
                "format-tracking-option",
                checked && "selected",
                isRequired && "required",
              )}
              key={field}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={isRequired}
                onChange={(event) =>
                  onChange(
                    trackingFieldsForLoggingFormat(
                      format,
                      event.target.checked
                        ? [...value, field]
                        : value.filter((candidate) => candidate !== field),
                    ),
                  )
                }
              />
              <span>{trackingFieldLabel(field)}</span>
              {isRequired && <small>Required</small>}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function CoachingView({
  mode,
  coachConnections,
  pendingInvites,
  outgoingInvites,
  athletes,
  hasMoreAthletes,
  loadingMoreAthletes,
  athletesLoadError,
  selectedAthlete,
  loadingAthleteId,
  loadingHistoryAthleteId,
  loadingProgramRunsAthleteId,
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
  onLoadMoreHistory,
  onLoadMoreProgramRuns,
  onOpenAssignedProgram,
  onOpenAgendaEntry,
  onAssignAthlete,
  onScheduleAthlete,
  onUnassignAthlete,
  onRepeatAthlete,
}: {
  mode: "athlete" | "coach";
  coachConnections: CoachConnection[];
  pendingInvites: PendingCoachInvite[];
  outgoingInvites: OutgoingCoachInvite[];
  athletes: AthleteSummary[];
  hasMoreAthletes: boolean;
  loadingMoreAthletes: boolean;
  athletesLoadError: string;
  selectedAthlete: AthleteSummary | null;
  loadingAthleteId: string | null;
  loadingHistoryAthleteId: string | null;
  loadingProgramRunsAthleteId: string | null;
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
  onLoadMoreHistory: (athlete: AthleteSummary) => void;
  onLoadMoreProgramRuns: (athlete: AthleteSummary) => void;
  onOpenAssignedProgram: (
    athlete: AthleteSummary,
    program: CoachWorkspaceProgram,
    workoutId?: string,
  ) => void;
  onOpenAgendaEntry: (
    athlete: AthleteSummary,
    entry: CoachAgendaEntry,
  ) => void;
  onAssignAthlete: (athlete: AthleteSummary) => void;
  onScheduleAthlete: (
    athlete: AthleteSummary,
    program?: CoachWorkspaceProgram,
  ) => void;
  onUnassignAthlete: (
    athlete: AthleteSummary,
    program: CoachWorkspaceProgram,
  ) => void;
  onRepeatAthlete: (
    athlete: AthleteSummary,
    program: CoachWorkspaceProgram,
  ) => void;
}) {
  const hasAthleteWorkspace = athletes.length > 0 || pendingInvites.length > 0;
  if (mode === "coach") {
    return (
      <div className="coach-mode-view">
        <PageHeader
          eyebrow="Shared progress"
          title="Coaching"
          description="Assign training, review progress, and see the results of the athletes you coach."
        >
          <SegmentedTabs
            compact
            label="Coaching workspace"
            panelId="coaching-workspace-panel"
            value={mode}
            onChange={onMode}
            tabs={[
              { value: "athlete", label: "My coaches" },
              {
                value: "coach",
                label: refreshing ? (
                  <><LoaderCircle className="button-spinner" size={14} /> Refreshing…</>
                ) : (
                  "My athletes"
                ),
                badge: pendingInvites.length,
              },
            ]}
          />
        </PageHeader>
        <Suspense
          fallback={
            <div
              className="feature-load-status"
              id="coaching-workspace-panel"
              role="tabpanel"
              aria-labelledby="coaching-workspace-panel-coach-tab"
              aria-busy="true"
            >
              <LoaderCircle size={16} className="spin" />
              <span role="status">Opening athlete workspace…</span>
            </div>
          }
        >
          <CoachWorkspace
            panelId="coaching-workspace-panel"
            athletes={athletes}
            pendingInvites={pendingInvites}
            selectedAthlete={selectedAthlete}
            loadingAthleteId={loadingAthleteId}
            loadingHistoryAthleteId={loadingHistoryAthleteId}
            loadingProgramRunsAthleteId={loadingProgramRunsAthleteId}
            openingProgramId={openingProgramId}
            refreshing={refreshing}
            hasMoreAthletes={hasMoreAthletes}
            loadingMoreAthletes={loadingMoreAthletes}
            athletesLoadError={athletesLoadError}
            respondingInvite={respondingInvite}
            onRefresh={onRefresh}
            onRespondInvite={onRespondInvite}
            onSelectAthlete={onSelectAthlete}
            onLoadMoreAthletes={onLoadMoreAthletes}
            onLoadMoreHistory={onLoadMoreHistory}
            onLoadMoreProgramRuns={onLoadMoreProgramRuns}
            onOpenAssignedProgram={onOpenAssignedProgram}
            onOpenAgendaEntry={onOpenAgendaEntry}
            onAssignAthlete={onAssignAthlete}
            onScheduleAthlete={onScheduleAthlete}
            onUnassignAthlete={onUnassignAthlete}
            onRepeatAthlete={onRepeatAthlete}
          />
        </Suspense>
      </div>
    );
  }
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
      ) : null}
    </>
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
    fields: TrackingField[],
    cue: string,
  ) => void;
}) {
  const [name, setName] = useState(exercise?.name ?? "");
  const [discipline, setDiscipline] = useState<ExerciseDiscipline>(
    exercise ? inferredExerciseDiscipline(exercise) : "gym",
  );
  const [category, setCategory] = useState(exercise?.category ?? "General");
  const initialFormat = exercise
    ? loggingFormatFor(exercise.defaultMode, exercise.defaultFields)
    : "repetitions";
  const [format, setFormat] = useState<LoggingFormat>(initialFormat);
  const [trackingFields, setTrackingFields] = useState<TrackingField[]>(() =>
    exercise
      ? trackingFieldsForLoggingFormat(initialFormat, exercise.defaultFields)
      : trackingFieldsForLoggingFormat(initialFormat),
  );
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
          <span>Category <em>icon and search</em></span>
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
          <span>Format</span>
          <select
            value={format}
            onChange={(event) => {
              const nextFormat = event.target.value as LoggingFormat;
              setFormat(nextFormat);
              setTrackingFields(trackingFieldsForLoggingFormat(nextFormat));
            }}
          >
            <option value="repetitions">Repetitions</option>
            <option value="duration">Duration</option>
            <option value="distance">Distance</option>
            <option value="intervals">Intervals</option>
            <option value="instructions">Instructions only</option>
          </select>
        </label>
        <FormatTrackingFields
          format={format}
          value={trackingFields}
          onChange={setTrackingFields}
        />
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
            onSave(
              name.trim(),
              discipline,
              category,
              entryModeForLoggingFormat(format),
              trackingFieldsForLoggingFormat(format, trackingFields),
              cue.trim(),
            )
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
            <dt>Format</dt>
            <dd>{modeLabel(exercise.defaultMode, exercise.defaultFields)}</dd>
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
        <ExerciseVideoLink
          url={exercise.videoUrl}
          exerciseName={exercise.name}
          size={16}
        />
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
    if (target.kind === "workout") {
      return {
        title: `Delete ${target.title}?`,
        description: "This workout will be removed from the program.",
        label: "Delete workout",
      };
    }
    if (target.kind === "assignment") {
      return {
        title: `Unassign ${target.title}?`,
        description: "It will disappear from Programs and any unstarted calendar entries from this assignment will be removed. Completed workout history will stay.",
        label: "Unassign program",
      };
    }
    if (target.kind === "program-run") {
      const quickWorkout = target.contentType === "quick_workout";
      return {
        title: `End ${target.title}?`,
        description:
          `Future ${quickWorkout ? "calendar entries" : "workouts"} will leave the calendar. Completed results stay in History, and this ${quickWorkout ? "workout" : "program"} can be repeated later.`,
        label: quickWorkout ? "End workout" : "End program",
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
      description: `The reusable ${quickWorkout ? "workout" : "program"} will disappear from Mine. Training plans already created from it—including calendar dates and completed results—will stay unchanged.`,
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
              {target.kind === "assignment"
                ? "Unassigning…"
                : target.kind === "program-run"
                  ? "Ending…"
                  : "Deleting…"}
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
  const initialFormat = loggingFormatFor(item.mode, item.fields);
  const [format, setFormat] = useState<LoggingFormat>(initialFormat);
  const [trackingFields, setTrackingFields] = useState<TrackingField[]>(() =>
    trackingFieldsForLoggingFormat(initialFormat, workoutLogFields(item)),
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
  const mode = entryModeForLoggingFormat(format);
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
  function resetForFormat(nextFormat: LoggingFormat) {
    const nextMode = entryModeForLoggingFormat(nextFormat);
    setFormat(nextFormat);
    setTrackingFields(trackingFieldsForLoggingFormat(nextFormat));
    setEntries(prescriptionDraftEntries(nextMode, item.prescription, weightUnit));
    setPerEntry({ reps: false, load: false, rpe: false, work: false, rest: false });
  }
  async function save() {
    setSaving(true);
    setError("");
    const nextFields = trackingFieldsForLoggingFormat(format, trackingFields);
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
            value={format}
            onChange={(event) =>
              resetForFormat(event.target.value as LoggingFormat)
            }
          >
            <option value="repetitions">Repetitions</option>
            <option value="duration">Duration</option>
            <option value="distance">Distance</option>
            <option value="intervals">Intervals</option>
            <option value="instructions">Instructions only</option>
          </select>
        </label>
        <FormatTrackingFields
          format={format}
          value={trackingFields}
          onChange={setTrackingFields}
        />
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
              Create and assign future program content
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

/** @deprecated ProgramRunWizard is the live assignment flow. */
export function AssignProgramModal({
  programs,
  athletes,
  hasMoreAthletes,
  loadingMoreAthletes,
  athletesLoadError,
  initialProgramId,
  initialAthleteIds = [],
  onClose,
  onAssign,
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
  const savingRef = useRef(false);
  const [error, setError] = useState("");
  const selectedProgram = programs.find(
    (candidate) => candidate.id === programId,
  );
  const selectedAthletes = athletes.filter((athlete) =>
    athleteIds.has(athlete.id),
  );

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
      await onAssign(programId, [...athleteIds]);
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
      title="Assign training"
      description="Give an athlete access to one of your programs or workouts. Scheduling is a separate step."
      onClose={onClose}
      dismissible={!saving}
      wide
    >
      {!programs.length ? (
        <div className="empty-state modal-empty compact">
          <Dumbbell size={26} />
          <h3>No Own programs</h3>
          <p>Create a program or workout before assigning it to an athlete.</p>
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
                  <strong>Program or workout</strong>
                  <small>Choose training from your Programs list</small>
                </div>
              </div>
              {lockedProgram && selectedProgram ? (
                <div className="assignment-program-summary">
                  <Dumbbell size={17} />
                  <div>
                    <strong>{selectedProgram.title}</strong>
                    <small>
                      {programWorkoutCount(selectedProgram)}{" "}
                      {programWorkoutCount(selectedProgram) === 1
                        ? "workout"
                        : "workouts"}
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
                Assigning training to{" "}
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
              disabled={!programId || !athleteIds.size || saving}
              onClick={assign}
            >
              {saving ? (
                <>
                  <LoaderCircle className="button-spinner" size={15} />
                  Assigning…
                </>
              ) : (
                <>
                  <UserPlus size={15} />
                  Assign to{" "}
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
          : "Add workouts in training order. Choose dates when you start or assign the program."
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
  frequentCandidates,
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
  frequentCandidates: FrequentSchedulableWorkoutCandidate[];
  schedules: ScheduledWorkout[];
  editingId: string | null;
  initialDate: string | null;
  loading: boolean;
  error: string;
  hasMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  onClose: () => void;
  onSave: (
    candidate: ScheduleCandidate,
    date: string | null,
    idempotencyKey: string,
  ) => Promise<void>;
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

    const toScheduleCandidate = (
      candidate:
        | SchedulableWorkoutCandidate
        | FrequentSchedulableWorkoutCandidate,
    ): ScheduleCandidate | null => {
      const latest = candidate.latestOccurrence;
      if (
        !candidate.isQuickWorkout &&
        latest &&
        (latest.status === "in_progress" ||
          latest.status === "completed" ||
          (latest.status === "planned" && Boolean(latest.plannedDate)))
      ) {
        return null;
      }
      const reusableOccurrence =
        latest?.status === "planned" && !latest.plannedDate
          ? latest
          : undefined;
      return {
        id: `${candidate.assignmentId ?? `program:${candidate.programId}`}:${candidate.programVersionId}:${candidate.workoutId}`,
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
        ...("usageCount" in candidate && candidate.usageCount !== undefined
          ? {
              usageCount: candidate.usageCount,
              lastUsedAt: candidate.lastUsedAt,
            }
          : {}),
      };
    };

    const merged = [...frequentCandidates, ...candidates];
    const seen = new Set<string>();
    return merged.flatMap((candidate): ScheduleCandidate[] => {
      const mapped = toScheduleCandidate(candidate);
      if (!mapped || seen.has(mapped.id)) return [];
      seen.add(mapped.id);
      return [mapped];
    });
  }, [candidates, editingId, frequentCandidates, schedules]);

  const initial =
    availableCandidates.find((candidate) => candidate.scheduleId === editingId) ??
    availableCandidates[0];
  const [candidateId, setCandidateId] = useState(initial?.id ?? "");
  const [workoutQuery, setWorkoutQuery] = useState("");
  const [date, setDate] = useState(
    initial?.plannedDate ?? initialDate ?? localDateOnly(),
  );
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const idempotencyRef = useRef({ fingerprint: "", key: "" });
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
  const normalizedWorkoutQuery = workoutQuery.trim().toLocaleLowerCase();
  const frequentChoices = availableCandidates.filter(
    (candidate) => (candidate.usageCount ?? 0) > 0,
  );
  const frequentChoiceIds = new Set(
    frequentChoices.map((candidate) => candidate.id),
  );
  const otherChoices = availableCandidates.filter(
    (candidate) => !frequentChoiceIds.has(candidate.id),
  );
  const matchingChoices = availableCandidates.filter((candidate) =>
    `${candidate.programTitle} ${candidate.workoutTitle}`
      .toLocaleLowerCase()
      .includes(normalizedWorkoutQuery),
  );

  function selectCandidate(candidate: ScheduleCandidate) {
    setCandidateId(candidate.id);
    setDate((currentDate) => candidate.plannedDate ?? currentDate);
  }

  function workoutChoice(candidate: ScheduleCandidate) {
    const active = candidate.id === effectiveCandidateId;
    return (
      <button
        type="button"
        className={cn("schedule-workout-choice", active && "active")}
        aria-pressed={active}
        disabled={saving}
        key={candidate.id}
        onClick={() => selectCandidate(candidate)}
      >
        <span className="schedule-workout-choice-copy">
          <strong>{candidate.workoutTitle}</strong>
          {!candidate.quickWorkout && <small>{candidate.programTitle}</small>}
        </span>
        <span className="schedule-workout-choice-meta">
          <small>{formatDuration(candidate.estimatedMinutes)}</small>
          {candidate.usageCount !== undefined && (
            <small className="schedule-workout-usage">
              Used {candidate.usageCount} {candidate.usageCount === 1 ? "time" : "times"}
            </small>
          )}
        </span>
        <span className="schedule-workout-choice-check" aria-hidden="true">
          {active && <Check size={15} />}
        </span>
      </button>
    );
  }

  async function save(
    nextDate: string | null,
    nextAction: "add" | "reschedule" | "unschedule",
  ) {
    if (!selected || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSavingAction(nextAction);
    setError("");
    const fingerprint = `${selected.id}:${nextDate ?? ""}:${nextAction}`;
    if (idempotencyRef.current.fingerprint !== fingerprint) {
      idempotencyRef.current = { fingerprint, key: crypto.randomUUID() };
    }
    try {
      await onSave(selected, nextDate, idempotencyRef.current.key);
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
            {editingId ? (
              <div className="form-field full">
                <span>Workout</span>
                <div className="schedule-workout-current">
                  <strong>{selected?.workoutTitle}</strong>
                  {!selected?.quickWorkout && <small>{selected?.programTitle}</small>}
                </div>
              </div>
            ) : (
              <div className="form-field full schedule-workout-picker">
                <span>Workout</span>
                <label className="search-field schedule-workout-search">
                  <Search size={16} />
                  <input
                    aria-label="Search workouts"
                    placeholder="Search workouts"
                    value={workoutQuery}
                    disabled={saving}
                    onChange={(event) => setWorkoutQuery(event.target.value)}
                  />
                </label>
                <div className="schedule-workout-choice-list">
                  {normalizedWorkoutQuery ? (
                    <div className="schedule-workout-choice-group">
                      <div className="schedule-workout-choice-heading">
                        <span>Results</span>
                        <small>{matchingChoices.length}</small>
                      </div>
                      {matchingChoices.length ? (
                        matchingChoices.map(workoutChoice)
                      ) : (
                        <div className="schedule-workout-no-results">
                          No workouts match “{workoutQuery.trim()}”.
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      {frequentChoices.length > 0 && (
                        <div className="schedule-workout-choice-group">
                          <div className="schedule-workout-choice-heading">
                            <span>Most used</span>
                            <small>Quick workouts</small>
                          </div>
                          {frequentChoices.map(workoutChoice)}
                        </div>
                      )}
                      {otherChoices.length > 0 && (
                        <div className="schedule-workout-choice-group">
                          <div className="schedule-workout-choice-heading">
                            <span>All workouts</span>
                            <small>{otherChoices.length}</small>
                          </div>
                          {otherChoices.map(workoutChoice)}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
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
            Create a reusable workout first. Start full programs from Programs;
            workouts already on your calendar remain available here.
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
