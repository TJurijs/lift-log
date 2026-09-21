import { useTrainingHistory } from "./features/history/useTrainingHistory";
import { sourceDateDetail, occurrenceDateDetail, type TrainingDateTarget } from "./features/scheduling/training-date-target";
import { useCoachingWorkspace } from "./features/coaching/useCoachingWorkspace";
import type { ProgramAction, ProgramSourceTab } from "./features/programs/ProgramsHome";
import { useProgramMetadataDraft, type ProgramMetadata } from "./features/programs/useProgramMetadataDraft";
import { navigationItems, destinationLabel, actionUi, trainingContentUi } from "./ui-semantics";
import { ObjectActionMenu, type ObjectAction } from "./object-action-menu";
import {
  Activity,
  CalendarMinus,
  Check,
  Clock3,
  Copy,
  Gauge,
  Info,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  MessageSquareText,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  memo,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ActiveSession,
  AthleteSummary,
  CalendarWorkspaceData,
  CoachAgendaEntry,
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
  PreviousWorkoutValues,
  PrescriptionEntry,
  Program,
  ProgramCursor,
  ProgramRunDetail,
  ProgramRunSummary,
  ProgramRunWorkout,
  ProgramRunWorkoutDate,
  ScheduledWorkout,
  SessionSetValue,
  TrackingField,
  ViewName,
  WorkoutItem,
  WorkspaceData,
} from "../lib/domain";
import {
  loggingFormatFor,
  loggingFormatLabel,
  trackingFieldsForMode,
  recordingSummary,
  workoutItemNotes,
} from "../lib/domain";
import type { AppViewer } from "../lib/auth";
import {
  LiftLogRepository,
  SessionRevisionConflictError,
} from "../lib/repository";
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
  getInitials,
} from "../lib/presentation";
import {
  presentProgramProvenance,
} from "../lib/provenance";
import {
  formatDistanceKilometres,
  formatWeight,
  distanceInputValue,
  weightInputValue,
} from "../lib/units";
import {
  programWorkouts,
  reorderProgramWorkoutItems,
  reorderProgramWorkoutSequence,
} from "../lib/program-tree";
import { nextIncompleteRunWorkoutId } from "../lib/program-progress";
import { copyTrainingForViewer } from "../lib/training-copy";
import {
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
import { ExerciseVideoLinks } from "./exercise-video-link";
import { useActiveWorkoutPersistence } from "./features/active-workout/useActiveWorkoutPersistence";
import { starterResultLogs, starterSetLogs, useActiveWorkoutForm } from "./features/active-workout/useActiveWorkoutForm";
import { GhostValueCell } from "./features/active-workout/GhostValueCell";
import { usePreviousWorkoutValues } from "./features/active-workout/usePreviousWorkoutValues";
import { previousDemoWorkoutValues } from "./features/active-workout/previous-workout-demo";
import "./features/active-workout/workout-reference.css";
import { MeasurementInput } from "./features/active-workout/MeasurementInput";
import { DurationInput, DurationField } from "./features/active-workout/DurationInput";
import { durationSecondsValue, formatRecordedDuration } from "../lib/duration";
import { plannedRecordingValues, plannedIntervalRecordingValues } from "../lib/workout-recording";
import { completeDemoWorkout, createDemoWorkoutSession } from "./features/active-workout/demo-workout";
import { RpeChoiceButtons, RpeLegend, RpeSelect, rpeTone, wholeRpe } from "./features/active-workout/RpeInputs";
export { PlannedRpeSelect, RpeChoiceButtons, RpeSelect } from "./features/active-workout/RpeInputs";
import type { CoachWorkspaceProgram } from "./features/coaching/CoachWorkspace";
import type { AssignTrainingSubmission } from "./features/program-runs/AssignTrainingDialog";
import { useCompletedHistory } from "./features/history/useCompletedHistory";
import "./features/feature-styles.css";

import { emptyExerciseLibraryFilters, exerciseTrainingStyleLabel, filterCompleteExerciseLibrary, inferredExerciseDiscipline, type ExerciseLibraryFilters } from "./features/exercises/exercise-library";
import { useExerciseSearch } from "./features/exercises/useExerciseSearch";

const ExercisesHome = lazy(() => import("./features/exercises/ExercisesHome"));
const loadAuthoringDialogs = () => import("./features/authoring/AuthoringDialogs");
const PrescriptionModal = lazy(() => import("./features/authoring/PrescriptionModal"));
const ExerciseModal = lazy(() => loadAuthoringDialogs().then(({ ExerciseModal: component }) => ({ default: component })));
const ProgramModal = lazy(() => loadAuthoringDialogs().then(({ ProgramModal: component }) => ({ default: component })));
const WorkoutModal = lazy(() => loadAuthoringDialogs().then(({ WorkoutModal: component }) => ({ default: component })));
const WorkoutSettingsModal = lazy(() => loadAuthoringDialogs().then(({ WorkoutSettingsModal: component }) => ({ default: component })));
const CalendarView = lazy(() => import("./features/calendar/CalendarView"));
const loadProgramsHome = () => import("./features/programs/ProgramsHome");
const ProgramsHome = lazy(() => loadProgramsHome().then(({ ProgramsHome: component }) => ({ default: component })));
const loadProgramView = () => import("./features/programs/ProgramView");
const ProgramView = lazy(loadProgramView);
const CoachWorkspace = lazy(() =>
  import("./features/coaching/CoachWorkspace").then(
    ({ CoachWorkspace: component }) => ({ default: component }),
  ),
);
const AssignTrainingDialog = lazy(() =>
  import("./features/program-runs/AssignTrainingDialog"),
);
const TrainingDatesEditor = lazy(() => import("./features/program-runs/TrainingDatesEditor"));
const TrainingDatePicker = lazy(() => import("./features/scheduling/TrainingDatePicker").then(({ TrainingDatePicker: component }) => ({ default: component })));

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
  | "training-dates"
  | "program"
  | "quick-workout"
  | "date-picker"
  | "account"
  | null;
type ContentDeleteTarget =
  | { kind: "workout"; id: string; title: string }
  | { kind: "workout-item"; id: string; title: string }
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

type CompletedWorkoutViewState = {
  session: CompletedSession;
  detail: CompletedSessionDetail | null;
  loading: boolean;
  error: string;
  returnView: "training" | "calendar" | "coaching";
};
type DetailState =
  | {
      kind: "workout-preview";
      schedule: ScheduledWorkout;
      returnView: "training" | "calendar";
    }
  | ({ kind: "completed-workout" } & CompletedWorkoutViewState)
  | null;
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
  distanceUnit: OwnProfile["distanceUnit"] = "km",
) {
  const target = item.prescription;
  const parts: string[] = [];
  if (item.mode === "sets") {
    const variedReps = prescriptionEntryVaries(item, "reps");
    const variedLoad = prescriptionEntryVaries(item, "loadKg");
    const count = target.sets ?? 1;
    if (item.fields.includes("duration") && target.durationMinutes !== undefined && !prescriptionEntryVaries(item, "durationMinutes"))
      parts.push(`${count} × ${formatRecordedDuration(target.durationMinutes)}`);
    else if (item.fields.includes("distance") && target.distance !== undefined && !prescriptionEntryVaries(item, "distance"))
      parts.push(`${count} × ${target.distance} ${target.distanceUnit ?? "m"}`);
    else parts.push(variedReps || !item.fields.includes("reps") || !target.reps ? `${count} sets` : `${count} × ${target.reps}`);
    if (variedLoad) parts.push("varied load");
    else if (target.loadKg !== undefined)
      parts.push(`${formatWeight(target.loadKg, weightUnit)} ${weightUnit}`);
  } else if (item.mode === "intervals") {
    parts.push(`${target.rounds ?? 1} rounds`);
    if (target.workSeconds !== undefined)
      parts.push(`${target.workSeconds}s work`);
  } else {
    if (target.durationMinutes !== undefined)
      parts.push(formatRecordedDuration(target.durationMinutes));
    if (target.distance !== undefined) {
      const distanceKm = target.distanceUnit === "km" ? target.distance : target.distance / 1000;
      parts.push(distanceUnit === "mi"
        ? `${formatDistanceKilometres(distanceKm, distanceUnit)} mi`
        : `${target.distance} ${target.distanceUnit ?? "m"}`);
    }
    if (target.loadKg !== undefined)
      parts.push(`${formatWeight(target.loadKg, weightUnit)} ${weightUnit}`);
  }
  if (item.mode !== "none") {
    if (prescriptionEntryVaries(item, "restSeconds")) parts.push("varied rest");
    else if (target.restSeconds !== undefined) parts.push(`${target.restSeconds}s rest`);
  }
  return parts.join(" · ") || (item.mode === "none" ? "Instructions" : "Open");
}

function modeLabel(mode: EntryMode, fields: readonly TrackingField[] = []) {
  return loggingFormatLabel(loggingFormatFor(mode, fields));
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
  initialDemoSessions = [],
}: {
  viewer: AppViewer;
  onSignOut: () => void;
  initialWorkspace: WorkspaceData;
  repository: LiftLogRepository | null;
  initialDemoSessions?: CompletedSessionDetail[];
}) {
  const [activeView, setActiveView] = useState<ViewName>(() => {
    if (typeof window === "undefined") return "training";
    const view = parseAppView(window.location.hash);
    const entry = appDetailFromHistory();
    if (entry === "workout" && initialWorkspace.activeSession) return "workout";
    return view === "workout" && !initialWorkspace.activeSession && (!entry || entry === "workout") ? "training" : view;
  });
  const [workspace, setWorkspace] = useState<WorkspaceData>(initialWorkspace);
  const [calendarRangeData, setCalendarRangeData] =
    useState<CalendarWorkspaceData>({
      scheduledWorkouts: initialWorkspace.scheduledWorkouts,
      completedSessions: initialWorkspace.completedSessions,
    });
  const [program, setProgram] = useState<Program | null>(null);
  const [programEditing, setProgramEditing] = useState(false);
  const programMetadata = useProgramMetadataDraft(program);
  const guardProgramNavigation = programMetadata.guard;
  const [viewingProgramRunId, setViewingProgramRunId] = useState<string | null>(
    null,
  );
  const [viewingProgramRunDetail, setViewingProgramRunDetail] =
    useState<ProgramRunDetail | null>(null);
  const [programReturnView, setProgramReturnView] =
    useState<ViewName>("training");
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
  const [demoCompletedSessions, setDemoCompletedSessions] = useState(() => new Map(initialDemoSessions.map((session) => [session.id, session])));
  const [workoutStarted, setWorkoutStarted] = useState(
    Boolean(initialWorkspace.activeSession),
  );
  const [activeWorkoutVisible, setActiveWorkoutVisible] = useState(
    Boolean(initialWorkspace.activeSession),
  );
  const [activeWorkoutReturnView, setActiveWorkoutReturnView] = useState<"training" | "calendar">("training");
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
  const [toast, setToast] = useState("");
  const [coachingDetailsLoaded, setCoachingDetailsLoaded] = useState(!repository);
  const loadedWorkspaceFeaturesRef = useRef(
    new Set<LazyWorkspaceFeature>(
      repository ? [] : ["exercises", "calendar", "coaching"],
    ),
  );
  const loadingWorkspaceFeaturesRef = useRef(
    new Map<LazyWorkspaceFeature, Promise<void>>(),
  );
  const programCatalogGenerationRef = useRef(0);
  const activeRunsGenerationRef = useRef(0);
  const programsPagePendingRef = useRef(false);
  const runsPagePendingRef = useRef(false);
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
  const [requestedCoachMode, setCoachMode] = useState<"athlete" | "coach">(
    "athlete",
  );
  const { loadMoreCoachAthletes, loadCoachedAthleteDetail, loadMoreCoachHistory, loadMoreCoachProgramRuns, refreshCoachWorkspace, coachingRefreshing, coachAthleteCursor, setCoachAthleteCursor, coachAthletesLoadingMore, coachAthletesLoadError, setCoachAthletesLoadError, coachingDetailLoadingId, coachingHistoryLoadingId, coachingProgramRunsLoadingId, selectedAthleteId, setSelectedAthleteId } = useCoachingWorkspace({
    repository, workspace, setWorkspace, notify, requestedCoachMode,
    initialAthleteId: initialWorkspace.coachedAthletes[0]?.id ?? null,
  });
  const [programCursor, setProgramCursor] = useState<ProgramCursor>();
  const [calendarRangeLoading, setCalendarRangeLoading] = useState(false);
  const [calendarRangeError, setCalendarRangeError] = useState("");
  const restoreCompletedWorkoutFromHistory = useCallback(
    (history: Extract<AppDetailData, { kind: "workout-log" }>) => {
      const restoreKey = `${history.session.id}:${history.athleteId ?? "self"}`;
      if (completedWorkoutRestoreKeyRef.current === restoreKey) return;
      completedWorkoutRestoreKeyRef.current = restoreKey;
      const requestId = completedWorkoutRequestRef.current + 1;
      completedWorkoutRequestRef.current = requestId;
      const pending: CompletedWorkoutViewState = {
        session: history.session,
        detail: repository ? null : demoCompletedSessions.get(history.session.id) ?? { ...history.session, items: [] },
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
    [repository, setDetail, demoCompletedSessions],
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
    const restoreViewFromHistory = () => guardProgramNavigation(() => {
      const nextView = parseAppView(window.location.hash);
      const nextDetail = appDetailFromHistory();
      setActiveView(nextView === "workout" && !nextDetail && !activeSession ? "training" : nextView);
      if (!nextDetail || nextDetail === "coach-athlete") {
        completedWorkoutRequestRef.current += 1;
        completedWorkoutRestoreKeyRef.current = null;
        programHistoryRequestRef.current += 1;
        programHistoryRestoreKeyRef.current = null;
        setDetail(null);
        setActiveWorkoutVisible(false);
        if (nextDetail === "coach-athlete") setCoachMode("coach");
        if (nextView === "training") {
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
      } else if (nextDetail === "workout") {
        if (activeSession) {
          setActiveView("workout");
          setActiveWorkoutVisible(true);
        } else {
          setDetail(null);
          setProgram(null);
          setActiveWorkoutVisible(false);
          setActiveView("training");
          updateAppViewUrl("training", "replace");
        }
      } else if (nextDetail === "workout-log") {
        const history = appDetailDataFromHistory();
        if (history?.kind === "workout-log") {
          setActiveView("workout");
          restoreCompletedWorkoutFromHistory(history);
        } else {
          setDetail(null);
          setActiveWorkoutVisible(false);
        }
      }
      scrollToAppTop();
    });
    window.addEventListener("popstate", restoreViewFromHistory);
    window.addEventListener("hashchange", restoreViewFromHistory);
    if (
      appDetailFromHistory() === "workout-log" ||
      appDetailFromHistory() === "program" ||
      appDetailFromHistory() === "coach-athlete"
    ) {
      restoreViewFromHistory();
    }
    return () => {
      window.removeEventListener("popstate", restoreViewFromHistory);
      window.removeEventListener("hashchange", restoreViewFromHistory);
    };
  }, [activeSession, activeView, restoreCompletedWorkoutFromHistory, guardProgramNavigation]);
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
          const catalogGeneration = ++programCatalogGenerationRef.current;
          const runGeneration = ++activeRunsGenerationRef.current;
          const [page, programRunPage] = await Promise.all([
            repository.listProgramSummaries({ limit: 25 }),
            repository.listProgramRuns(undefined, {statusScope: "active", limit: 50}),
          ]);
          const currentCatalog = catalogGeneration === programCatalogGenerationRef.current;
          const currentRuns = runGeneration === activeRunsGenerationRef.current;
          if (currentCatalog) setProgramCursor(page.nextCursor);
          setWorkspace((previous) => ({
            ...(currentCatalog ? mergeProgramCatalog(previous, page.items, true) : previous),
            ...(currentRuns ? {programRuns: programRunPage.items,
              programRunCursor: programRunPage.nextCursor,
              hasMoreProgramRuns: programRunPage.hasMore} : {}),
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
          setCoachingDetailsLoaded(true);
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
    [repository, setCoachAthleteCursor, setCoachAthletesLoadError],
  );
  useEffect(() => {
    const feature =
      activeView === "coaching"
          ? "coaching"
          : activeView === "training" || activeView === "workout"
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
  const [openingCoachProgramId, setOpeningCoachProgramId] = useState<
    string | null
  >(null);
  const [assignmentSeed, setAssignmentSeed] = useState<{
    programId?: string;
    athleteIds?: string[];
    assignRun?: ProgramRunSummary;
  }>({});
  const [trainingDateTarget, setTrainingDateTarget] = useState<TrainingDateTarget | null>(null);
  const [respondingInvite, setRespondingInvite] = useState<{
    id: string;
    response: "accepted" | "declined";
  } | null>(null);
  const [cancellingCoachInviteId, setCancellingCoachInviteId] = useState<
    string | null
  >(null);
  const [scheduleInitialDate, setScheduleInitialDate] = useState<string | null>(
    null,
  );
  const [programsLoadingMore, setProgramsLoadingMore] = useState(false);
  const [programsLoadError, setProgramsLoadError] = useState("");
  const [ownRunsLoadingMore, setOwnRunsLoadingMore] = useState(false);
  const [ownRunsLoadError, setOwnRunsLoadError] = useState("");
  const {
    sessions: completedHistory,
    loading: completedHistoryLoading,
    error: completedHistoryError,
    cursor: completedHistoryCursor,
    load: loadCompletedHistory,
    invalidate: invalidateCompletedHistory,
  } = useCompletedHistory(repository, repository ? initialWorkspace.completedSessions : workspace.completedSessions);
  const historicalDemoRuns = useMemo(() => (workspace.programRuns ?? []).filter(run => run.status === "completed" || run.status === "ended"), [workspace.programRuns]);
  const {sessions: historicalRuns, loading: historyRunsLoading, error: historyRunsError, cursor: historyRunsCursor, load: loadRunHistory, invalidate: invalidateRunHistory} = useTrainingHistory(repository, historicalDemoRuns);
  const calendarRangeRequestRef = useRef(0);
  const lastCalendarRangeRef = useRef<{
    start: string;
    end: string;
  } | null>(null);
  const [requestedProgramSource, setProgramSource] =
    useState<ProgramSourceTab>("all");
  const [programAction, setProgramAction] = useState<ProgramAction>(null);
  const builderMutationPendingRef = useRef(false);
  const [builderMutationPending, setBuilderMutationPending] = useState(false);

  const loadMorePrograms = useCallback(async () => {
    if (!repository || !programCursor || programsPagePendingRef.current) return;
    programsPagePendingRef.current = true;
    const generation = programCatalogGenerationRef.current;
    setProgramsLoadingMore(true);
    setProgramsLoadError("");
    try {
      const page = await repository.listProgramSummaries({
        limit: 25,
        cursor: programCursor,
      });
      if (generation !== programCatalogGenerationRef.current) return;
      setProgramCursor(page.nextCursor);
      setWorkspace((previous) =>
        mergeProgramCatalog(previous, page.items, false),
      );
    } catch (error) {
      if (generation !== programCatalogGenerationRef.current) return;
      setProgramsLoadError(
        error instanceof Error
          ? error.message
          : "More programs could not be loaded.",
      );
    } finally {
      programsPagePendingRef.current = false;
      setProgramsLoadingMore(false);
    }
  }, [programCursor, repository]);

  const loadMoreOwnRuns = useCallback(async () => {
    const cursor = workspace.programRunCursor;
    if (!repository || !cursor || runsPagePendingRef.current) return;
    runsPagePendingRef.current = true;
    const generation = activeRunsGenerationRef.current;
    setOwnRunsLoadingMore(true);
    setOwnRunsLoadError("");
    try {
      const page = await repository.listProgramRuns(undefined, { statusScope: "active", limit: 50, cursor });
      if (generation !== activeRunsGenerationRef.current) return;
      setWorkspace(previous => ({
        ...previous,
        programRuns: [...new Map([...(previous.programRuns ?? []), ...page.items].map(run => [run.id, run])).values()],
        programRunCursor: page.nextCursor,
        hasMoreProgramRuns: page.hasMore,
      }));
    } catch (error) {
      if (generation !== activeRunsGenerationRef.current) return;
      setOwnRunsLoadError(error instanceof Error ? error.message : "More training could not be loaded.");
    } finally {
      runsPagePendingRef.current = false;
      setOwnRunsLoadingMore(false);
    }
  }, [repository, workspace.programRunCursor]);

  const refreshVisibleCalendar = useCallback(async () => {
    const range = lastCalendarRangeRef.current;
    if (range) await loadVisibleCalendarRange(range.start, range.end);
  }, [loadVisibleCalendarRange]);

  const loadTrainingProgram = useCallback(
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
        workouts: programWorkouts(source).map((workout, position) => {
          const schedule = workspace.scheduledWorkouts.find(candidate => candidate.programRunId === run.id && candidate.workoutId === workout.id);
          const completed = schedule?.programRunWorkoutId ? workspace.completedSessions.find(session => session.programRunWorkoutId === schedule.programRunWorkoutId) : undefined;
          return {
          id: schedule?.programRunWorkoutId ?? `${run.id}:${workout.id}`,
          runId: run.id,
          workoutId: workout.id,
          title: workout.title,
          position,
          estimatedMinutes: workout.durationMinutes,
          plannedDate: schedule?.plannedDate,
          scheduledWorkoutId: schedule?.id,
          status: schedule?.status === "completed" ? "completed" as const : run.status === "ended" ? "cancelled" as const : schedule?.status === "in_progress" ? "in_progress" as const : schedule?.status === "skipped" ? "skipped" as const : schedule?.plannedDate ? "scheduled" as const : "unscheduled" as const,
          canEdit: run.status !== "ended" && (!schedule || schedule.status === "planned"),
          sessionId: completed?.id,
          completedForDate: completed?.date,
          prescriptionOverrides: {},
        }; }),
      };
    },
    [repository, workspace.programCatalog, workspace.programRuns, workspace.scheduledWorkouts, workspace.completedSessions],
  );

  const loadTrainingDateDetail = useCallback(async () => {
    if (!trainingDateTarget) return null;
    if (trainingDateTarget.kind === "run") return loadProgramRunDetail(trainingDateTarget.run.id);
    if (trainingDateTarget.kind === "occurrence") return occurrenceDateDetail(trainingDateTarget.schedule, viewer.id);
    const source = await loadTrainingProgram(trainingDateTarget.program);
    return source ? sourceDateDetail(source) : null;
  }, [trainingDateTarget, loadProgramRunDetail, loadTrainingProgram, viewer.id]);

  const refreshProgramRunSummaries = useCallback(async () => {
    if (!repository) return;
    const generation = ++activeRunsGenerationRef.current;
    const page = await repository.listProgramRuns(undefined, {statusScope: "active", limit: 50});
    if (generation !== activeRunsGenerationRef.current) return;
    invalidateRunHistory();
    setWorkspace((previous) => ({
      ...previous,
      programRuns: page.items,
      programRunCursor: page.nextCursor,
      hasMoreProgramRuns: page.hasMore,
    }));
  }, [repository, invalidateRunHistory]);

  const loadAssignmentRun = useCallback(async (run: ProgramRunSummary) => repository
    ? repository.loadProgramForRun(run.id)
    : workspace.programCatalog.find(program => program.id === run.programId) ?? null,
  [repository, workspace.programCatalog]);

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
  const hasCoachTraining = hasCoach || [...(workspace.programRuns ?? []), ...historicalRuns].some(run => run.createdById !== viewer.id) || completedHistory.some(session => session.sourceType === "coach");
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
    detail?.kind === "workout-preview" ? detail.returnView : "training";
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
    const capabilities = deriveTrainingContentCapabilities({
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
    // The database authorizes a private editor for this one upcoming occurrence.
    // It must never acquire library-level scheduling, assignment or delete actions.
    return targetProgram.editableRunWorkoutId
      ? { ...capabilities, edit: targetProgram.versionStatus === "draft", save: targetProgram.versionStatus === "draft", schedule: false, assign: false, deleteOwn: false, copyToOwn: false }
      : capabilities;
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
  const assignmentRuns = [...new Map([
    ...(assignmentSeed.assignRun ? [assignmentSeed.assignRun] : []),
    ...(workspace.programRuns ?? []),
  ].filter(run => run.athleteId === viewer.id && run.createdById === viewer.id).map(run => [run.id, run])).values()];
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
        workoutId: slot.effectiveWorkoutId ?? slot.workoutId,
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

  const {
    setLogs, setSetLogs, resultLogs, setResultLogs, sessionRpe, setSessionRpe,
    sessionNote, setSessionNote, snapshot: activeWorkoutSnapshot,
    applySnapshot: applyPersistedSnapshot, updateSet, addSet, removeSet, updateResult,
  } = useActiveWorkoutForm(initialWorkspace.activeSession, todayWorkout);
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
  const referenceWorkout = workoutPreviewSchedule?.workout ?? (activeView === "workout" ? todayWorkout : undefined);
  const demoPreviousValues = useMemo(() => {
    if (!import.meta.env.DEV || repository || !referenceWorkout) return null;
    const previousSession = [...demoCompletedSessions.values()]
      .filter((session) => session.workoutId === referenceWorkout.id && session.id !== activeSession?.id)
      .sort((left, right) => right.date.localeCompare(left.date))[0];
    return previousDemoWorkoutValues(referenceWorkout, previousSession);
  }, [repository, referenceWorkout, demoCompletedSessions, activeSession?.id]);
  const previousWorkoutValues = usePreviousWorkoutValues({ repository, viewerId: viewer.id,
    workoutId: referenceWorkout?.id, excludeSessionId: activeSession?.id, online: isOnline, demoValues: demoPreviousValues });
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
      editing?: boolean;
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
    setProgramEditing(preferred?.editing ?? Boolean(nextProgram.editableRunId));
    setViewingProgramRunId(
      preferred?.programRunDetail?.id ?? preferred?.programRunId ?? null,
    );
    setViewingProgramRunDetail(preferred?.programRunDetail ?? null);
    const returnView = preferred?.returnView ?? "training";
    setProgramReturnView(returnView);
    if (options.writeHistory !== false) {
      programHistoryRequestRef.current += 1;
      const programRunId =
        preferred?.programRunDetail?.id ?? preferred?.programRunId;
      const historyData: Extract<AppDetailData, { kind: "program" }> = {
        kind: "program",
        programId: nextProgram.id,
        programVersionId: nextProgram.versionId,
        editing: preferred?.editing ?? Boolean(nextProgram.editableRunId),
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
        historyData.programRunId ?? "source",
        historyData.workoutId ?? "first",
        historyData.returnView,
        historyData.editing ? "edit" : "view",
      ].join(":");
      pushAppDetailHistory("program", "training", {
        stackOnDetail: returnView === "coaching" && appDetailFromHistory() === "coach-athlete",
        data: historyData,
      });
    }
    setSelectedWeek(nextWeek?.index ?? 1);
    setSelectedWorkoutId(nextWorkout?.id ?? "");
    setSelectedSectionId(nextSection?.id ?? "");
  }

  useLayoutEffect(() => {
  programHistoryRestoreRef.current = (history) => {
    const restoreKey = [
      history.athleteId,
      history.programId,
      history.programVersionId,
      history.assignmentId ?? "unassigned",
      history.programRunId ?? "source",
      history.workoutId ?? "first",
      history.returnView,
      history.editing ? "edit" : "view",
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
          editing: history.editing,
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
          throw new Error("This training is no longer available.");
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
  });

  async function openProgram(targetProgram: Program) {
    try { await programMetadata.flush(); } catch { return; }
    void loadProgramView();
    if (!repository || targetProgram.detailsLoaded !== false) {
      selectProgram(targetProgram);
      setActiveView("training");
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
      setActiveView("training");
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
    const catalogGeneration = ++programCatalogGenerationRef.current;
    const runGeneration = ++activeRunsGenerationRef.current;
    repository.invalidatePrograms(programId);
    invalidateRunHistory();
    const [page, programRunPage] = await Promise.all([
      repository.listProgramSummaries({ limit: 25 }),
      repository.listProgramRuns(undefined, {statusScope: "active", limit: 50}),
    ]);
    const currentCatalog = catalogGeneration === programCatalogGenerationRef.current;
    const currentRuns = runGeneration === activeRunsGenerationRef.current;
    if (currentCatalog) setProgramCursor(page.nextCursor);
    setWorkspace((previous) => ({
      ...(currentCatalog ? mergeProgramCatalog(previous, page.items, true) : previous),
      ...(currentRuns ? {programRuns: programRunPage.items,
        programRunCursor: programRunPage.nextCursor,
        hasMoreProgramRuns: programRunPage.hasMore} : {}),
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
      editing: programEditing,
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
    guardProgramNavigation(() => navigateAfterMetadataSave(view));
  }

  function navigateAfterMetadataSave(view: ViewName) {
    completedWorkoutRequestRef.current += 1;
    completedWorkoutRestoreKeyRef.current = null;
    programHistoryRequestRef.current += 1;
    programHistoryRestoreKeyRef.current = null;
    setDetail(null);
    setActiveWorkoutVisible(false);
    if (view === "training") {
      setProgram(null);
      setViewingProgramRunId(null);
      setViewingProgramRunDetail(null);
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
    guardProgramNavigation(() => leaveDetailAfterMetadataSave(returnView));
  }

  function leaveDetailAfterMetadataSave(returnView: ViewName) {
    programHistoryRequestRef.current += 1;
    setDetail(null);
    setActiveWorkoutVisible(false);
    if (!leaveAppDetailHistory()) {
      setActiveView(returnView);
      updateAppViewUrl(returnView);
    }
    scrollToAppTop();
  }

  function showActiveWorkout(returnView: "training" | "calendar" = "training") {
    setActiveWorkoutReturnView(returnView);
    pushAppDetailHistory("workout", "workout", {
      stackOnDetail: returnView === "training" && appDetailFromHistory() === "program",
    });
    setActiveView("workout");
    setActiveWorkoutVisible(true);
    scrollToAppTop();
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

  function applyStartedWorkout(session: ActiveSession, schedule: ScheduledWorkout, returnView: "training" | "calendar") {
      completionTokenRef.current = null;
      setActiveSession(session);
      setSetLogs(starterSetLogs(schedule.workout, session));
      setResultLogs(session.resultLogs);
      setSessionRpe(session.sessionRpe);
      setSessionNote(session.sessionNote);
      setWorkoutStarted(true);
      showActiveWorkout(returnView);
      setWorkspace((previous) => ({
        ...previous,
        scheduledWorkouts: [{ ...schedule, status: "in_progress" }, ...previous.scheduledWorkouts.filter(candidate => candidate.id !== schedule.id)],
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
  }

  async function startWorkout(schedule: ScheduledWorkout, returnView: "training" | "calendar" = "training") {
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
      if (!repository && activeSession) {
        if (activeSession.scheduledWorkoutId === schedule.id) {
          showActiveWorkout(returnView);
          return;
        }
        throw new Error("Finish or reset your current workout before starting another one.");
      }
      const session = repository
        ? await repository.startOrResumeSession(detailedSchedule.id)
        : import.meta.env.DEV ? createDemoWorkoutSession(detailedSchedule) : null;
      if (!session) throw new Error("The workout session was not created.");
      applyStartedWorkout(session, detailedSchedule, returnView);
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
    returnView: "training" | "calendar" = "training",
    recordHistory = true,
  ) {
    try {
      const detailedSchedule = await ensureScheduledWorkoutDetails(schedule);
      setDetail({
        kind: "workout-preview",
        schedule: detailedSchedule,
        returnView,
      });
      if (recordHistory) pushAppDetailHistory("workout", "workout", {
        stackOnDetail: returnView === "training" && appDetailFromHistory() === "program",
      });
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
    navigateAfterMetadataSave(activeWorkoutReturnView);
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
    await saveFinishedWorkout();
  }

  async function saveFinishedWorkout() {
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
        let recovered: Awaited<ReturnType<typeof activeWorkoutPersistence.flushConfirmed>> | null = null;

        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (!completion) {
            const confirmed =
              recovered ?? (await activeWorkoutPersistence.flushConfirmed());
            recovered = null;
            completion = {
              sessionId: activeSession.id,
              token: crypto.randomUUID(),
              confirmedRevision: confirmed.revision,
              sessionRpe: confirmed.snapshot.sessionRpe,
              sessionNote: confirmed.snapshot.sessionNote,
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
            recovered = await activeWorkoutPersistence.recoverConfirmed();
          }
        }

        await clearConfirmedActiveSession(activeSession, "completed");
        completionTokenRef.current = null;
        invalidateCompletedHistory();
        await Promise.allSettled([refreshProgramRunSummaries(), refreshVisibleCalendar()]);
        notify("Session saved · next workout is ready when you are");
        return;
      }

      if (import.meta.env.DEV && activeSession && todaySchedule) {
        const completed = completeDemoWorkout(activeSession, todaySchedule, activeWorkoutSnapshot);
        await clearConfirmedActiveSession(activeSession, "completed");
        setDemoCompletedSessions((previous) => new Map(previous).set(completed.id, completed));
        setWorkspace((previous) => {
          const run = previous.programRuns?.find(run => run.id === todaySchedule.programRunId);
          const source = run && previous.programCatalog.find(program => program.id === run.programId);
          const pending = source ? programWorkouts(source).filter(workout => !previous.scheduledWorkouts.some(schedule => schedule.programRunId === run?.id && schedule.workoutId === workout.id && ["completed", "skipped"].includes(schedule.status))) : [];
          const next = pending.map(workout => ({workout, schedule: previous.scheduledWorkouts.find(schedule => schedule.programRunId === run?.id && schedule.workoutId === workout.id)})).sort((a,b) => (a.schedule?.plannedDate ?? "9999").localeCompare(b.schedule?.plannedDate ?? "9999"))[0];
          return { ...previous, completedSessions: [completed, ...previous.completedSessions], programRuns: previous.programRuns?.map(candidate => candidate.id !== run?.id ? candidate : {
            ...candidate, status: pending.length ? "in_progress" : "completed", completedWorkouts: candidate.completedWorkouts + 1,
            completionPercent: Math.round((candidate.completedWorkouts + 1) / candidate.totalWorkouts * 100), finishedAt: pending.length ? undefined : new Date().toISOString(),
            nextWorkout: next ? {id: next.schedule?.programRunWorkoutId ?? `${candidate.id}:${next.workout.id}`, title:next.workout.title, plannedDate:next.schedule?.plannedDate, status:next.schedule?.plannedDate ? "scheduled" : "unscheduled"} : undefined,
          }) };
        });
        setCalendarRangeData((previous) => ({ ...previous, completedSessions: [completed, ...previous.completedSessions] }));
        notify("Session saved to your demo training history");
      }
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
        throw error instanceof Error ? error : new Error("The workout could not be added");
      }
    } else {
      workout = {
        id: `workout-${Date.now()}`,
        title,
        dayLabel: `Workout ${programWorkoutSequence.length + 1}`,
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
    durationMinutes: number | undefined,
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
      item = await repository.addWorkoutItem(targetSection, exercise);
    } else {
      item = {
        id: `item-${Date.now()}`,
        exerciseId: exercise.id,
        category: exercise.category,
        videoUrl: exercise.videoUrl,
        videoLinks: exercise.videoLinks,
        title: exercise.name,
        cue: exercise.cue,
        mode: exercise.defaultMode,
        fields: exercise.defaultFields,
        prescription:
          exercise.defaultMode === "sets"
            ? { sets: exercise.defaultFields.includes("reps") ? 3 : 1, entries: Array.from({ length: exercise.defaultFields.includes("reps") ? 3 : 1 }, () => ({})) }
            : exercise.defaultMode === "intervals"
              ? { rounds: 1, entries: [{}] }
              : {},
      };
    }
    attachWorkoutItem(item, selectedWorkout.id, targetSection.id);
  }

  async function addCustomExerciseToWorkout(name: string) {
    const section = selectedWorkout?.sections[0];
    if (!selectedWorkout || !section) throw new Error("Select a workout first.");
    const item: WorkoutItem = repository
      ? await repository.addCustomWorkoutItem(section, name)
      : { id: `item-${crypto.randomUUID()}`, title: name.trim(), category: "Strength", cue: "", mode: "sets", fields: ["reps", "load"], prescription: {sets: 3, entries: [{}, {}, {}]} };
    setSelectedSectionId(section.id);
    attachWorkoutItem(item, selectedWorkout.id, section.id);
  }

  function attachWorkoutItem(item: WorkoutItem, workoutId: string, sectionId: string) {
    setProgram((previous) =>
      previous
        ? {
            ...previous,
            weeks: previous.weeks.map((week) => ({
              ...week,
              workouts: week.workouts.map((workout) =>
                workout.id !== workoutId
                  ? workout
                  : {
                      ...workout,
                      sections: workout.sections.length
                        ? workout.sections.map((section) =>
                            section.id === sectionId
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
    videoLinks: Exercise["videoLinks"],
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
          videoLinks,
        });
      } catch (error) {
        throw error instanceof Error ? error : new Error("The exercise could not be saved");
      }
    } else {
      exercise = {
        id: `personal-${Date.now()}`,
        name,
        category,
        discipline,
        cue,
        scope: "personal",
        videoLinks,
        videoUrl: videoLinks?.[0]?.url,
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
    videoLinks: Exercise["videoLinks"],
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
      videoUrl: videoLinks?.[0]?.url,
      videoLinks,
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
            videoLinks,
            videoUrl: videoLinks?.[0]?.url,
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
      throw error instanceof Error ? error : new Error("The exercise could not be updated");
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
            videoLinks: exercise.videoLinks,
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

  async function persistProgramMetadata(targetProgram: Program, metadata: ProgramMetadata) {
    requireCapability(capabilitiesForProgram(targetProgram), "save");
    const { title, description } = metadata;
    const quickWorkout = targetProgram.contentType === "quick_workout" ? programWorkouts(targetProgram)[0] : undefined;
    if (repository) {
      if (quickWorkout) await repository.updateWorkout(quickWorkout.id, title, quickWorkout.durationMinutes);
      await repository.updateProgramTitle(targetProgram.id, title);
      await repository.updateProgramDescription(targetProgram.id, description);
    }
    const patch = (candidate: Program): Program => candidate.versionId !== targetProgram.versionId ? candidate : {
      ...candidate, title, description,
      weeks: quickWorkout ? candidate.weeks.map((week) => ({ ...week, workouts: week.workouts.map((workout) => workout.id === quickWorkout.id ? { ...workout, title } : workout) })) : candidate.weeks,
    };
    setProgram((current) => current ? patch(current) : current);
    setWorkspace((previous) => ({
      ...previous,
      programCatalog: previous.programCatalog.map(patch),
      schedulablePrograms: previous.schedulablePrograms.map(patch),
      draftProgram: previous.draftProgram ? patch(previous.draftProgram) : null,
      activeProgram: previous.activeProgram ? patch(previous.activeProgram) : null,
    }));
  }

  useEffect(() => { programMetadata.configure(persistProgramMetadata); });

  async function finishProgramEditing() {
    if (builderMutationPending || !program) return;
    try {
      await programMetadata.flush();
      if (program.editableRunId) { await returnFromWorkoutEditor(); return; }
      setProgramEditing(false);
      const history = appDetailDataFromHistory();
      if (history?.kind === "program") {
        pushAppDetailHistory("program", "training", { data: { ...history, editing: false } });
      }
    } catch { /* The metadata error remains visible in the editor. */ }
  }

  async function editProgram(targetProgram: Program, workoutId?: string) {
    try { await programMetadata.flush(); } catch { return; }
    if (!repository) {
      selectProgram(targetProgram, {workoutId, editing: true});
      return;
    }
    if (programAction) return;
    const requestId = ++programHistoryRequestRef.current;
    setProgramAction({ id: targetProgram.id, kind: "edit" });
    try {
      requireCapability(capabilitiesForProgram(targetProgram), "edit");
      const source = workoutId ? await loadTrainingProgram(targetProgram) : null;
      const selectedPosition = source ? programWorkouts(source).findIndex(workout => workout.id === workoutId) : -1;
      const editableProgram = await repository.loadEditableProgram(
        targetProgram.athleteId,
        targetProgram.id,
      );
      if (programHistoryRequestRef.current !== requestId) return;
      const editableWorkouts = programWorkouts(editableProgram);
      const editableWorkoutId = editableWorkouts.find(workout => workout.id === workoutId || workout.originalWorkoutId === workoutId)?.id
        ?? (selectedPosition >= 0 ? editableWorkouts[selectedPosition]?.id : undefined);
      selectProgram(editableProgram, {workoutId: editableWorkoutId, editing: true, returnView: programReturnView});
      setActiveView("training");
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
    sourceRun?: ProgramRunSummary,
  ) {
    try { await programMetadata.flush(); } catch { return; }
    if (programAction) return;
    setProgramAction({ id: targetProgram.id, kind: "duplicate" });
    try {
      if (sourceRun) {
        if (sourceRun.athleteId !== viewer.id && sourceRun.createdById !== viewer.id) throw new Error("This training cannot be repeated.");
      } else requireCapability(capabilitiesForProgram(targetProgram), "copyToOwn");
      let copy: Program;
      if (repository) {
        const copyId = sourceRun
          ? await repository.copyProgramRunToOwn(sourceRun.id)
          : await repository.copyProgramToOwn(targetProgram.id);
        await refreshProgramWorkspace(copyId);
        copy = await repository.loadEditableProgram(viewer.id, copyId);
      } else {
        if (!import.meta.env.DEV) throw new Error("Sign in before repeating training.");
        copy = copyTrainingForViewer(targetProgram, viewer.id, viewer.name);
        addLocalTraining(copy);
      }
      selectProgram(copy, { returnView: programReturnView, editing: true });
      setActiveView("training");
      notify(`${targetProgram.title} ready to repeat · edit it, then start or set dates`);
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "This training could not be repeated",
      );
    } finally {
      setProgramAction(null);
    }
  }

  function addLocalTraining(nextProgram: Program) {
    setWorkspace(previous => ({
      ...previous,
      programCatalog: [nextProgram, ...previous.programCatalog.filter(candidate => candidate.id !== nextProgram.id)],
      draftProgram: nextProgram,
    }));
  }

  async function repeatRunForEditing(run: ProgramRunSummary) {
    try {
      const source = repository
        ? await repository.loadProgramForRun(run.id)
        : programCatalog.find(candidate => candidate.id === run.programId);
      if (!source) throw new Error("This training is no longer available.");
      await duplicateProgram(source, run);
    } catch (error) {
      notify(error instanceof Error ? error.message : "This training could not be repeated.");
    }
  }

  async function editRunWorkout(slot: ProgramRunWorkout, run = viewingProgramRun, returnView = programReturnView) {
    try { await programMetadata.flush(); } catch { return; }
    if (builderMutationPending || programAction || !run || slot.canEdit === false) return;
    setProgramAction({ id: program?.id ?? slot.id, kind: "edit" });
    try {
      let editable: Program;
      if (repository) {
        editable = await repository.prepareProgramRunWorkoutEdit(slot.id);
      } else {
        if (!import.meta.env.DEV) throw new Error("Sign in before editing training.");
        const source = program ?? programCatalog.find(candidate => candidate.id === run.programId);
        const workout = source && programWorkouts(source).find(candidate => candidate.id === (slot.effectiveWorkoutId ?? slot.workoutId));
        if (!source || !workout) throw new Error("This workout is no longer available.");
        editable = copyTrainingForViewer({ ...source, title: workout.title, contentType: "quick_workout", weeks: [{ ...source.weeks[0], workouts: [workout] }] }, viewer.id, viewer.name);
        editable.editableRunId = run.id;
        editable.editableRunWorkoutId = slot.id;
      }
      setDetail(null);
      selectProgram(editable, { returnView });
      setActiveView("training");
      notify("Editing this workout");
    } catch (error) {
      notify(error instanceof Error ? error.message : "This workout could not be opened for editing.");
    } finally {
      setProgramAction(null);
    }
  }

  async function returnFromWorkoutEditor() {
    if (!program?.editableRunId) return;
    try {
      await programMetadata.flush();
      const run = await loadProgramRunDetail(program.editableRunId);
      if (!run) throw new Error("This training could not be reloaded.");
      if (repository) {
        await Promise.all([refreshProgramWorkspace(), refreshVisibleCalendar()]);
      }
      await openOwnProgramRun(run, programReturnView);
    } catch (error) {
      notify(error instanceof Error ? error.message : "This training could not be reloaded.");
    }
  }

  async function editUpcomingWorkout(schedule: ScheduledWorkout, returnView: ViewName) {
    if (!schedule.programRunId || !schedule.programRunWorkoutId) return;
    try {
      const run = await loadProgramRunDetail(schedule.programRunId);
      const slot = run?.workouts.find(candidate => candidate.id === schedule.programRunWorkoutId);
      if (!run || !slot || slot.canEdit === false) throw new Error("This workout can no longer be edited.");
      await editRunWorkout(slot, run, returnView);
    } catch (error) {
      notify(error instanceof Error ? error.message : "This workout could not be opened for editing.");
    }
  }

  async function startTraining(target: { programId?: string; workoutId?: string; runWorkoutId?: string }, trainingId: string) {
    try { await programMetadata.flush(); } catch { return; }
    if (workoutActionRef.current || builderMutationPending) return;
    if (activeSession) {
      if (target.runWorkoutId && activeSession.programRunWorkoutId === target.runWorkoutId) showActiveWorkout();
      else notify("Finish your current workout before starting another one.");
      return;
    }
    workoutActionRef.current = "starting";
    setWorkoutAction("starting");
    setStartingScheduleId(trainingId);
    try {
      if (target.programId && !target.workoutId) {
        const summary = programCatalog.find(candidate => candidate.id === target.programId);
        const source = summary ? await loadTrainingProgram(summary) : null;
        const workoutId = source && programWorkouts(source)[0]?.id;
        if (!workoutId) throw new Error("Add a workout before starting this program.");
        target = { ...target, workoutId };
      }
      if (repository) {
        const session = await repository.startTrainingWorkout({ ...target, plannedDate: localDateOnly() });
        // Publish the matching form snapshot with its session, including when
        // the subsequent detail request fails and recording needs recovery.
        setSetLogs(session.setLogs);
        setResultLogs(session.resultLogs);
        setSessionRpe(session.sessionRpe);
        setSessionNote(session.sessionNote);
        setActiveSession(session);
        const schedule = session.scheduledWorkoutId ? await repository.loadScheduledWorkoutDetail(session.scheduledWorkoutId) : null;
        if (!schedule) throw new Error("Workout started. Refresh Training to resume it.");
        applyStartedWorkout(session, schedule, "training");
        await refreshProgramWorkspace().catch(() => notify("Workout started · refresh Training to update its list"));
      } else {
        if (!import.meta.env.DEV) throw new Error("Sign in before starting training.");
        const existingRun = workspace.programRuns?.find(run => run.nextWorkout?.id === target.runWorkoutId || run.id === trainingId);
        const source = programCatalog.find(candidate => candidate.id === (target.programId ?? existingRun?.programId));
        const runDetail = existingRun ? await loadProgramRunDetail(existingRun.id) : null;
        const selectedId = target.workoutId ?? runDetail?.workouts.find(slot => slot.id === target.runWorkoutId)?.workoutId;
        const workout = source && programWorkouts(source).find(candidate => !selectedId || candidate.id === selectedId);
        if (!source || !workout || !workout.sections.some(section => section.items.length)) throw new Error("Add an exercise before starting this workout.");
        const run = existingRun ?? { ...sourceDateDetail(source), id: crypto.randomUUID() };
        const existingSchedule = workspace.scheduledWorkouts.find(schedule => schedule.programRunId === run.id && schedule.workoutId === workout.id);
        const slotId = target.runWorkoutId ?? `${run.id}:${workout.id}`;
        const schedule: ScheduledWorkout = { id: existingSchedule?.id ?? crypto.randomUUID(), programRunId: run.id, programRunWorkoutId: slotId,
          programId: source.id, programVersionId: source.versionId, programTitle: source.title, workoutId: workout.id,
          workoutTitle: workout.title, slotLabel: workout.title, plannedDate: existingSchedule?.plannedDate ?? localDateOnly(), sequenceNumber: 1,
          status: "planned", workout, detailsLoaded: true };
        setWorkspace(previous => ({ ...previous, programRuns: [{ ...run, status: "in_progress", nextWorkout: { id: slotId, title: workout.title, status: "in_progress", plannedDate: schedule.plannedDate } }, ...(previous.programRuns ?? []).filter(candidate => candidate.id !== run.id)] }));
        applyStartedWorkout(createDemoWorkoutSession(schedule), schedule, "training");
      }
    } catch (error) { notify(error instanceof Error ? error.message : "This workout could not be started."); }
    finally { workoutActionRef.current = null; setWorkoutAction(null); setStartingScheduleId(null); }
  }

  async function startRunWorkout(run: ProgramRunSummary, selectedSlot?: ProgramRunWorkout) {
    const slotId = selectedSlot?.id ?? run.nextWorkout?.id;
    if (!slotId || run.athleteId !== viewer.id) return;
    await startTraining({ runWorkoutId: slotId }, run.id);
  }

  async function restoreRunWorkout(run: ProgramRunSummary, slot: ProgramRunWorkout) {
    if (run.athleteId !== viewer.id || !slot.scheduledWorkoutId) return;
    if (repository) {
      const schedule = await repository.loadScheduledWorkoutDetail(slot.scheduledWorkoutId);
      if (schedule) setWorkspace(previous => ({ ...previous, scheduledWorkouts: [schedule, ...previous.scheduledWorkouts.filter(candidate => candidate.id !== schedule.id)] }));
      await repository.setScheduledWorkoutStatus(slot.scheduledWorkoutId, "planned");
      await refreshProgramWorkspace();
    } else await setScheduledWorkoutStatus(slot.scheduledWorkoutId, "planned");
    notify("Workout restored");
  }

  async function repeatCompletedWorkout(session: CompletedSession) {
    if (programAction) return;
    setProgramAction({ id: session.id, kind: "duplicate" });
    try {
      let copy: Program;
      if (repository) {
        const programId = await repository.copyCompletedWorkoutToOwn(session.id);
        await refreshProgramWorkspace(programId);
        copy = await repository.loadEditableProgram(viewer.id, programId);
      } else {
        if (!import.meta.env.DEV) throw new Error("Sign in before repeating training.");
        const source = programCatalog.find(candidate => programWorkouts(candidate).some(workout => workout.id === session.workoutId));
        const workout = source && programWorkouts(source).find(candidate => candidate.id === session.workoutId);
        if (!source || !workout) throw new Error("The original workout plan is unavailable.");
        copy = copyTrainingForViewer({ ...source, title: workout.title, contentType: "quick_workout", weeks: [{ ...source.weeks[0], workouts: [workout] }] }, viewer.id, viewer.name);
        addLocalTraining(copy);
      }
      setDetail(null);
      selectProgram(copy, {editing: true});
      setActiveView("training");
      notify("Workout ready to repeat · edit it, then start or set a date");
    } catch (error) {
      notify(error instanceof Error ? error.message : "This workout could not be repeated.");
    } finally {
      setProgramAction(null);
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

  async function openAssignment(seed: {
    programId?: string;
    athleteIds?: string[];
    assignRun?: ProgramRunSummary;
  }) {
    try { await programMetadata.flush(); } catch { return; }
    if (repository) {
      const requiredFeatures: LazyWorkspaceFeature[] = ["programs"];
      requiredFeatures.push("coaching");
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
    setAssignmentSeed(seed);
    setModal("assign-program");
  }

  async function assignTraining(
    submission: AssignTrainingSubmission,
  ): Promise<void> {
    const { programId, runId, athleteIds, workoutDates, idempotencyKey } = submission;
    const assignRun = runId ? assignmentRuns.find(run => run.id === runId) : undefined;
    if (runId && !assignRun) throw new Error("This training is no longer available. Choose it again.");
    const sourceProgram = assignRun ? await loadAssignmentRun(assignRun)
      : assignableOwnPrograms.find(candidate => candidate.id === programId);
    if (!sourceProgram) throw new Error("Choose one of your programs.");
    if (!athleteIds.length) throw new Error("Choose at least one athlete.");
    if (athleteIds.includes(viewer.id)) throw new Error("Choose an athlete to assign training.");
    if (assignRun) {
      if (assignRun.athleteId !== viewer.id || assignRun.createdById !== viewer.id) throw new Error("Choose your own training to assign to athletes.");
    } else requireCapability(capabilitiesForProgram(sourceProgram), "assign");
    if (!repository) {
      if (!import.meta.env.DEV) throw new Error("Sign in before assigning training.");
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
        coachedAthletes: previous.coachedAthletes.map((athlete) => {
          const run = demoRuns.find((candidate) => candidate.athleteId === athlete.id);
          return run
            ? { ...athlete, programRuns: [run, ...(athlete.programRuns ?? [])] }
            : athlete;
        }),
      }));
    } else if (assignRun) {
      await repository.assignProgramRun(assignRun.id, athleteIds, workoutDates, idempotencyKey);
    } else {
      await repository.createProgramRuns(
        programId,
        athleteIds,
        workoutDates as ProgramRunWorkoutDate[],
        idempotencyKey,
      );
    }

    const scheduledCount = workoutDates.filter((entry) => entry.plannedDate).length;
    setAssignmentSeed({});
    setModal(null);
    let refreshFailed = false;
    if (repository) {
      try {
        await refreshProgramWorkspace(programId);
        refreshFailed = !(await refreshCoachWorkspace());
      } catch {
        refreshFailed = true;
      }
    }
    const successMessage = `${sourceProgram.title} assigned to ${athleteIds.length} ${athleteIds.length === 1 ? "athlete" : "athletes"}${scheduledCount ? " with dates" : ""}`;
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
    try {
      if (repository) {
        const programId = await repository.createBlankProgram(viewer.id, title);
        await refreshProgramWorkspace(programId);
        selectProgram(
          await repository.loadEditableProgram(viewer.id, programId),
          { returnView: "training", editing: true },
        );
      } else {
        if (!import.meta.env.DEV) throw new Error("Sign in before creating training.");
        const emptyProgram: Program = {
          id: `program-${Date.now()}`,
          athleteId: viewer.id,
          versionId: `version-${Date.now()}`,
          versionStatus: "draft",
          title,
          description: "",
          phase: "Training",
          activeWeek: 1,
          weeks: [
            {
              id: `week-${Date.now()}`,
              index: 1,
              label: "Week 1",
              workouts: [],
            },
          ],
          ownerName: workspace.profile.displayName,
          createdById: viewer.id,
          createdByName: workspace.profile.displayName,
          sourceType: "self",
          sourceLabel: "Created by you",
        };
        addLocalTraining(emptyProgram);
        selectProgram(emptyProgram, {
          editing: true,
          returnView: "training",
        });
      }
      setModal(null);
      setActiveView("training");
      setProgramSource("own");
      notify(
        "Program created",
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
        selectProgram(await repository.loadEditableProgram(viewer.id, workoutId), {editing: true});
      } else {
        if (!import.meta.env.DEV) throw new Error("Sign in before creating training.");
        const now = Date.now();
        const created: Program = {
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
        };
        addLocalTraining(created);
        selectProgram(created, {editing: true});
      }
      setModal(null);
      setActiveView("training");
      setProgramSource("own");
      notify(`${trainingContentUi("quick_workout").label} created`);
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
      if (repository) await repository.endProgramRun(target.id);
      else {
        if (!import.meta.env.DEV) throw new Error("Sign in before removing training.");
        if (activeSession?.programRunId === target.id) throw new Error("Finish your current workout before removing this training.");
        const retain = (schedule: ScheduledWorkout) => schedule.programRunId !== target.id || schedule.status === "completed";
        setWorkspace(previous => ({...previous, programRuns: previous.programRuns?.map(run => run.id === target.id ? {...run, status: "ended", endedAt: new Date().toISOString(), nextWorkout: undefined} : run), scheduledWorkouts: previous.scheduledWorkouts.filter(retain)}));
        setCalendarRangeData(previous => ({...previous, scheduledWorkouts: previous.scheduledWorkouts.filter(retain)}));
      }
      await Promise.all([
        refreshProgramWorkspace(),
        refreshVisibleCalendar(),
      ]);
      if (coachMode === "coach") await refreshCoachWorkspace();
      if (viewingProgramRunId === target.id) {
        setProgram(null);
        setViewingProgramRunId(null);
        setViewingProgramRunDetail(null);
        leaveDetail(programReturnView);
      }
      notify(`${target.title} ended · completed results remain in history`);
      return;
    }
    await performProgramDeletion(target.program);
  }

  function openSourceDates(targetProgram: Program, initialDate?: string) {
    setTrainingDateTarget({ kind: "source", program: targetProgram });
    setScheduleInitialDate(initialDate ?? null);
    setModal("training-dates");
  }

  function openRunDates(run: ProgramRunSummary, initialDate?: string) {
    setTrainingDateTarget({ kind: "run", run });
    setScheduleInitialDate(initialDate ?? null);
    setModal("training-dates");
  }

  async function openSchedule(scheduleId?: string, initialDate?: string) {
    if (!scheduleId) {
      setScheduleInitialDate(initialDate ?? localDateOnly());
      setModal("date-picker");
      void loadWorkspaceFeature("programs");
      return;
    }
    try {
      const schedule = repository
        ? await repository.loadScheduledWorkoutDetail(scheduleId)
        : workspace.scheduledWorkouts.find(candidate => candidate.id === scheduleId);
      if (!schedule) throw new Error("This workout is no longer available.");
      if (schedule.programRunId) {
        const run = await loadProgramRunDetail(schedule.programRunId);
        if (!run) throw new Error("This training is no longer available.");
        openRunDates(run, initialDate);
      } else {
        setTrainingDateTarget({ kind: "occurrence", schedule });
        setScheduleInitialDate(initialDate ?? null);
        setModal("training-dates");
      }
    } catch (error) { notify(error instanceof Error ? error.message : "Dates could not be opened."); }
  }

  async function saveTrainingDates(workoutDates: ProgramRunWorkoutDate[], idempotencyKey: string) {
    const target = trainingDateTarget;
    if (!target) throw new Error("Choose training to set its dates.");
    await programMetadata.flush();
    if (target.kind === "occurrence") {
      await saveSchedule(target.schedule.id, workoutDates[0]?.plannedDate ?? null);
      setTrainingDateTarget(null);
      return;
    }
    let runId: string | undefined = target.kind === "run" ? target.run.id : undefined;
    if (repository) {
      if (target.kind === "source") {
        if (workoutDates.some(entry => entry.plannedDate)) {
          const result = await repository.ensureOwnTrainingRun(target.program.id, workoutDates, idempotencyKey);
          runId = result.runId;
        }
      } else await repository.scheduleProgramRunWorkouts(target.run.id, workoutDates, idempotencyKey);
    } else {
      if (!import.meta.env.DEV) throw new Error("Sign in before setting dates.");
      const source = target.kind === "source" ? target.program : programCatalog.find(program => program.id === target.run.programId);
      if (!source) throw new Error("This training is no longer available.");
      const existingRun = target.kind === "run" ? target.run : workspace.programRuns?.find(run => run.programId === source.id && (run.status === "not_started" || run.status === "in_progress"));
      runId = existingRun?.id ?? crypto.randomUUID();
      const resolvedRunId = runId;
      const schedules = programWorkouts(source).map((workout, index): ScheduledWorkout => {
        const existing = workspace.scheduledWorkouts.find(schedule => schedule.programRunId === resolvedRunId && schedule.workoutId === workout.id);
        const plannedDate = workoutDates.find(entry => entry.workoutId === workout.id)?.plannedDate;
        return existing && ["completed", "in_progress", "skipped"].includes(existing.status) ? existing : {
          id: existing?.id ?? crypto.randomUUID(), programRunId: resolvedRunId, programRunWorkoutId: existing?.programRunWorkoutId ?? resolvedRunId + ":" + workout.id,
          programId: source.id, programVersionId: source.versionId, programTitle: source.title, workoutId: workout.id,
          workoutTitle: workout.title, slotLabel: workout.title, plannedDate, sequenceNumber: index + 1,
          status: "planned", workout: {...workout, plannedDate}, detailsLoaded: true,
        };
      });
      const next = [...schedules].filter(schedule => schedule.status === "planned").sort((a,b) => (a.plannedDate ?? "9999").localeCompare(b.plannedDate ?? "9999"))[0];
      const run: ProgramRunSummary = {...(existingRun ?? sourceDateDetail(source)), id: resolvedRunId, createdAt: existingRun?.createdAt || new Date().toISOString(),
        scheduledWorkouts: schedules.filter(schedule => schedule.plannedDate).length,
        nextWorkout: next ? {id: next.programRunWorkoutId!, title: next.workoutTitle, plannedDate: next.plannedDate, status: next.plannedDate ? "scheduled" : "unscheduled"} : undefined};
      setWorkspace(previous => ({...previous, programRuns:[run,...(previous.programRuns ?? []).filter(candidate => candidate.id !== resolvedRunId)], scheduledWorkouts:[...previous.scheduledWorkouts.filter(schedule => schedule.programRunId !== resolvedRunId),...schedules]}));
      setCalendarRangeData(previous => ({...previous, scheduledWorkouts:[...previous.scheduledWorkouts.filter(schedule => schedule.programRunId !== resolvedRunId),...schedules]}));
    }
    setTrainingDateTarget(null);
    setModal(null);
    try {
      await Promise.all([refreshProgramWorkspace(), refreshVisibleCalendar()]);
      if (target.kind === "run" && target.run.athleteId !== viewer.id) await refreshCoachWorkspace();
      if (runId && (viewingProgramRunId === runId || target.kind === "source" && program?.id === target.program.id)) {
        const run = await loadProgramRunDetail(runId);
        if (run && repository) {
          const frozen = await repository.loadProgramForRun(run.id);
          if (frozen) selectProgram(frozen, {programRunId:run.id,programRunDetail:run,returnView:programReturnView,workoutId:selectedWorkoutId});
        }
      }
      notify("Dates saved");
    } catch { notify("Dates saved · refresh to update this screen"); }
  }

  async function saveSchedule(scheduleId: string, date: string | null) {
    const targetSchedule = workspace.scheduledWorkouts.find(schedule => schedule.id === scheduleId) ?? calendarRangeData.scheduledWorkouts.find(schedule => schedule.id === scheduleId) ?? (repository ? await repository.loadScheduledWorkoutDetail(scheduleId) : undefined);
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
          refreshVisibleCalendar(),
          refreshProgramRunSummaries(),
        ]);
      }
      setModal(null);
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
    if (workoutActionRef.current) return;
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
          ? "Workout restored"
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
      setActiveView("workout");
      pushAppDetailHistory("workout", "workout");
      scrollToAppTop();
    }
  }

  async function openCalendarResults(
    session: CompletedSession,
    athleteId?: string,
    returnView: "training" | "calendar" | "coaching" = "calendar",
  ) {
    setActiveView("workout");
    pushAppDetailHistory("workout-log", "workout", {
      stackOnDetail: returnView === "training" || returnView === "coaching",
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
  ) {
    if (openingCoachProgramId) return;
    const requestId = ++programHistoryRequestRef.current;
    setOpeningCoachProgramId(assignedProgram.id);
    try {
      if (!repository) {
        navigate("training");
        return;
      }
      const programRunId = assignedProgram.id;
      const [nextProgram, runDetail] = await Promise.all([repository.loadProgramForRun(programRunId), repository.loadProgramRunDetail(programRunId)]);
      if (programHistoryRequestRef.current !== requestId) return;
      if (nextProgram) {
        const requestedWorkoutId =
          workoutId ??
          (runDetail
            ? nextIncompleteRunWorkoutId(runDetail.workouts) ??
              runDetail.workouts[0]?.workoutId
            : undefined);
        const targetSlot = runDetail?.workouts.find(slot =>
          slot.workoutId === requestedWorkoutId || slot.effectiveWorkoutId === requestedWorkoutId);
        const targetWorkoutId = targetSlot?.effectiveWorkoutId ?? requestedWorkoutId;
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
      setActiveView("training");
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
    returnView: ViewName = "training",
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
      if (!nextProgram) throw new Error("This training is no longer available.");
      const originalWorkoutId =
        (runDetail && nextIncompleteRunWorkoutId(runDetail.workouts)) ??
        runDetail?.workouts[0]?.workoutId;
      const nextSlot = runDetail?.workouts.find(slot => slot.workoutId === originalWorkoutId);
      const workoutId = nextSlot?.effectiveWorkoutId ?? originalWorkoutId;
      selectProgram(nextProgram, {
        programRunId: run.id,
        programRunDetail: runDetail,
        workoutId,
        returnView,
      });
      setActiveView("training");
      scrollToAppTop();
    } catch (error) {
      if (programHistoryRequestRef.current !== requestId) return;
      notify(
        error instanceof Error
          ? error.message
          : "This training could not be opened",
      );
    } finally {
      setOpeningCoachProgramId(null);
    }
  }

  async function openOwnRunWorkout(slot: ProgramRunWorkout) {
    if (slot.status === "completed" && viewingProgramRun?.athleteId === viewer.id) {
      openRunWorkoutResults(viewingProgramRun, slot);
      return;
    }
    if (openingCoachProgramId || viewingProgramRun?.athleteId !== viewer.id ||
      slot.runId !== viewingProgramRun.id || !slot.scheduledWorkoutId ||
      (slot.status !== "scheduled" && slot.status !== "in_progress")) return;
    const requestId = ++programHistoryRequestRef.current;
    setOpeningCoachProgramId(slot.id);
    try {
      const schedule = repository
        ? await repository.loadScheduledWorkoutDetail(slot.scheduledWorkoutId)
        : workspace.scheduledWorkouts.find(candidate => candidate.id === slot.scheduledWorkoutId);
      if (programHistoryRequestRef.current !== requestId) return;
      if (!schedule || (schedule.status !== "planned" && schedule.status !== "in_progress")) {
        throw new Error("This scheduled workout is no longer available.");
      }
      setWorkspace(previous => ({ ...previous,
        scheduledWorkouts: [schedule, ...previous.scheduledWorkouts.filter(candidate => candidate.id !== schedule.id)],
      }));
      if (schedule.status === "in_progress") {
        if (activeSession?.scheduledWorkoutId === schedule.id) showActiveWorkout("training");
        else await startWorkout(schedule, "training");
      } else if (await openWorkoutPreview(schedule, "training")) {
        setActiveView("workout");
        scrollToAppTop();
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "This workout could not be opened.");
    } finally {
      setOpeningCoachProgramId(null);
    }
  }

  function openRunWorkoutResults(run: ProgramRunSummary, slot: ProgramRunWorkout) {
    if (!slot.sessionId) return;
    void openCalendarResults({id: slot.sessionId, workoutTitle: slot.title,
      programRunId: run.id, programRunWorkoutId: slot.id, workoutId: slot.effectiveWorkoutId ?? slot.workoutId,
      date: slot.completedForDate ?? slot.plannedDate ?? slot.completedAt?.slice(0, 10) ?? "",
      durationMinutes: slot.estimatedMinutes ?? 0, rpe: slot.sessionRpe ?? 0,
    }, run.athleteId === viewer.id ? undefined : run.athleteId, run.athleteId === viewer.id ? "training" : "coaching");
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
      "training",
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
      );
      return;
    }
    if (entry.programRunId && repository) {
      void repository.loadProgramRunDetail(entry.programRunId).then(run => { if (run) void openAthleteProgram(athlete, run, entry.workoutId); }).catch(error => notify(error instanceof Error ? error.message : "Training could not be opened."));
    }
  }

  const showingWorkoutPreview = Boolean(workoutPreviewSchedule);
  const displayedSchedule = workoutPreviewSchedule ?? todaySchedule;

  return (
    <main className="app-shell">
      <Sidebar
        activeView={
          detail?.returnView ??
          (activeView === "training" && program ? programReturnView : activeView === "workout" ? activeWorkoutReturnView : activeView)
        }
        onNavigate={navigate}
        viewer={viewer}
        profile={workspace.profile}
        onAccount={() => guardProgramNavigation(() => setModal("account"))}
        onSignOut={() => guardProgramNavigation(onSignOut)}
        coachingRequestCount={workspace.pendingCoachInvites.length}
      />

      <section
        className={cn(
          "app-content",
          (completedWorkoutView ||
            showingWorkoutPreview ||
            (activeView === "workout" && activeSession && activeWorkoutVisible) ||
            (activeView === "training" && program)) &&
            "has-detail-navigation",
        )}
      >
        <div className="mobile-topbar">
          <button className="brand-mark" onClick={() => navigate("training")}>
            LL
          </button>
          <strong>Lift Log</strong>
          <button
            className="avatar mobile-avatar"
            aria-label="Open my account"
            title="My account"
            onClick={() => guardProgramNavigation(() => setModal("account"))}
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

        {activeView === "workout" && completedWorkoutView && (
          <CompletedWorkoutView
            state={completedWorkoutView}
            onRepeat={() => void repeatCompletedWorkout(completedWorkoutView.session)}
            repeating={programAction?.id === completedWorkoutView.session.id}
            viewerId={viewer.id}
            weightUnit={workspace.profile.weightUnit}
            distanceUnit={workspace.profile.distanceUnit}
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
              if (returnView === "training") {
                leaveDetail("training");
              } else {
                leaveDetail(returnView);
              }
            }}
          />
        )}
        {activeView === "workout" &&
          !completedWorkoutView &&
          ((showingWorkoutPreview && workoutPreviewSchedule) ||
            (activeSession &&
              activeWorkoutVisible &&
              todayWorkout &&
              workoutFocus)) && (
          <WorkoutView
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
            distanceUnit={workspace.profile.distanceUnit}
            plannedDate={
              showingWorkoutPreview
                ? workoutPreviewSchedule!.plannedDate
                : workoutFocus!.plannedDate
            }
            workoutStarted={!showingWorkoutPreview && workoutStarted}
            workoutAction={showingWorkoutPreview ? null : workoutAction}
            setLogs={showingWorkoutPreview ? starterSetLogs(workoutPreviewSchedule!.workout, null) : setLogs}
            resultLogs={showingWorkoutPreview ? starterResultLogs(workoutPreviewSchedule!.workout, null) : resultLogs}
            previousValues={previousWorkoutValues ?? undefined}
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
                showingWorkoutPreview ? workoutPreviewReturnView : "training",
              )
            }
            allowStart={!showingWorkoutPreview || !activeSession}
            onFinish={finishWorkout}
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
                ? () => leaveDetail(activeWorkoutReturnView)
                : undefined
            }
            backLabel={destinationLabel(showingWorkoutPreview ? workoutPreviewReturnView : activeWorkoutReturnView)}
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
            onEditWorkout={showingWorkoutPreview && workoutPreviewSchedule?.status === "planned" && workoutPreviewSchedule.programRunWorkoutId
              ? () => void editUpcomingWorkout(workoutPreviewSchedule, workoutPreviewReturnView)
              : undefined}
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
        {activeView === "training" && program && currentWeek && (
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
            metadata={programMetadata.value ?? { title: program.title, description: program.description, status: "saved", error: "" }}
            onMetadataChange={programMetadata.change}
            programRun={viewingProgramRun}
            action={
              programAction?.id === program.id ? programAction.kind : null
            }
            mutationPending={builderMutationPending}
            viewerId={viewer.id}
            capabilities={capabilitiesForViewedProgram(program)}
            editing={programEditing}
            onEdit={() => void editProgram(program, selectedWorkout?.id)}
            backLabel={program.editableRunId ? "Workout" : destinationLabel(programReturnView)}
            workouts={programWorkoutSequence}
            selectedWorkout={selectedWorkout}
            runWorkouts={viewingProgramRunDetail?.workouts ?? []}
            onOpenRunWorkout={viewingProgramRun?.athleteId === viewer.id ? (slot) => void openOwnRunWorkout(slot) : undefined}
            onStartRunWorkout={viewingProgramRun?.athleteId === viewer.id ? slot => void startRunWorkout(viewingProgramRun, slot) : undefined}
            onOpenRunWorkoutResults={viewingProgramRun ? slot => openRunWorkoutResults(viewingProgramRun, slot) : undefined}
            onEditRunWorkout={viewingProgramRun ? (slot) => void editRunWorkout(slot) : undefined}
            onStart={!program.editableRunId && !viewingProgramRunId && capabilitiesForProgram(program).schedule ? () => void startTraining({ programId: program.id, workoutId: selectedWorkout?.id }, program.id) : undefined}
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
            onAddWorkout={() => guardProgramNavigation(() => setModal("workout"))}
            onDeleteWorkout={deleteSelectedWorkout}
            onReorderWorkouts={reorderWorkouts}
            onAddExercise={addExerciseToWorkout}
            onCreateCustomExercise={addCustomExerciseToWorkout}
            onEditItem={(item) => {
              setPrescriptionItem(item);
              setNewPrescriptionItemId(null);
              setModal("prescription");
            }}
            onRemoveItem={removeWorkoutItem}
            onReorderItems={reorderWorkoutItems}
            onSave={() => void finishProgramEditing()}
            onDuplicate={
              capabilitiesForViewedProgram(program).copyToOwn
                ? () =>
                    void duplicateProgram(
                      program,
                      viewingProgramRun,
                    )
                : undefined
            }
            onBack={() => guardProgramNavigation(() => {
              if (program.editableRunId) { void returnFromWorkoutEditor(); return; }
              const returnView = programReturnView;
              setProgram(null);
              setViewingProgramRunId(null);
              setViewingProgramRunDetail(null);
              if (program.athleteId !== viewer.id) {
                setCoachMode("coach");
              }
              leaveDetail(returnView);
            })}
            onAssignProgram={
              viewingProgramRun && viewingProgramRun.athleteId === viewer.id && viewingProgramRun.createdById === viewer.id && (workspace.coachedAthletes.length > 0 || (workspace.coachingAccess?.coachedAthleteCount ?? 0) > 0)
                ? () => void openAssignment({ programId: program.id, assignRun: viewingProgramRun })
                : !viewingProgramRunId && capabilitiesForProgram(program).assign
                ? () => void openAssignment({
                    programId: program.id,
                  })
                : undefined
            }
            onEditWorkout={() => guardProgramNavigation(() => setModal("workout-settings"))}
            onEndProgram={viewingProgramRun && (viewingProgramRun.status === "not_started" || viewingProgramRun.status === "in_progress")
              ? () => { setContentDeleteTarget({ kind: "program-run", id: viewingProgramRun.id, title: viewingProgramRun.title, contentType: viewingProgramRun.contentType }); setModal("delete-content"); }
              : undefined}
            onSetDates={!program.editableRunId && (viewingProgramRun ? viewingProgramRun.status === "not_started" || viewingProgramRun.status === "in_progress" : capabilitiesForProgram(program).schedule)
              ? () => viewingProgramRun ? openRunDates(viewingProgramRun) : openSourceDates(program)
              : undefined}
            renderWorkoutItem={(item) => (
              <WorkoutLogItem
                item={item}
                category={exerciseCategoryForItem(item)}
                active={false}
                weightUnit={workspace.profile.weightUnit}
                showSetControls={false}
                builderPreview
                distanceUnit={workspace.profile.distanceUnit}
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
        {activeView === "training" &&
          !program && (
          <Suspense fallback={<div className="feature-load-status" role="status"><LoaderCircle size={16} className="spin" />Opening training…</div>}>
            <ProgramsHome
              programs={programCatalog}
              programRuns={workspace.programRuns ?? []}
              hasMoreRuns={Boolean(workspace.hasMoreProgramRuns)}
              runsLoading={ownRunsLoadingMore}
              runsError={ownRunsLoadError}
              onLoadMoreRuns={() => void loadMoreOwnRuns()}
              historicalRuns={historicalRuns}
              historyRunsLoading={historyRunsLoading}
              historyRunsError={historyRunsError}
              historyRunsHasMore={Boolean(historyRunsCursor)}
              onLoadHistoryRuns={() => void loadRunHistory()}
              onLoadMoreHistoryRuns={() => void loadRunHistory(true)}
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
              onAssign={(targetProgram) => void openAssignment({ programId: targetProgram.id })}
              onAssignRun={workspace.coachedAthletes.length > 0 || (workspace.coachingAccess?.coachedAthleteCount ?? 0) > 0
                ? (run) => void openAssignment({ programId: run.programId, assignRun: run })
                : undefined}
              onDelete={deleteOwnProgram}
              onSource={setProgramSource}
              onCreate={() => setModal("program")}
              onCreateWorkout={() => setModal("quick-workout")}
              onSetDates={openSourceDates}
              onStartProgram={(source, workoutId) => void startTraining({ programId: source.id, workoutId }, source.id)}
              onOpenRun={(run) => void openOwnProgramRun(run, "training")}
              onSetRunDates={openRunDates}
              onStartRunWorkout={(run, slot) => void startRunWorkout(run, slot)}
              onEditRunWorkout={(run, slot) => void editRunWorkout(slot, run, "training")}
              onRestoreRunWorkout={(run, slot) => void restoreRunWorkout(run, slot).catch(error => notify(error instanceof Error ? error.message : "Workout could not be restored."))}
              onLoadRunDetail={run => loadProgramRunDetail(run.id)}
              onLoadProgramDetail={loadTrainingProgram}
              activeWorkout={activeSession ? { title: todayWorkout?.title ?? "Workout in progress", programRunId: activeSession.programRunId } : undefined}
              onResumeWorkout={() => showActiveWorkout()}
              startingTrainingId={startingScheduleId}
              completedSessions={completedHistory}
              completedLoading={completedHistoryLoading}
              completedError={completedHistoryError}
              completedHasMore={Boolean(completedHistoryCursor)}
              onLoadCompleted={() => void loadCompletedHistory()}
              onLoadMoreCompleted={() => void loadCompletedHistory(true)}
              onOpenCompleted={session => void openCalendarResults(session, undefined, "training")}
              onOpenRunWorkoutResults={openRunWorkoutResults}
              onEndRun={(run) => {
                setContentDeleteTarget({
                  kind: "program-run",
                  id: run.id,
                  title: run.title,
                  contentType: run.contentType,
                });
                setModal("delete-content");
              }}
              onRepeatRun={(run) => void repeatRunForEditing(run)}
              onLoadMore={() => void loadMorePrograms()}
            />
          </Suspense>
        )}
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
                  void saveSchedule(scheduleId, date).catch(error => notify(error instanceof Error ? error.message : "The date could not be changed."));
                }}
                onRemoveSchedule={(scheduleId) => {
                  void saveSchedule(scheduleId, null).catch(error => notify(error instanceof Error ? error.message : "The date could not be removed."));
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
              void openAssignment({
                athleteIds: [athlete.id],
              })
            }
            onScheduleAthlete={(athlete, run) => run ? openRunDates(run) : void openAssignment({athleteIds:[athlete.id]})}
            onUnassignAthlete={(_athlete, run) => { setContentDeleteTarget({kind:"program-run",id:run.id,title:run.title,contentType:run.contentType}); setModal("delete-content"); }}
            onRepeatAthlete={(_athlete, run) => void repeatRunForEditing(run)}

          />
        )}
      </section>

      <Suspense fallback={<ModalShell title="Opening editor" onClose={() => setModal(null)}><p role="status">Loading…</p></ModalShell>}>
      {modal === "exercise" && (
        <ExerciseModal
          exercise={exerciseEditing}
          onClose={() => {
            setExerciseEditing(null);
            setModal(exerciseDetailTarget ? "exercise-details" : null);
          }}
          onSave={(name, discipline, category, mode, fields, cue, videoLinks) =>
            exerciseEditing
              ? updatePersonalExercise(
                  exerciseEditing,
                  name,
                  discipline,
                  category,
                  mode,
                  fields,
                  cue,
                  videoLinks,
                )
              : addPersonalExercise(
                  name,
                  discipline,
                  category,
                  mode,
                  fields,
                  cue,
                  videoLinks,
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
          <AssignTrainingDialog
            programs={assignableOwnPrograms}
            runs={assignmentRuns}
            initialRunId={assignmentSeed.assignRun?.id}
            onLoadRun={loadAssignmentRun}
            hasMoreRuns={Boolean(workspace.hasMoreProgramRuns)}
            loadingMoreRuns={ownRunsLoadingMore}
            onLoadMoreRuns={() => void loadMoreOwnRuns()}
            athletes={workspace.coachedAthletes}
            hasMorePrograms={Boolean(programCursor)}
            loadingMorePrograms={programsLoadingMore}
            onLoadMorePrograms={() => void loadMorePrograms()}
            hasMoreAthletes={Boolean(coachAthleteCursor)}
            loadingMoreAthletes={coachAthletesLoadingMore}
            onLoadMoreAthletes={() => void loadMoreCoachAthletes()}
            initialProgramId={
              assignmentSeed.assignRun ? undefined : assignmentSeed.programId
            }
            initialAthleteIds={assignmentSeed.athleteIds}
            onLoadProgram={loadTrainingProgram}
            onClose={() => {
              setAssignmentSeed({});
                        setModal(null);
            }}
            onAssign={assignTraining}
          />
        </Suspense>
      )}
      {modal === "training-dates" && trainingDateTarget && (
        <Suspense fallback={<div role="status">Opening dates…</div>}>
          <TrainingDatesEditor
            run={trainingDateTarget.kind === "run" ? trainingDateTarget.run : trainingDateTarget.kind === "source" ? sourceDateDetail(trainingDateTarget.program) : occurrenceDateDetail(trainingDateTarget.schedule, viewer.id)}
            initialDate={scheduleInitialDate ?? undefined}
            athleteName={trainingDateTarget.kind === "run" && trainingDateTarget.run.athleteId !== viewer.id ? workspace.coachedAthletes.find(athlete => athlete.id === trainingDateTarget.run.athleteId)?.name : undefined}
            onLoad={loadTrainingDateDetail}
            onClose={() => { setTrainingDateTarget(null); setModal(null); }}
            onSave={saveTrainingDates}
          />
        </Suspense>
      )}
      {modal === "program" && (
        <ProgramModal
          targetName={workspace.profile.displayName}
          onClose={() => {
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
      {modal === "date-picker" && (
        <Suspense fallback={<div role="status">Opening training…</div>}>
          <TrainingDatePicker programs={programCatalog} runs={workspace.programRuns ?? []} viewerId={viewer.id}
            initialDate={scheduleInitialDate ?? localDateOnly()}
            onChooseProgram={target => openSourceDates(target, scheduleInitialDate ?? undefined)}
            onChooseRun={run => openRunDates(run, scheduleInitialDate ?? undefined)}
            onClose={() => setModal(null)}
            loading={loadingWorkspaceFeature === "programs"}
            error={workspaceFeatureError?.feature === "programs" ? workspaceFeatureError.message : programsLoadError || ownRunsLoadError}
            onRetry={() => { if (workspaceFeatureError?.feature === "programs") void loadWorkspaceFeature("programs"); else { if (programsLoadError) void loadMorePrograms(); if (ownRunsLoadError) void loadMoreOwnRuns(); } }}
            hasMorePrograms={Boolean(programCursor)} loadingMorePrograms={programsLoadingMore} onLoadMorePrograms={() => void loadMorePrograms()}
            hasMoreRuns={workspace.hasMoreProgramRuns} loadingMoreRuns={ownRunsLoadingMore} onLoadMoreRuns={() => void loadMoreOwnRuns()}
          />
        </Suspense>
      )}
      {modal === "account" && (
        <AccountModal
          profile={workspace.profile}
          email={viewer.email}
          onClose={() => setModal(null)}
          onSave={saveProfile}
          onSignOut={() => guardProgramNavigation(onSignOut)}
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
      </Suspense>
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
      <button className="brand" onClick={() => onNavigate("training")}>
        <span className="brand-mark">LL</span>
        <span>
          <strong>Lift Log</strong>
          <small>Training workspace</small>
        </span>
      </button>
      <nav className="main-nav" aria-label="Main navigation">
        {navigationItems.map((item) => {
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

function WorkoutView({
  program,
  viewerId,
  workout,
  weightUnit,
  distanceUnit,
  exerciseCategoryForItem,
  timing,
  plannedDate,
  workoutStarted,
  workoutAction,
  setLogs,
  resultLogs,
  previousValues,
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
  backLabel = "Training",
  onReschedule,
  onEditWorkout,
  onRemoveFromCalendar,
}: {
  program?: Program;
  viewerId: string;
  workout: PlannedWorkout;
  weightUnit: OwnProfile["weightUnit"];
  distanceUnit: OwnProfile["distanceUnit"];
  exerciseCategoryForItem: (item: WorkoutItem) => string;
  timing: "active" | "overdue" | "today" | "future";
  plannedDate?: string;
  workoutStarted: boolean;
  workoutAction: "starting" | "finishing" | null;
  setLogs: Record<string, SetLog[]>;
  resultLogs: Record<string, Record<string, string>>;
  previousValues?: PreviousWorkoutValues;
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
  onEditWorkout?: () => void;
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
      : "Planned workout";
  const timingLabel =
    timing === "active"
      ? plannedDate
        ? `Workout in progress · ${dateLabel}`
        : "Workout in progress"
      : timing === "overdue"
        ? `Overdue · originally scheduled ${dateLabel}`
        : timing === "today"
          ? "Workout · Today"
          : `Workout · ${dateLabel}`;
  const workoutActions: ObjectAction[] = [];
  const actionPending = statusAction !== null || workoutAction !== null || (workoutStarted && !editable);
  if (viewMode && onEditWorkout) workoutActions.push({
    label: "Edit workout", accessibleLabel: "Edit workout", icon: actionUi.edit.icon, onClick: onEditWorkout, disabled: actionPending,
  });
  if (viewMode && onReschedule) workoutActions.push({
    label: actionUi.reschedule.label, accessibleLabel: "Reschedule workout",
    icon: actionUi.reschedule.icon, onClick: onReschedule, disabled: actionPending,
  });
  if (viewMode && onRemoveFromCalendar) workoutActions.push({
    label: "Remove from calendar", accessibleLabel: "Remove workout from calendar",
    icon: CalendarMinus, onClick: onRemoveFromCalendar, disabled: actionPending,
  });
  if (workoutStarted && onSetPlanned) workoutActions.push({
    label: statusAction === "planned" ? "Restoring…" : "Restore workout",
    accessibleLabel: "Restore workout", icon: RefreshCw, onClick: onSetPlanned,
    loading: statusAction === "planned", disabled: actionPending,
  });
  if ((viewMode || workoutStarted) && onSkip) workoutActions.push({
    label: statusAction === "skipped" ? "Skipping…" : "Skip workout",
    accessibleLabel: "Skip workout", icon: X, onClick: onSkip,
    loading: statusAction === "skipped", disabled: actionPending, destructive: true,
  });
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
          timing === "active"
              ? "Workout in progress"
              : viewMode
                ? "Workout preview"
                : "Workout"
        }
        description={planDescription}
      >
        <div className={`workout-preview-actions${workoutStarted ? " started" : ""}`}>
        {program && (
          <SourceTag
            presentation={presentProgramProvenance(program, viewerId)}
          />
        )}
        <ObjectActionMenu title={workout.title} actions={workoutActions} />
        </div>
      </PageHeader>
      {workoutStarted && !editable && (
        <div className="feature-load-status" role="status">
          <span>{editingBlockedReason ?? "Preparing your saved workout…"}</span>
          {editingBlockedReason && <button type="button" className="text-button" onClick={onRetryEditing}>Try again</button>}
        </div>
      )}
      <div className="today-layout">
        <fieldset className="workout-card" aria-label="Workout log" disabled={workoutStarted && (!editable || workoutAction === "finishing" || statusAction !== null)}>
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
              {workout.durationMinutes !== undefined && <><Clock3 size={14} />{workout.durationMinutes} min</>}
            </span>
          </div>
          <section className="workout-section workout-exercise-sequence">
            {previousValues && Object.values(previousValues.items).some((item) => [...item.setLogs.flatMap((set) => Object.values(set)),
              ...Object.entries(item.resultLog).filter(([key]) => !key.endsWith(".completed")).map(([, value]) => value)].some((value) => value?.trim())) && <p className="previous-workout-caption">
              Last: {new Date(previousValues.completedAt).toLocaleDateString("en", { day: "numeric", month: "short" })} · previous results appear inside the cells.
            </p>}
            {workout.sections.flatMap((section) => section.items).map((item) => (
              <div className="workout-sequence-item" key={item.id}>
                <WorkoutLogItem
                  item={item}
                  category={exerciseCategoryForItem(item)}
                  active={workoutStarted}
                  weightUnit={weightUnit}
                  distanceUnit={distanceUnit}
                  setLogs={setLogs[item.id] ?? emptySetLogs}
                  resultLog={resultLogs[item.id] ?? emptyResultLog}
                  previousLog={previousValues?.items[item.id]}
                  onUpdateSet={onUpdateSet}
                  onAddSet={onAddSet}
                  onRemoveSet={onRemoveSet}
                  onUpdateResult={onUpdateResult}
                />
              </div>
            ))}
          </section>
          {!workoutStarted && allowStart && (
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
                <span id="session-rpe-label">Session RPE · optional</span>
                <small>How did the whole session feel? Tap again to clear.</small>
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
              <small className="session-finish-hint">Remaining sets are saved as completed. Remove any you skipped.</small>
            </div>
          )}
        </fieldset>
      </div>
    </>
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
  distanceUnit = "km",
  showSetControls = true,
  builderPreview = false,
  setLogs,
  resultLog,
  previousLog,
  onUpdateSet,
  onAddSet,
  onRemoveSet,
  onUpdateResult,
}: {
  item: WorkoutItem;
  category?: string;
  active: boolean;
  weightUnit?: OwnProfile["weightUnit"];
  distanceUnit?: OwnProfile["distanceUnit"];
  showSetControls?: boolean;
  builderPreview?: boolean;
  setLogs: SetLog[];
  resultLog: Record<string, string>;
  previousLog?: PreviousWorkoutValues["items"][string];
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
  const note = workoutItemNotes(item);
  const multipleVideos = (item.videoLinks?.length ?? 0) > 1;
  const videos = <ExerciseVideoLinks url={item.videoUrl} videoLinks={item.videoLinks} exerciseName={item.title} />;
  const fields = workoutLogFields(item);
  const canUseTargets = active && item.mode !== "intervals" && (item.mode === "sets" ? setLogs : [resultLog]).some((row, index) =>
    Object.entries(plannedRecordingValues(item, index)).some(([field]) => !row[field as keyof typeof row]?.trim()));
  function useTargets() {
    if (item.mode === "sets") setLogs.forEach((row, index) => {
      for (const [field, value] of Object.entries(plannedRecordingValues(item, index)))
        if (!row[field as keyof SetLog]?.trim() && value !== undefined) onUpdateSet(item.id, index, field as keyof SetLog, value);
    });
    else for (const [field, value] of Object.entries(plannedRecordingValues(item)))
      if (!resultLog[field]?.trim() && value !== undefined) onUpdateResult(item.id, field, value);
  }
  const plannedRpeVaries = prescriptionEntryVaries(item, "targetRpe");
  const prescriptionSummary = (
    <div className="exercise-prescription">
      <span>{prescriptionLabel(item, weightUnit, distanceUnit)}</span>
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
            {!multipleVideos && videos}
          </span>
          {multipleVideos && videos}
          <small className="exercise-note">{note}</small>
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
                {!multipleVideos && videos}
              </div>
              {prescriptionSummary}
            </>
          ) : (
            <div className="exercise-name-with-icon">
              <ExerciseCategoryMark category={category ?? item.category} compact />
              <strong>{item.title}</strong>
              {!multipleVideos && videos}
            </div>
          )}
          {builderPreview && <small className="exercise-note">{note}</small>}
        </div>
        {!builderPreview && prescriptionSummary}
      </div>
      {multipleVideos && videos}
      {!builderPreview && note && <small className="exercise-note">{note}</small>}
      {canUseTargets && <button className="text-button use-targets" aria-label={`Use targets for ${item.title}`}
        title="Fill empty results from numeric targets. RPE stays unrecorded." onClick={useTargets}><Check size={14} /> Use targets</button>}
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
            {fields.includes("duration") && <span>Time sec</span>}
            {fields.includes("distance") && <span>Distance {distanceUnit}</span>}
            {fields.includes("load") && <span>Load {weightUnit}</span>}
            {fields.includes("heartRate") && <span>Avg HR</span>}
            {fields.includes("rpe") && <span>Actual RPE</span>}
            <span />
          </div>
          {setLogs.map((row, index) => (
            <div className="set-row" key={index}>
              <span>{index + 1}</span>
              {fields.includes("reps") && (
                <GhostValueCell previous={previousLog?.setLogs[index]?.reps}>
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
                </GhostValueCell>
              )}
              {fields.includes("duration") && <GhostValueCell previous={durationSecondsValue(previousLog?.setLogs[index]?.duration ?? "")}><DurationInput aria-label={`${item.title}, set ${index + 1}, time in seconds`} disabled={!active}
                value={row.duration ?? ""} onChange={(value) => onUpdateSet(item.id, index, "duration", value)} placeholder="—" /></GhostValueCell>}
              {fields.includes("distance") && <GhostValueCell previous={distanceInputValue(previousLog?.setLogs[index]?.distance ?? "", distanceUnit)}><MeasurementInput aria-label={`${item.title}, set ${index + 1}, distance in ${distanceUnit}`} disabled={!active}
                quantity="distance" unit={distanceUnit} value={row.distance ?? ""} onChange={(value) => onUpdateSet(item.id, index, "distance", value)} placeholder="—" /></GhostValueCell>}
              {fields.includes("load") && (
                <GhostValueCell previous={weightInputValue(previousLog?.setLogs[index]?.load ?? "", weightUnit)}>
                <MeasurementInput
                  aria-label={`${item.title}, set ${index + 1}, load in ${weightUnit}`}
                  disabled={!active}
                  quantity="weight"
                  unit={weightUnit}
                  value={row.load}
                  onChange={(value) => onUpdateSet(item.id, index, "load", value)}
                  placeholder="—"
                />
                </GhostValueCell>
              )}
              {fields.includes("heartRate") && <GhostValueCell previous={previousLog?.setLogs[index]?.heartRate}><input aria-label={`${item.title}, set ${index + 1}, average heart rate`} disabled={!active}
                inputMode="numeric" value={row.heartRate ?? ""} placeholder="—" onChange={(event) => onUpdateSet(item.id, index, "heartRate", event.target.value)} /></GhostValueCell>}
              {fields.includes("rpe") && (
                <GhostValueCell previous={previousLog?.setLogs[index]?.rpe}>
                <RpeSelect
                  ariaLabel={`${item.title}, set ${index + 1}, actual RPE`}
                  disabled={!active}
                  value={row.rpe}
                  onChange={(value) => onUpdateSet(item.id, index, "rpe", value)}
                />
                </GhostValueCell>
              )}
              {showSetControls ? (
                <button
                  disabled={!active}
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
          {active && setLogs.length === 0 && <small className="session-finish-hint">No sets · skipped</small>}
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
          distanceUnit={distanceUnit}
          resultLog={resultLog}
          previousLog={previousLog?.resultLog}
          onUpdate={(field, value) => onUpdateResult(item.id, field, value)}
        />
      )}
      {item.mode === "result" && (
        <div className="result-fields">
          {fields.includes("duration") && (
            <DurationField
              disabled={!active}
              value={resultLog.duration ?? ""}
              previous={previousLog?.resultLog.duration}
              onChange={(value) => onUpdateResult(item.id, "duration", value)}
            />
          )}
          {fields.includes("distance") && (
            <ResultInput
              label="Distance"
              unit={distanceUnit}
              disabled={!active}
              value={resultLog.distance ?? ""}
              previous={distanceInputValue(previousLog?.resultLog.distance ?? "", distanceUnit)}
              onChange={(value) => onUpdateResult(item.id, "distance", value)}
              measurement={{ quantity: "distance", unit: distanceUnit }}
            />
          )}
          {fields.includes("load") && (
            <ResultInput
              label="Load"
              unit={weightUnit}
              disabled={!active}
              value={resultLog.load ?? ""}
              previous={weightInputValue(previousLog?.resultLog.load ?? "", weightUnit)}
              onChange={(value) => onUpdateResult(item.id, "load", value)}
              measurement={{ quantity: "weight", unit: weightUnit }}
            />
          )}
          {fields.includes("heartRate") && (
            <ResultInput
              label="Avg HR"
              unit="bpm"
              disabled={!active}
              value={resultLog.heartRate ?? ""}
              previous={previousLog?.resultLog.heartRate}
              onChange={(value) => onUpdateResult(item.id, "heartRate", value)}
            />
          )}
          {fields.includes("rpe") && (
            <RpeResultInput
              label="Actual RPE"
              disabled={!active}
              value={resultLog.rpe ?? ""}
              previous={previousLog?.resultLog.rpe}
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
  distanceUnit,
  resultLog,
  previousLog,
  onUpdate,
}: {
  item: WorkoutItem;
  active: boolean;
  distanceUnit: OwnProfile["distanceUnit"];
  resultLog: Record<string, string>;
  previousLog?: Record<string, string>;
  onUpdate: (field: string, value: string) => void;
}) {
  const rounds = intervalPrescriptionEntries(item);
  const fields = workoutLogFields(item);
  const metricFields = (["duration", "distance", "heartRate", "rpe"] as const).filter(
    (field) => fields.includes(field),
  );
  const completedRounds = rounds.filter((_, index) =>
    resultLog[`round.${index}.completed`] === "1",
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
        const skipped = resultLog[completedKey] === "0";
        const previousRound = (field: string) => previousLog?.[`round.${index}.${field}`];
        function toggleSkipped() {
          const targets = plannedIntervalRecordingValues(item);
          onUpdate(completedKey, skipped ? "1" : "0");
          for (const field of metricFields) {
            const key = `round.${index}.${field}`;
            onUpdate(key, skipped ? targets[key] ?? "" : "");
          }
        }
        return (
          <div className={cn("interval-log-row", skipped && "round-skipped")} key={index}>
            {fields.includes("rounds") ? (
              <button
                type="button"
                className="interval-round-toggle round-skip-control"
                disabled={!active}
                aria-label={`${skipped ? "Restore" : "Skip"} round ${index + 1}`}
                title={`${skipped ? "Restore" : "Skip"} round ${index + 1}`}
                onClick={toggleSkipped}
              >
                {index + 1}{skipped ? <RefreshCw size={12} /> : <X size={12} />}
              </button>
            ) : (
              <span className="interval-round-number">{index + 1}</span>
            )}
            <span className="interval-plan-cell">
              {skipped ? "Skipped" : <>{round.workSeconds ?? "—"}/{round.restSeconds ?? "—"}<small>s</small></>}
            </span>
            {fields.includes("duration") && (
              <GhostValueCell previous={previousRound("duration")}>
              <input
                aria-label={`${item.title}, round ${index + 1}, actual duration in seconds`}
                disabled={!active || skipped}
                inputMode="numeric"
                placeholder="sec"
                value={resultLog[`round.${index}.duration`] ?? ""}
                onChange={(event) =>
                  onUpdate(`round.${index}.duration`, event.target.value)
                }
              />
              </GhostValueCell>
            )}
            {fields.includes("distance") && (
              <GhostValueCell previous={distanceInputValue(previousRound("distance") ?? "", distanceUnit)}>
              <MeasurementInput
                aria-label={`${item.title}, round ${index + 1}, distance in ${distanceUnit === "mi" ? "miles" : "kilometres"}`}
                disabled={!active || skipped}
                quantity="distance"
                unit={distanceUnit}
                placeholder={distanceUnit}
                value={resultLog[`round.${index}.distance`] ?? ""}
                onChange={(value) =>
                  onUpdate(`round.${index}.distance`, value)
                }
              />
              </GhostValueCell>
            )}
            {fields.includes("heartRate") && (
              <GhostValueCell previous={previousRound("heartRate")}>
              <input
                aria-label={`${item.title}, round ${index + 1}, average heart rate`}
                disabled={!active || skipped}
                inputMode="numeric"
                placeholder="bpm"
                value={resultLog[`round.${index}.heartRate`] ?? ""}
                onChange={(event) =>
                  onUpdate(`round.${index}.heartRate`, event.target.value)
                }
              />
              </GhostValueCell>
            )}
            {fields.includes("rpe") && (
              <GhostValueCell previous={previousRound("rpe")}>
              <RpeSelect
                ariaLabel={`${item.title}, round ${index + 1}, actual RPE`}
                disabled={!active || skipped}
                value={resultLog[`round.${index}.rpe`] ?? ""}
                onChange={(value) => onUpdate(`round.${index}.rpe`, value)}
              />
              </GhostValueCell>
            )}
          </div>
        );
      })}
      <div className="interval-log-summary">
        <span>{completedRounds}/{rounds.length} rounds completed</span>
        <span>{Math.round(plannedSeconds / 60)} min planned</span>
        {totalDistance > 0 && <span>{formatDistanceKilometres(totalDistance, distanceUnit)} {distanceUnit} total</span>}
      </div>
    </div>
  );
}

function RpeResultInput({
  label,
  disabled,
  value,
  previous,
  onChange,
}: {
  label: string;
  disabled: boolean;
  value: string;
  previous?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="result-input rpe-result-input">
      <span>{label}</span>
      <GhostValueCell previous={previous}><RpeSelect disabled={disabled} value={value} onChange={onChange} /></GhostValueCell>
    </label>
  );
}

function ResultInput({
  label,
  unit,
  disabled,
  value,
  previous,
  onChange,
  measurement,
}: {
  label: string;
  unit: string;
  disabled: boolean;
  value: string;
  previous?: string;
  onChange: (value: string) => void;
  measurement?: { quantity: "weight"; unit: OwnProfile["weightUnit"] } | { quantity: "distance"; unit: OwnProfile["distanceUnit"] };
}) {
  return (
    <label className="result-input">
      <span>{label}</span>
      <div>
        <GhostValueCell previous={previous}>
        {measurement ? <MeasurementInput {...measurement} disabled={disabled} value={value} onChange={onChange} placeholder="—" /> : <input
          disabled={disabled}
          inputMode="decimal"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="—"
        />}
        </GhostValueCell>
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
  return entries.map((_, index) => ({ reps: "", load: "", rpe: "", ...plannedRecordingValues(item, index) }));
}

function programPreviewResultLog(item: WorkoutItem): Record<string, string> {
  const prescription = item.prescription;
  return {
    rounds: prescription.rounds?.toString() ?? "",
    duration: prescription.durationMinutes?.toString() ?? "",
    distance: prescription.distance === undefined ? "" : String(prescription.distanceUnit === "km" ? prescription.distance : prescription.distance / 1000),
    load: prescription.loadKg?.toString() ?? "",
    rpe: "",
  };
}

// Extracted authoring: app/features/programs/ProgramsHome.tsx

function completedEntryLabel(
  entry: CompletedSessionDetail["items"][number]["entries"][number],
  weightUnit: OwnProfile["weightUnit"] = "kg",
  distanceUnit: OwnProfile["distanceUnit"] = "km",
) {
  const parts: string[] = [];
  if (entry.reps !== undefined) parts.push(`${entry.reps} reps`);
  if (entry.loadKg !== undefined)
    parts.push(`${formatWeight(entry.loadKg, weightUnit)} ${weightUnit}`);
  if (entry.durationMinutes !== undefined)
    parts.push(formatRecordedDuration(entry.durationMinutes));
  if (entry.distanceKm !== undefined) parts.push(`${formatDistanceKilometres(entry.distanceKm, distanceUnit)} ${distanceUnit}`);
  if (entry.rounds !== undefined) parts.push(`${entry.rounds} rounds`);
  if (entry.heartRate !== undefined) parts.push(`${entry.heartRate} bpm`);
  if (entry.rpe !== undefined) parts.push(`RPE ${entry.rpe}`);
  return parts.join(" · ") || "No values recorded";
}

function completedFieldLabel(
  field: TrackingField,
  weightUnit: OwnProfile["weightUnit"],
  distanceUnit: OwnProfile["distanceUnit"],
) {
  if (field === "reps") return "Reps";
  if (field === "load") return `Load ${weightUnit}`;
  if (field === "duration") return "Time";
  if (field === "distance") return `Distance ${distanceUnit}`;
  if (field === "rounds") return "Rounds";
  if (field === "heartRate") return "Avg HR";
  return "RPE";
}

function completedFieldValue(
  entry: CompletedSessionDetail["items"][number]["entries"][number],
  field: TrackingField,
  weightUnit: OwnProfile["weightUnit"],
  distanceUnit: OwnProfile["distanceUnit"],
) {
  if (field === "reps") return entry.reps;
  if (field === "load")
    return entry.loadKg === undefined
      ? undefined
      : formatWeight(entry.loadKg, weightUnit);
  if (field === "duration") return entry.durationMinutes === undefined ? undefined : formatRecordedDuration(entry.durationMinutes);
  if (field === "distance") return entry.distanceKm === undefined ? undefined : formatDistanceKilometres(entry.distanceKm, distanceUnit);
  if (field === "rounds") return entry.rounds;
  if (field === "heartRate") return entry.heartRate;
  return entry.rpe;
}

function CompletedWorkoutView({
  state,
  program,
  viewerId,
  weightUnit,
  distanceUnit,
  exerciseCategoryForName,
  onBack,
  onRepeat,
  repeating,
}: {
  state: CompletedWorkoutViewState;
  program?: Program;
  viewerId: string;
  weightUnit: OwnProfile["weightUnit"];
  distanceUnit: OwnProfile["distanceUnit"];
  exerciseCategoryForName: (name: string) => string;
  onBack: () => void;
  onRepeat: () => void;
  repeating: boolean;
}) {
  const dateLabel = new Date(`${state.session.date}T12:00:00`).toLocaleDateString(
    "en",
    { weekday: "long", month: "long", day: "numeric" },
  );
  const returnLabel = destinationLabel(state.returnView);
  return (
    <>
      <DetailNavigation
        backLabel={returnLabel}
        title="Workout results"
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
        <button type="button" className="button secondary small" disabled={repeating || state.loading} onClick={onRepeat}>
          <RefreshCw size={15} />{repeating ? "Preparing…" : "Repeat workout"}
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
                        <ExerciseVideoLinks
                          url={item.videoUrl}
                          videoLinks={item.videoLinks}
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
                            {completedFieldLabel(field, weightUnit, distanceUnit)}
                          </span>
                        ))}
                      </div>
                      {item.entries.map((entry) => (
                        <div
                          className="completed-log-entry"
                          key={entry.position}
                          aria-label={completedEntryLabel(entry, weightUnit, distanceUnit)}
                        >
                          <span className="completed-log-position">
                            {item.entries.length > 1 ? entry.position + 1 : "—"}
                          </span>
                          {item.fields.map((field) => {
                            const value = completedFieldValue(
                              entry,
                              field,
                              weightUnit,
                              distanceUnit,
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

// Extracted authoring: app/features/authoring/FormatTrackingFields.tsx

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
                label: "My athletes",
                loading: refreshing,
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
                  label: "My athletes",
                  loading: refreshing,
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
                <p className="eyebrow">Training access</p>
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
                    Create and edit upcoming workouts and programs
                  </span>
                  <span>
                    <Check size={15} />
                    Use personal exercises while creating your workouts
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
                  Invite a coach above to create training and review your
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

// Extracted authoring: app/features/authoring/ExerciseModal.tsx

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
          ? "A provided Lift Log exercise. Copy it to My exercises to customize it."
          : "Your exercise. Its defaults will be used when you add it to a workout."
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
            <dt>Record</dt>
            <dd>{recordingSummary(exercise.defaultMode, exercise.defaultFields)}</dd>
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
        <ExerciseVideoLinks
          url={exercise.videoUrl}
          videoLinks={exercise.videoLinks}
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

// Extracted authoring: app/features/authoring/WorkoutDialogs.tsx

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
      description: `This ${quickWorkout ? "workout" : "program"} will be removed from Training. Existing copies and completed results will stay.`,
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
              {target.kind === "program-run"
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

// Extracted authoring: app/features/authoring/PrescriptionModal.tsx

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

// Extracted authoring: app/features/authoring/ProgramModal.tsx

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
