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
  Save,
  Search,
  Settings2,
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
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type {
  ActiveSession,
  AthleteSummary,
  CoachAgendaEntry,
  CoachAssignedProgramSummary,
  CoachConnection,
  CoachingWorkspaceData,
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
  ScheduledWorkout,
  SessionSetValue,
  TrackingField,
  ViewName,
  WorkoutItem,
  WorkoutSection,
  WorkspaceData,
} from "../lib/domain";
import type { AppViewer } from "../lib/auth";
import {
  isAmbiguousSessionDraftError,
  LiftLogRepository,
  SessionRevisionConflictError,
} from "../lib/repository";
import {
  ActiveWorkoutDraftStore,
  type ActiveWorkoutDraftRestoreResult,
  type ActiveWorkoutDraftSnapshot,
} from "../lib/active-workout-draft-storage";
import { mergeActiveWorkoutDraftSnapshots } from "../lib/active-workout-draft-merge";
import {
  deriveOccurrenceCapabilities,
  deriveTrainingContentCapabilities,
  requireCapability,
  type OccurrenceCapabilities,
  type TrainingContentCapabilities,
} from "../lib/capabilities";
import { localDateOnly } from "../lib/date-only";
import {
  SessionDraftCoordinator,
  type SessionDraftSaveStatus,
} from "../lib/session-draft-coordinator";
import { flushSessionDraftWithRecovery } from "../lib/session-draft-recovery";
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
import {
  AsyncButton,
  InlineError,
  ModalShell,
  PersonAvatar,
  SegmentedTabs,
  SessionSaveIndicator,
  SourceTag,
  StatusBadge,
  Toast,
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
type SessionDraftSnapshot = {
  session: ActiveSession;
  setLogs: Record<string, SetLog[]>;
  resultLogs: Record<string, Record<string, string>>;
  sessionRpe: string;
  sessionNote: string;
};
type SessionDraftQueueState = {
  sessionId: string;
  repositoryRef: { current: LiftLogRepository };
  coordinator: SessionDraftCoordinator<SessionDraftSnapshot>;
};
type SessionDraftConflictState = {
  sessionId: string;
  authoritativeRevision: number;
  remoteSnapshot: ActiveWorkoutDraftSnapshot;
  localCandidate: ActiveWorkoutDraftSnapshot;
  serverCandidate: ActiveWorkoutDraftSnapshot;
  conflicts: string[];
  resolve?: (snapshot: ActiveWorkoutDraftSnapshot) => void;
};
const activeWorkoutDraftStore = new ActiveWorkoutDraftStore();

function localDraftSnapshot(
  snapshot: SessionDraftSnapshot,
): ActiveWorkoutDraftSnapshot {
  return {
    setLogs: snapshot.setLogs,
    resultLogs: snapshot.resultLogs,
    sessionRpe: snapshot.sessionRpe,
    sessionNote: snapshot.sessionNote,
  };
}

function activeSessionDraftSnapshot(
  session: ActiveSession,
): ActiveWorkoutDraftSnapshot {
  return {
    setLogs: session.setLogs,
    resultLogs: session.resultLogs,
    sessionRpe: session.sessionRpe,
    sessionNote: session.sessionNote,
  };
}

function sameLocalDraft(
  left: ActiveWorkoutDraftSnapshot,
  right: ActiveWorkoutDraftSnapshot,
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function restoredActiveWorkoutDraft(
  session: ActiveSession,
  result: ActiveWorkoutDraftRestoreResult,
) {
  if (result.status !== "restored" && result.status !== "revision-mismatch") {
    return null;
  }

  const remoteSnapshot = activeSessionDraftSnapshot(session);
  const { draft } = result;
  if (!draft.baseSnapshot) {
    if (draft.baseRevision === session.draftRevision) {
      return {
        snapshot: draft.snapshot,
        remoteSnapshot,
        serverCandidate: remoteSnapshot,
        conflicts: [] as string[],
      };
    }
    return {
      snapshot: draft.snapshot,
      remoteSnapshot,
      serverCandidate: remoteSnapshot,
      conflicts: ["workout"],
    };
  }

  const localMerge = mergeActiveWorkoutDraftSnapshots(
    draft.baseSnapshot,
    draft.snapshot,
    remoteSnapshot,
  );
  const serverMerge = mergeActiveWorkoutDraftSnapshots(
    draft.baseSnapshot,
    remoteSnapshot,
    draft.snapshot,
  );
  return {
    snapshot: localMerge.snapshot,
    remoteSnapshot,
    serverCandidate: serverMerge.snapshot,
    conflicts: localMerge.conflicts,
  };
}

type ProgramSourceTab = "own" | "coach";
type ProgramAction = {
  id: string;
  kind: "delete" | "publish" | "edit" | "open" | "week";
} | null;
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

function createSessionDraftCoordinator(
  repositoryRef: { current: LiftLogRepository },
  initialRevision: number,
  online: boolean,
  onStatusChange: (status: SessionDraftSaveStatus) => void,
  onError: (error: unknown) => void,
  onRevisionConfirmed: (
    revision: number,
    snapshot: SessionDraftSnapshot,
  ) => void,
) {
  return new SessionDraftCoordinator<SessionDraftSnapshot>(
    async ({ expectedRevision, writeToken, snapshot }) => {
      const result = await repositoryRef.current.saveSessionDraft(
        snapshot.session,
        snapshot.setLogs,
        snapshot.resultLogs,
        snapshot.sessionRpe,
        snapshot.sessionNote,
        expectedRevision,
        writeToken,
      );
      onRevisionConfirmed(result.revision, snapshot);
      return result.revision;
    },
    {
      initialRevision,
      online,
      isAmbiguousFailure: isAmbiguousSessionDraftError,
      isRevisionConflict: (error) =>
        error instanceof SessionRevisionConflictError,
      onError,
      onStatusChange,
    },
  );
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
  const [initialWorkoutDraft] = useState(() => {
    const session = initialWorkspace.activeSession;
    if (!session) return { result: null, restored: null };
    const result = activeWorkoutDraftStore.restore(
      viewer.id,
      session.id,
      session.draftRevision,
    );
    return {
      result,
      restored: restoredActiveWorkoutDraft(session, result),
    };
  });
  const restoredSnapshot = initialWorkoutDraft.restored?.snapshot;
  const restoredSnapshotNeedsSync = Boolean(
    initialWorkspace.activeSession &&
      restoredSnapshot &&
      initialWorkoutDraft.restored?.conflicts.length === 0 &&
      !sameLocalDraft(
        restoredSnapshot,
        activeSessionDraftSnapshot(initialWorkspace.activeSession),
      ),
  );
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
    restoredSnapshot?.sessionRpe ??
      initialWorkspace.activeSession?.sessionRpe ??
      "7",
  );
  const [sessionNote, setSessionNote] = useState(
    restoredSnapshot?.sessionNote ??
      initialWorkspace.activeSession?.sessionNote ??
      "",
  );
  const [sessionDraftConflict, setSessionDraftConflict] =
    useState<SessionDraftConflictState | null>(() => {
      const session = initialWorkspace.activeSession;
      const restored = initialWorkoutDraft.restored;
      if (!session || !restored?.conflicts.length) return null;
      return {
        sessionId: session.id,
        authoritativeRevision: session.draftRevision,
        remoteSnapshot: restored.remoteSnapshot,
        localCandidate: restored.snapshot,
        serverCandidate: restored.serverCandidate,
        conflicts: restored.conflicts,
      };
    });
  const [localRecoveryAvailable, setLocalRecoveryAvailable] = useState(
    initialWorkoutDraft.result?.status !== "storage-unavailable",
  );
  const [toast, setToast] = useState("");
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
  const sessionDraftQueueRef = useRef<SessionDraftQueueState | null>(null);
  const sessionDraftSaveTimerRef = useRef<number | null>(null);
  const latestSessionDraftRef = useRef<SessionDraftSnapshot | null>(null);
  const observedSessionDraftIdRef = useRef<string | null>(null);
  const lastSessionDraftContentRef = useRef<{
    sessionId: string;
    serialized: string;
  } | null>(null);
  const restoredDraftNeedsSyncRef = useRef(restoredSnapshotNeedsSync);
  const confirmedSessionRevisionRef = useRef(
    new Map<string, number>(
      initialWorkspace.activeSession
        ? [
            [
              initialWorkspace.activeSession.id,
              initialWorkspace.activeSession.draftRevision,
            ],
          ]
        : [],
    ),
  );
  const confirmedSessionSnapshotRef = useRef(
    new Map<string, ActiveWorkoutDraftSnapshot>(
      initialWorkspace.activeSession
        ? [
            [
              initialWorkspace.activeSession.id,
              activeSessionDraftSnapshot(initialWorkspace.activeSession),
            ],
          ]
        : [],
    ),
  );
  const sessionDraftRecoveryRef = useRef<Promise<number> | null>(null);
  const completionTokenRef = useRef<{
    sessionId: string;
    token: string;
    confirmedRevision: number;
    sessionRpe: string;
    sessionNote: string;
  } | null>(null);
  const [sessionSaveStatus, setSessionSaveStatus] =
    useState<SessionDraftSaveStatus>("saved");
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const onlineRef = useRef(isOnline);
  const persistActiveWorkoutDraft = useCallback(
    (
      sessionId: string,
      baseRevision: number,
      snapshot: ActiveWorkoutDraftSnapshot,
      baseSnapshot: ActiveWorkoutDraftSnapshot,
    ) => {
      const stored = activeWorkoutDraftStore.save(
        viewer.id,
        sessionId,
        baseRevision,
        snapshot,
        baseSnapshot,
      );
      setLocalRecoveryAvailable((current) =>
        current === stored ? current : stored,
      );
      return stored;
    },
    [viewer.id],
  );
  const requestSessionDraftConflictResolution = useCallback(
    (
      conflict: Omit<SessionDraftConflictState, "resolve">,
    ): Promise<ActiveWorkoutDraftSnapshot> =>
      new Promise((resolve) => {
        setSessionSaveStatus("error");
        setSessionDraftConflict({ ...conflict, resolve });
        notify(
          "This workout changed in another copy · choose which conflicting values to keep",
        );
      }),
    [notify],
  );
  const recoverSessionDraftRevision = useCallback(
    (sessionId: string, forceAuthoritativeReload = false) => {
      if (sessionDraftRecoveryRef.current) {
        return sessionDraftRecoveryRef.current;
      }

      const recovery = (async () => {
        const queue = sessionDraftQueueRef.current;
        if (queue?.sessionId !== sessionId) {
          throw new Error("The active workout save queue is no longer available.");
        }
        if (
          !forceAuthoritativeReload &&
          !queue.coordinator.revisionResetRequired
        ) {
          return queue.coordinator.confirmedRevision;
        }

        let authoritativeSession: ActiveSession | null = null;
        setSessionSaveStatus("saving");
        const revision = await flushSessionDraftWithRecovery({
          coordinator: queue.coordinator,
          isRevisionConflict: (error) =>
            error instanceof SessionRevisionConflictError,
          startWithAuthoritativeRevision: forceAuthoritativeReload,
          loadAuthoritativeRevision: async () => {
            authoritativeSession =
              await queue.repositoryRef.current.reloadActiveSession(sessionId);
            if (!authoritativeSession) {
              throw new Error(
                "This workout is no longer active. Your unsaved entries remain on this device.",
              );
            }
            return authoritativeSession.draftRevision;
          },
          getLatestSnapshot: async ({ authoritativeRevision }) => {
            const latest = latestSessionDraftRef.current;
            if (!latest || latest.session.id !== sessionId) {
              throw new Error(
                "The latest workout entries could not be prepared for recovery.",
              );
            }
            if (authoritativeRevision === undefined) return latest;
            if (!authoritativeSession) {
              throw new Error(
                "The authoritative workout could not be prepared for recovery.",
              );
            }
            const remoteSnapshot = activeSessionDraftSnapshot(
              authoritativeSession,
            );
            const baseSnapshot =
              confirmedSessionSnapshotRef.current.get(sessionId) ??
              remoteSnapshot;
            const localSnapshot = localDraftSnapshot(latest);
            const localMerge = mergeActiveWorkoutDraftSnapshots(
              baseSnapshot,
              localSnapshot,
              remoteSnapshot,
            );
            let recoveredLocalSnapshot = localMerge.snapshot;
            if (localMerge.conflicts.length > 0) {
              const serverMerge = mergeActiveWorkoutDraftSnapshots(
                baseSnapshot,
                remoteSnapshot,
                localSnapshot,
              );
              recoveredLocalSnapshot =
                await requestSessionDraftConflictResolution({
                  sessionId,
                  authoritativeRevision,
                  remoteSnapshot,
                  localCandidate: localMerge.snapshot,
                  serverCandidate: serverMerge.snapshot,
                  conflicts: localMerge.conflicts,
                });
            }
            const recoveredSnapshot: SessionDraftSnapshot = {
              session: {
                ...latest.session,
                draftRevision: authoritativeRevision,
                itemLogIds: authoritativeSession.itemLogIds,
              },
              ...recoveredLocalSnapshot,
            };
            confirmedSessionSnapshotRef.current.set(
              sessionId,
              remoteSnapshot,
            );
            persistActiveWorkoutDraft(
              sessionId,
              authoritativeRevision,
              recoveredLocalSnapshot,
              remoteSnapshot,
            );
            latestSessionDraftRef.current = recoveredSnapshot;
            setActiveSession(authoritativeSession);
            setSetLogs(recoveredLocalSnapshot.setLogs);
            setResultLogs(recoveredLocalSnapshot.resultLogs);
            setSessionRpe(recoveredLocalSnapshot.sessionRpe);
            setSessionNote(recoveredLocalSnapshot.sessionNote);
            return recoveredSnapshot;
          },
        });
        confirmedSessionRevisionRef.current.set(sessionId, revision);
        return revision;
      })().finally(() => {
          if (sessionDraftRecoveryRef.current === recovery) {
            sessionDraftRecoveryRef.current = null;
          }
        });
      sessionDraftRecoveryRef.current = recovery;
      return recovery;
    },
    [persistActiveWorkoutDraft, requestSessionDraftConflictResolution],
  );
  const startSessionDraftRecovery = useCallback(
    (sessionId: string, forceAuthoritativeReload = false) => {
      void recoverSessionDraftRevision(
        sessionId,
        forceAuthoritativeReload,
      ).then(
        () => notify("Workout reconnected · latest entries saved"),
        (error: unknown) => {
          setSessionSaveStatus(
            onlineRef.current ? "error" : "unsaved-offline",
          );
          notify(
            error instanceof Error
              ? error.message
              : "Your workout is safe on this device but could not sync yet.",
          );
        },
      );
    },
    [notify, recoverSessionDraftRevision],
  );
  const ensureSessionDraftQueue = useCallback(
    (session: ActiveSession, targetRepository: LiftLogRepository) => {
      const current = sessionDraftQueueRef.current;
      if (current?.sessionId === session.id) {
        current.repositoryRef.current = targetRepository;
        return current.coordinator;
      }

      current?.coordinator.close();
      const repositoryRef = { current: targetRepository };
      const initialRevision = Math.max(
        session.draftRevision ?? 0,
        confirmedSessionRevisionRef.current.get(session.id) ?? 0,
      );
      const coordinator = createSessionDraftCoordinator(
        repositoryRef,
        initialRevision,
        onlineRef.current,
        setSessionSaveStatus,
        (error) => {
          if (error instanceof SessionRevisionConflictError) {
            startSessionDraftRecovery(session.id);
            return;
          }
          notify(
            error instanceof Error
              ? error.message
              : "Workout changes are unsaved — retry when connected",
          );
        },
        (revision, confirmedSnapshot) => {
          if (sessionDraftQueueRef.current?.sessionId !== session.id) return;
          confirmedSessionRevisionRef.current.set(session.id, revision);
          const latest = latestSessionDraftRef.current;
          const confirmedLocalSnapshot =
            localDraftSnapshot(confirmedSnapshot);
          confirmedSessionSnapshotRef.current.set(
            session.id,
            confirmedLocalSnapshot,
          );
          persistActiveWorkoutDraft(
            session.id,
            revision,
            localDraftSnapshot(
              latest?.session.id === session.id ? latest : confirmedSnapshot,
            ),
            confirmedLocalSnapshot,
          );
        },
      );
      sessionDraftQueueRef.current = {
        sessionId: session.id,
        repositoryRef,
        coordinator,
      };
      return coordinator;
    },
    [notify, persistActiveWorkoutDraft, startSessionDraftRecovery],
  );

  const [requestedCoachMode, setCoachMode] = useState<"athlete" | "coach">(
    "athlete",
  );
  const coachingRefreshRef = useRef(false);
  const [coachingRefreshing, setCoachingRefreshing] = useState(false);
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
  const scheduleOpeningRef = useRef(false);
  const [scheduleOpening, setScheduleOpening] = useState(false);
  const completedWorkoutRequestRef = useRef(0);
  const [programOwnerId, setProgramOwnerId] = useState(viewer.id);
  const [requestedProgramSource, setProgramSource] =
    useState<ProgramSourceTab>("own");
  const [programAction, setProgramAction] = useState<ProgramAction>(null);
  const weekMutationRef = useRef(false);
  const builderMutationPendingRef = useRef(false);
  const [builderMutationPending, setBuilderMutationPending] = useState(false);

  const schedulablePrograms =
    workspace.schedulablePrograms ??
    [workspace.draftProgram ?? workspace.activeProgram].filter(
      (candidate): candidate is Program => Boolean(candidate),
    );
  const outgoingCoachInvites = workspace.outgoingCoachInvites ?? [];
  const hasCoach = workspace.coachConnections.length > 0;
  const hasAthleteWorkspace =
    workspace.coachedAthletes.length > 0 ||
    workspace.pendingCoachInvites.length > 0;
  const coachMode = hasAthleteWorkspace ? requestedCoachMode : "athlete";
  const programSource =
    requestedProgramSource === "coach" && !hasCoach
      ? "own"
      : requestedProgramSource;
  const programCatalog = workspace.programCatalog ?? schedulablePrograms;
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
      hasAssignableAthletes: workspace.coachedAthletes.length > 0,
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
    restoredSnapshot?.setLogs ??
    (todayWorkout ? starterSetLogs(todayWorkout, activeSession) : {}),
  );
  const [resultLogs, setResultLogs] = useState<
    Record<string, Record<string, string>>
  >(restoredSnapshot?.resultLogs ?? initialWorkspace.activeSession?.resultLogs ?? {});
  const activeSessionId = activeSession?.id;

  useLayoutEffect(() => {
    if (!activeSession || !workoutStarted) return;
    const snapshot: SessionDraftSnapshot = {
      session: activeSession,
      setLogs,
      resultLogs,
      sessionRpe,
      sessionNote,
    };
    latestSessionDraftRef.current = snapshot;
    const coordinator =
      sessionDraftQueueRef.current?.sessionId === activeSession.id
        ? sessionDraftQueueRef.current.coordinator
        : null;
    const confirmedRevision = Math.max(
      activeSession.draftRevision,
      coordinator?.confirmedRevision ?? 0,
      confirmedSessionRevisionRef.current.get(activeSession.id) ?? 0,
    );
    const baseSnapshot =
      confirmedSessionSnapshotRef.current.get(activeSession.id) ??
      activeSessionDraftSnapshot(activeSession);
    persistActiveWorkoutDraft(
      activeSession.id,
      confirmedRevision,
      localDraftSnapshot(snapshot),
      baseSnapshot,
    );
  }, [
    activeSession,
    persistActiveWorkoutDraft,
    resultLogs,
    sessionNote,
    sessionRpe,
    setLogs,
    workoutStarted,
  ]);

  useEffect(() => {
    const updateConnection = () => {
      const online = navigator.onLine;
      onlineRef.current = online;
      setIsOnline(online);
      const queue = sessionDraftQueueRef.current;
      queue?.coordinator.setOnline(online);
      if (online && queue?.coordinator.revisionResetRequired) {
        startSessionDraftRecovery(queue.sessionId);
      }
    };
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    return () => {
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
    };
  }, [startSessionDraftRecovery]);

  useEffect(() => {
    const persistLatest = () => {
      const latest = latestSessionDraftRef.current;
      if (!latest) return;
      const coordinator =
        sessionDraftQueueRef.current?.sessionId === latest.session.id
          ? sessionDraftQueueRef.current.coordinator
          : null;
      const revision = Math.max(
        latest.session.draftRevision,
        coordinator?.confirmedRevision ?? 0,
        confirmedSessionRevisionRef.current.get(latest.session.id) ?? 0,
      );
      const baseSnapshot =
        confirmedSessionSnapshotRef.current.get(latest.session.id) ??
        activeSessionDraftSnapshot(latest.session);
      persistActiveWorkoutDraft(
        latest.session.id,
        revision,
        localDraftSnapshot(latest),
        baseSnapshot,
      );
    };
    const resumeSync = () => {
      const online = navigator.onLine;
      onlineRef.current = online;
      setIsOnline(online);
      const queue = sessionDraftQueueRef.current;
      queue?.coordinator.setOnline(online);
      if (!online || !queue) return;
      if (queue.coordinator.revisionResetRequired) {
        startSessionDraftRecovery(queue.sessionId);
      } else if (queue.coordinator.hasUnsavedChanges) {
        queue.coordinator.save();
      }
    };
    const backgroundSync = () => {
      persistLatest();
      if (sessionDraftSaveTimerRef.current !== null) {
        window.clearTimeout(sessionDraftSaveTimerRef.current);
        sessionDraftSaveTimerRef.current = null;
      }
      if (onlineRef.current) {
        sessionDraftQueueRef.current?.coordinator.save();
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") backgroundSync();
      else resumeSync();
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", backgroundSync);
    window.addEventListener("pageshow", resumeSync);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", backgroundSync);
      window.removeEventListener("pageshow", resumeSync);
    };
  }, [persistActiveWorkoutDraft, startSessionDraftRecovery]);

  useEffect(() => {
    if (!repository || !activeSession) {
      sessionDraftQueueRef.current?.coordinator.close();
      sessionDraftQueueRef.current = null;
      latestSessionDraftRef.current = null;
      observedSessionDraftIdRef.current = null;
      lastSessionDraftContentRef.current = null;
      if (sessionDraftSaveTimerRef.current !== null) {
        window.clearTimeout(sessionDraftSaveTimerRef.current);
        sessionDraftSaveTimerRef.current = null;
      }
      completionTokenRef.current = null;
      return;
    }
    const coordinator = ensureSessionDraftQueue(activeSession, repository);
    coordinator.setOnline(onlineRef.current);
  }, [activeSession, activeSessionId, ensureSessionDraftQueue, repository]);

  useEffect(
    () => () => {
      if (sessionDraftSaveTimerRef.current !== null) {
        window.clearTimeout(sessionDraftSaveTimerRef.current);
        sessionDraftSaveTimerRef.current = null;
      }
      sessionDraftQueueRef.current?.coordinator.close();
      sessionDraftQueueRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!repository || !activeSession || !workoutStarted) return;
    const coordinator = ensureSessionDraftQueue(activeSession, repository);
    const snapshot: SessionDraftSnapshot = {
      session: activeSession,
      setLogs,
      resultLogs,
      sessionRpe,
      sessionNote,
    };
    latestSessionDraftRef.current = snapshot;
    const durableSnapshot = localDraftSnapshot(snapshot);
    const serializedSnapshot = JSON.stringify(durableSnapshot);
    const confirmedRevision = Math.max(
      activeSession.draftRevision,
      coordinator.confirmedRevision,
      confirmedSessionRevisionRef.current.get(activeSession.id) ?? 0,
    );
    confirmedSessionRevisionRef.current.set(
      activeSession.id,
      confirmedRevision,
    );
    if (observedSessionDraftIdRef.current !== activeSession.id) {
      observedSessionDraftIdRef.current = activeSession.id;
      if (!restoredDraftNeedsSyncRef.current) {
        lastSessionDraftContentRef.current = {
          sessionId: activeSession.id,
          serialized: serializedSnapshot,
        };
        return;
      }
      restoredDraftNeedsSyncRef.current = false;
    }
    if (
      lastSessionDraftContentRef.current?.sessionId === activeSession.id &&
      lastSessionDraftContentRef.current.serialized === serializedSnapshot
    ) {
      return;
    }
    lastSessionDraftContentRef.current = {
      sessionId: activeSession.id,
      serialized: serializedSnapshot,
    };

    coordinator.stage(snapshot);
    if (!onlineRef.current) {
      coordinator.setOnline(false);
      return;
    }
    if (sessionDraftSaveTimerRef.current !== null) {
      window.clearTimeout(sessionDraftSaveTimerRef.current);
    }
    const saveTimer = window.setTimeout(() => {
      if (sessionDraftSaveTimerRef.current === saveTimer) {
        sessionDraftSaveTimerRef.current = null;
      }
      if (workoutActionRef.current === "finishing") return;
      coordinator.save();
    }, 650);
    sessionDraftSaveTimerRef.current = saveTimer;
  }, [
    activeSession,
    ensureSessionDraftQueue,
    repository,
    resultLogs,
    sessionNote,
    sessionRpe,
    setLogs,
    workoutStarted,
  ]);

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

  async function viewScheduledPlan(schedule: ScheduledWorkout) {
    try {
      const matchingProgram = programCatalog.find(
        (candidate) => candidate.id === schedule.programId,
      );
      const nextProgram = repository
        ? await repository.loadOwnScheduledProgramVersionById(
            schedule.programId,
            schedule.programVersionId,
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

  function applyWorkspace(nextWorkspace: WorkspaceData) {
    const previousActiveSessionId = activeSession?.id;
    const nextActiveSession = nextWorkspace.activeSession;
    const nextWorkout = selectNextWorkoutFocus(
      nextWorkspace.programCatalog,
      nextActiveSession,
      nextWorkspace.scheduledWorkouts,
    )?.workout;
    const preserveActiveDraft = Boolean(
      activeSession &&
      nextActiveSession?.id === activeSession.id &&
      workoutStarted,
    );
    const storedResult =
      !preserveActiveDraft && nextActiveSession
        ? activeWorkoutDraftStore.restore(
            viewer.id,
            nextActiveSession.id,
            nextActiveSession.draftRevision,
          )
        : null;
    const restoredDraft =
      storedResult && nextActiveSession
        ? restoredActiveWorkoutDraft(nextActiveSession, storedResult)
        : null;
    const storedSnapshot = restoredDraft?.snapshot ?? null;
    setWorkspace(nextWorkspace);
    setActiveSession(nextActiveSession);
    if (!preserveActiveDraft) {
      restoredDraftNeedsSyncRef.current = Boolean(
        nextActiveSession &&
          storedSnapshot &&
          restoredDraft?.conflicts.length === 0 &&
          !sameLocalDraft(
            storedSnapshot,
            activeSessionDraftSnapshot(nextActiveSession),
          ),
      );
      observedSessionDraftIdRef.current = null;
      lastSessionDraftContentRef.current = null;
      setSessionDraftConflict(
        nextActiveSession && restoredDraft?.conflicts.length
          ? {
              sessionId: nextActiveSession.id,
              authoritativeRevision: nextActiveSession.draftRevision,
              remoteSnapshot: restoredDraft.remoteSnapshot,
              localCandidate: restoredDraft.snapshot,
              serverCandidate: restoredDraft.serverCandidate,
              conflicts: restoredDraft.conflicts,
            }
          : null,
      );
      setSetLogs(
        storedSnapshot?.setLogs ??
          (nextWorkout ? starterSetLogs(nextWorkout, nextActiveSession) : {}),
      );
      setResultLogs(storedSnapshot?.resultLogs ?? nextActiveSession?.resultLogs ?? {});
      setSessionRpe(
        storedSnapshot?.sessionRpe ?? nextActiveSession?.sessionRpe ?? "7",
      );
      setSessionNote(
        storedSnapshot?.sessionNote ?? nextActiveSession?.sessionNote ?? "",
      );
      if (storedSnapshot) {
        notify("Recovered unsaved workout entries from this device");
      }
    }
    if (nextActiveSession) {
      confirmedSessionRevisionRef.current.set(
        nextActiveSession.id,
        Math.max(
          nextActiveSession.draftRevision,
          confirmedSessionRevisionRef.current.get(nextActiveSession.id) ?? 0,
        ),
      );
      confirmedSessionSnapshotRef.current.set(
        nextActiveSession.id,
        activeSessionDraftSnapshot(nextActiveSession),
      );
    }
    if (
      previousActiveSessionId &&
      nextActiveSession?.id !== previousActiveSessionId
    ) {
      activeWorkoutDraftStore.clearAfterCompletion(
        viewer.id,
        previousActiveSessionId,
      );
      confirmedSessionRevisionRef.current.delete(previousActiveSessionId);
      confirmedSessionSnapshotRef.current.delete(previousActiveSessionId);
    }
    setWorkoutStarted(Boolean(nextActiveSession));
    setSelectedAthleteId(
      (previousId) =>
        nextWorkspace.coachedAthletes.find(
          (athlete) => athlete.id === previousId,
        )?.id ??
        nextWorkspace.coachedAthletes[0]?.id ??
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
    scrollToAppTop();
  }

  function applyCoachingWorkspace(nextCoaching: CoachingWorkspaceData) {
    setWorkspace((previous) => ({ ...previous, ...nextCoaching }));
    setSelectedAthleteId(
      (previousId) =>
        nextCoaching.coachedAthletes.find(
          (athlete) => athlete.id === previousId,
        )?.id ??
        nextCoaching.coachedAthletes[0]?.id ??
        null,
    );
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

  function resolveSessionDraftConflict(keepLocalValues: boolean) {
    const conflict = sessionDraftConflict;
    if (!conflict) return;
    const chosen = keepLocalValues
      ? conflict.localCandidate
      : conflict.serverCandidate;
    confirmedSessionRevisionRef.current.set(
      conflict.sessionId,
      conflict.authoritativeRevision,
    );
    confirmedSessionSnapshotRef.current.set(
      conflict.sessionId,
      conflict.remoteSnapshot,
    );
    persistActiveWorkoutDraft(
      conflict.sessionId,
      conflict.authoritativeRevision,
      chosen,
      conflict.remoteSnapshot,
    );
    setSetLogs(chosen.setLogs);
    setResultLogs(chosen.resultLogs);
    setSessionRpe(chosen.sessionRpe);
    setSessionNote(chosen.sessionNote);
    setSessionDraftConflict(null);

    if (conflict.resolve) {
      conflict.resolve(chosen);
    } else {
      const needsSync = !sameLocalDraft(chosen, conflict.remoteSnapshot);
      restoredDraftNeedsSyncRef.current = false;
      observedSessionDraftIdRef.current = null;
      lastSessionDraftContentRef.current = null;
      if (
        needsSync &&
        repository &&
        activeSession?.id === conflict.sessionId
      ) {
        const snapshot: SessionDraftSnapshot = {
          session: activeSession,
          ...chosen,
        };
        latestSessionDraftRef.current = snapshot;
        lastSessionDraftContentRef.current = {
          sessionId: conflict.sessionId,
          serialized: JSON.stringify(chosen),
        };
        const coordinator = ensureSessionDraftQueue(activeSession, repository);
        coordinator.stage(snapshot);
        if (onlineRef.current) coordinator.save();
        else coordinator.setOnline(false);
      } else {
        setSessionSaveStatus("saved");
      }
    }
    notify(
      keepLocalValues
        ? "Kept this device's conflicting values · syncing merged workout"
        : "Kept the last server-saved conflicting values",
    );
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
      const storedResult = activeWorkoutDraftStore.restore(
        viewer.id,
        session.id,
        session.draftRevision,
      );
      const restoredDraft = restoredActiveWorkoutDraft(session, storedResult);
      const storedSnapshot = restoredDraft?.snapshot ?? null;
      completionTokenRef.current = null;
      setSessionSaveStatus("saved");
      confirmedSessionRevisionRef.current.set(
        session.id,
        session.draftRevision,
      );
      confirmedSessionSnapshotRef.current.set(
        session.id,
        activeSessionDraftSnapshot(session),
      );
      restoredDraftNeedsSyncRef.current = Boolean(
        storedSnapshot &&
          restoredDraft?.conflicts.length === 0 &&
          !sameLocalDraft(storedSnapshot, activeSessionDraftSnapshot(session)),
      );
      observedSessionDraftIdRef.current = null;
      lastSessionDraftContentRef.current = null;
      setSessionDraftConflict(
        restoredDraft?.conflicts.length
          ? {
              sessionId: session.id,
              authoritativeRevision: session.draftRevision,
              remoteSnapshot: restoredDraft.remoteSnapshot,
              localCandidate: restoredDraft.snapshot,
              serverCandidate: restoredDraft.serverCandidate,
              conflicts: restoredDraft.conflicts,
            }
          : null,
      );
      setActiveSession(session);
      setSetLogs(storedSnapshot?.setLogs ?? starterSetLogs(workout, session));
      setResultLogs(storedSnapshot?.resultLogs ?? session.resultLogs);
      setSessionRpe(storedSnapshot?.sessionRpe ?? session.sessionRpe);
      setSessionNote(storedSnapshot?.sessionNote ?? session.sessionNote);
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
      notify(
        storedSnapshot && !restoredDraft?.conflicts.length
          ? "Workout resumed · recovered entries are syncing"
          : restoredDraft?.conflicts.length
            ? "Workout resumed · choose which conflicting values to keep"
          : "Workout started · changes save automatically",
      );
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

  function clearConfirmedActiveSession(
    session: ActiveSession,
    scheduleStatus: "planned" | "skipped" | "completed",
  ) {
    if (sessionDraftSaveTimerRef.current !== null) {
      window.clearTimeout(sessionDraftSaveTimerRef.current);
      sessionDraftSaveTimerRef.current = null;
    }
    if (sessionDraftQueueRef.current?.sessionId === session.id) {
      sessionDraftQueueRef.current.coordinator.close();
      sessionDraftQueueRef.current = null;
    }
    latestSessionDraftRef.current = null;
    observedSessionDraftIdRef.current = null;
    lastSessionDraftContentRef.current = null;
    activeWorkoutDraftStore.clearAfterCompletion(viewer.id, session.id);
    confirmedSessionRevisionRef.current.delete(session.id);
    confirmedSessionSnapshotRef.current.delete(session.id);
    setSessionDraftConflict(null);
    setActiveSession(null);
    setWorkoutStarted(false);
    setWorkoutComplete(false);
    setSessionSaveStatus("saved");
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
        if (!onlineRef.current) {
          throw new Error("Reconnect before finishing this workout");
        }
        if (sessionDraftSaveTimerRef.current !== null) {
          window.clearTimeout(sessionDraftSaveTimerRef.current);
          sessionDraftSaveTimerRef.current = null;
        }
        const coordinator = ensureSessionDraftQueue(activeSession, repository);
        let completion =
          completionTokenRef.current?.sessionId === activeSession.id
            ? completionTokenRef.current
            : null;
        let recoveredRevision: number | null = null;

        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (!completion) {
            let confirmedRevision: number;
            if (recoveredRevision !== null) {
              confirmedRevision = recoveredRevision;
              recoveredRevision = null;
            } else {
              try {
                confirmedRevision = await coordinator.flushLatest({
                  session: activeSession,
                  setLogs,
                  resultLogs,
                  sessionRpe,
                  sessionNote,
                });
              } catch (error) {
                if (!(error instanceof SessionRevisionConflictError)) throw error;
                confirmedRevision = await recoverSessionDraftRevision(
                  activeSession.id,
                );
              }
            }
            const latest = latestSessionDraftRef.current;
            completion = {
              sessionId: activeSession.id,
              token: crypto.randomUUID(),
              confirmedRevision,
              sessionRpe:
                latest?.session.id === activeSession.id
                  ? latest.sessionRpe
                  : sessionRpe,
              sessionNote:
                latest?.session.id === activeSession.id
                  ? latest.sessionNote
                  : sessionNote,
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
            recoveredRevision = await recoverSessionDraftRevision(
              activeSession.id,
              true,
            );
          }
        }

        clearConfirmedActiveSession(activeSession, "completed");
        completionTokenRef.current = null;
        notify("Session saved · next workout is ready when you are");
        try {
          applyWorkspace(await repository.loadWorkspace());
        } catch {
          notify("Session saved · refresh when connected to load what is next");
        }
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
      cue,
    };
    try {
      const exercise = repository
        ? await repository.updatePersonalExercise(original.id, input)
        : { ...original, name, category, discipline, cue, defaultMode: mode };
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
      applyWorkspace(await repository.loadWorkspace());
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
        applyWorkspace(await repository.loadWorkspace());
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
        applyWorkspace(await repository.loadWorkspace());
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
        const schedulable = schedulablePrograms;
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
          clearConfirmedActiveSession(activeSession, status);
        } else {
          setWorkspace((previous) => ({
            ...previous,
            scheduledWorkouts: previous.scheduledWorkouts.map((schedule) =>
              schedule.id === scheduleId ? { ...schedule, status } : schedule,
            ),
          }));
        }
        try {
          applyWorkspace(await repository.loadWorkspace());
        } catch {
          notify("Workout updated · refresh when connected for the latest plan");
        }
      } else {
        setWorkspace((previous) => ({
          ...previous,
          scheduledWorkouts: previous.scheduledWorkouts.map((schedule) =>
            schedule.id === scheduleId ? { ...schedule, status } : schedule,
          ),
        }));
        if (activeSession?.scheduledWorkoutId === scheduleId) {
          clearConfirmedActiveSession(activeSession, status);
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
          ((activeSession && activeWorkoutVisible && todayWorkout && workoutFocus) ||
            (!activeSession && workoutPreviewSchedule)) && (
          <TodayView
            program={activeSession ? todayProgram : previewProgram}
            viewerId={viewer.id}
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
            sessionSaveStatus={sessionSaveStatus}
            localRecoveryAvailable={localRecoveryAvailable}
            online={isOnline}
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
              activeSession
                ? () => setActiveWorkoutVisible(false)
                : !activeSession
                ? () => {
                    const returnView = workoutPreviewReturnView;
                    setDetail(null);
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
              !activeSession &&
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
          <ProgramView
            key={`${program.id}:${program.versionId}`}
            program={program}
            action={
              programAction?.id === program.id ? programAction.kind : null
            }
            mutationPending={builderMutationPending}
            viewerId={viewer.id}
            capabilities={capabilitiesForProgram(program)}
            weightUnit={workspace.profile.weightUnit}
            currentWeek={currentWeek}
            selectedWeek={selectedWeek}
            selectedWorkout={selectedWorkout}
            selectedSectionId={selectedSectionId}
            exercises={[
              ...workspace.globalExercises,
              ...workspace.personalExercises,
            ]}
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
                ? () => {
                    setAssignmentSeed({ programId: program.id });
                    setModal("assign-program");
                  }
                : undefined
            }
            onEditWorkout={() => setModal("workout-settings")}
            onSchedule={
              capabilitiesForProgram(program).schedule
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
              viewerId={viewer.id}
              schedules={workspace.scheduledWorkouts}
              source={programSource}
              hasCoach={hasCoach}
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
            />
          ))}
        {activeView === "calendar" && (
          <CalendarView
            sessions={workspace.completedSessions}
            schedules={workspace.scheduledWorkouts}
            weekStartsOnSunday={workspace.profile.weekStartsOnSunday}
            canSchedule={schedulablePrograms.some(
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
            onRemoveSchedule={(scheduleId) => {
              void saveSchedule(scheduleId, null);
            }}
          />
        )}
        {activeView === "exercises" && (
          <ExercisesHome
            scope={exerciseScope}
            query={exerciseQuery}
            global={workspace.globalExercises}
            personal={workspace.personalExercises}
            copyingExerciseId={copyingExerciseId}
            onScope={setExerciseScope}
            onQuery={setExerciseQuery}
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
          schedulableVersionIds={schedulablePrograms.map(
            (candidate) => candidate.versionId,
          )}
          quickWorkoutVersionIds={schedulablePrograms
            .filter((candidate) => candidate.contentType === "quick_workout")
            .map((candidate) => candidate.versionId)}
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

function PageHeader({
  eyebrow,
  title,
  titleAction,
  description,
  children,
}: {
  eyebrow: string;
  title: React.ReactNode;
  titleAction?: React.ReactNode;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <div className="page-title-row">
          {typeof title === "string" ? <h1>{title}</h1> : title}
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

const plannedRpeOptions = [
  { value: "", label: "No planned effort", detail: "Athlete chooses effort" },
  { value: "6", label: "Easy", detail: "about 4 reps left" },
  { value: "7", label: "Moderate", detail: "about 3 reps left" },
  { value: "8", label: "Hard", detail: "about 2 reps left" },
  { value: "9", label: "Very hard", detail: "about 1 rep left" },
  { value: "10", label: "Max", detail: "no reps left" },
] as const;

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
    <div className="planned-rpe-select rpe-select">
      <select
        disabled={disabled}
        className={cn("rpe-select-trigger", value && "selected", value && `rpe-${rpeTone(value)}`)}
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {plannedRpeOptions.map((option) => (
          <option key={option.value || "none"} value={option.value}>
            {option.value ? `${option.value} · ` : ""}
            {option.label} · {option.detail}
          </option>
        ))}
      </select>
    </div>
  );
}

export function RpeSelect({
  disabled,
  value,
  onChange,
  ariaLabel = "Actual RPE",
}: {
  disabled: boolean;
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
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
            <strong>RPE</strong> shows how hard the set felt by how many good
            reps you had left.
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
              <span>Not logged</span>
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
    <div className="interval-log-table">
      <div className="interval-log-header" aria-hidden>
        <span>Round</span>
        <span>Plan</span>
        <span>Distance</span>
        <span>Avg HR</span>
        <span>RPE</span>
      </div>
      {rounds.map((round, index) => {
        const completedKey = `round.${index}.completed`;
        const completed = Boolean(resultLog[completedKey]);
        return (
          <div className="interval-log-row" key={index}>
            <button
              type="button"
              className={cn("interval-round-toggle", completed && "completed")}
              disabled={!active}
              aria-label={`${completed ? "Mark" : "Mark"} round ${index + 1} ${completed ? "incomplete" : "complete"}`}
              aria-pressed={completed}
              onClick={() => onUpdate(completedKey, completed ? "" : "1")}
            >
              {completed ? <Check size={13} /> : index + 1}
            </button>
            <span className="interval-plan-cell">
              {round.workSeconds ?? "—"}/{round.restSeconds ?? "—"}
              <small>s</small>
            </span>
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
            <RpeSelect
              ariaLabel={`${item.title}, round ${index + 1}, actual RPE`}
              disabled={!active}
              value={resultLog[`round.${index}.rpe`] ?? ""}
              onChange={(value) => onUpdate(`round.${index}.rpe`, value)}
            />
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

function ProgramView({
  program,
  action,
  mutationPending,
  viewerId,
  capabilities,
  weightUnit,
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
  onEditWorkout,
  onSchedule,
}: {
  program: Program;
  action: Exclude<ProgramAction, null>["kind"] | null;
  mutationPending: boolean;
  viewerId: string;
  capabilities: TrainingContentCapabilities;
  weightUnit: OwnProfile["weightUnit"];
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
  onSave: (title: string, description: string) => void;
  onCreateDraft: () => void;
  onBack: () => void;
  onAssignProgram?: () => void;
  onEditWorkout: () => void;
  onSchedule?: () => void;
}) {
  const [pickerQuery, setPickerQuery] = useState("");
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
  const headerTitle = isQuickWorkout
    ? selectedWorkout?.title ?? program.title
    : program.title;
  const [title, setTitle] = useState(headerTitle);
  const [description, setDescription] = useState(program.description);
  const canEdit = capabilities.edit;
  const editable = isDraft && capabilities.edit;
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
      await mutation();
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
        title={
          <>
            <span className="program-editor-heading-icon" aria-hidden="true">
              {isQuickWorkout ? <Activity size={24} /> : <Layers3 size={24} />}
            </span>
            {editable ? (
              <input
                className="program-editor-title-input"
                aria-label={`${isQuickWorkout ? "Workout" : "Program"} name`}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            ) : (
              <h1>{headerTitle}</h1>
            )}
          </>
        }
        description={!editable ? program.description : undefined}
      >
        <div className="program-editor-header-actions">
          <button
            className="button secondary small program-editor-back"
            onClick={onBack}
          >
            <ArrowLeft size={15} />
            All programs
          </button>
          <SourceTag
            presentation={presentProgramProvenance(program, viewerId)}
          />
          <StatusBadge status={isDraft ? "draft" : "ready"} />
          {(onSchedule || onAssignProgram) && (
            <div className="program-editor-secondary-actions">
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
            </div>
          )}
          {editable ? (
            <button
              className="button primary small program-editor-primary-action"
              disabled={Boolean(action) || !title.trim()}
              onClick={() => onSave(title, description)}
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
                className="button primary small program-editor-primary-action"
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
        </div>
      </PageHeader>
      {editable && (
        <label className="form-field program-editor-description-field">
          <span>Description <em>optional</em></span>
          <textarea
            value={description}
            placeholder={`What is this ${isQuickWorkout ? "workout" : "program"} for?`}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
      )}
      {!isQuickWorkout && editable && program.weeks.length > 1 && (
        <div className="program-editor-week-delete">
          <button className="button danger small" onClick={onDeleteWeek}>
            <Trash2 size={14} />
            Delete week {selectedWeek}
          </button>
        </div>
      )}
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
      <div
        className={`builder-layout${isQuickWorkout ? " quick-workout-builder" : ""}`}
      >
        {!isQuickWorkout && <aside className="workout-list panel">
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
        </aside>}
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
                      {editable && !isQuickWorkout && (
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
                    aria-label="Search exercises"
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
  const style = inferredExerciseDiscipline(exercise);
  const StyleIcon =
    exerciseTrainingStyles.find((item) => item.value === style)?.icon ??
    Dumbbell;
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
        <span
          className={cn("exercise-style-icon", style)}
          title={exerciseTrainingStyleLabel(style)}
          aria-label={exerciseTrainingStyleLabel(style)}
        >
          <StyleIcon size={15} />
        </span>
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
  action,
  capabilitiesForProgram,
  onOpen,
  onEdit,
  onDelete,
  onSource,
  onCreate,
  onCreateWorkout,
  onSchedule,
}: {
  programs: Program[];
  viewerId: string;
  schedules: ScheduledWorkout[];
  source: ProgramSourceTab;
  hasCoach: boolean;
  action: ProgramAction;
  capabilitiesForProgram: (program: Program) => TrainingContentCapabilities;
  onOpen: (program: Program) => void;
  onEdit: (program: Program) => void;
  onDelete: (program: Program) => void;
  onSource: (source: ProgramSourceTab) => void;
  onCreate: () => void;
  onCreateWorkout: () => void;
  onSchedule: () => void;
}) {
  const [contentQuery, setContentQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedTypes, setSelectedTypes] = useState<
    Array<"program" | "quick_workout">
  >([]);
  const [selectedStatuses, setSelectedStatuses] = useState<ProgramRunStatus[]>([]);
  const own = programs.filter((program) => program.sourceType === "self");
  const coach = programs.filter((program) => program.sourceType === "coach");
  const scheduleProgress = (program: Program) => {
    const today = localDateOnly();
    const latestScheduleByWorkout = new Map<string, ScheduledWorkout>();
    const programSchedules = schedules.filter(
      (schedule) => schedule.programVersionId === program.versionId,
    );
    programSchedules.forEach((schedule) => {
        const current = latestScheduleByWorkout.get(schedule.workoutId);
        if (!current || schedule.sequenceNumber > current.sequenceNumber)
          latestScheduleByWorkout.set(schedule.workoutId, schedule);
      });
    return {
      workoutStates: programWorkoutIds(program).map((workoutId) => {
        const schedule = latestScheduleByWorkout.get(workoutId);
        return deriveProgramWorkoutProgressState(schedule, today);
      }),
      workoutStatus: deriveSingleWorkoutStatus(
        program.versionStatus === "draft",
        programSchedules,
        today,
      ),
    };
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
    setValues((current) =>
      current.includes(value)
        ? current.filter((candidate) => candidate !== value)
        : [...current, value],
    );
  }
  function resetProgramFilters() {
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
          onChange={onSource}
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
                onChange={(event) => setContentQuery(event.target.value)}
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
              {programItems.length > 0 && (
                <section className="program-content-section" aria-labelledby="program-list-heading">
                  <div className="program-content-heading">
                    <span><Layers3 size={15} /><strong id="program-list-heading">Programs</strong></span>
                    <small>{programItems.length}</small>
                  </div>
                  <div className="program-content-cards">{programItems.map(renderRow)}</div>
                </section>
              )}
              {workoutItems.length > 0 && (
                <section className="program-content-section" aria-labelledby="workout-list-heading">
                  <div className="program-content-heading">
                    <span><Activity size={15} /><strong id="workout-list-heading">Single workouts</strong></span>
                    <small>{workoutItems.length}</small>
                  </div>
                  <div className="program-content-cards">{workoutItems.map(renderRow)}</div>
                </section>
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

export function CalendarView({
  sessions,
  schedules,
  weekStartsOnSunday,
  canSchedule,
  onNavigate,
  onSchedule,
  onScheduleDay,
  onMoveSchedule,
  onRemoveSchedule,
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
  onRemoveSchedule: (scheduleId: string) => void;
  onOpenPlan: (schedule: ScheduledWorkout) => void;
  onOpenResults: (session: CompletedSession) => void;
}) {
  const [monthOffset, setMonthOffset] = useState(0);
  const [draggingScheduleId, setDraggingScheduleId] = useState<string | null>(
    null,
  );
  const [selectedDate, setSelectedDate] = useState(() => localDateOnly());
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
  const selectedSessions = sessions.filter(
    (session) => session.date === selectedDate,
  );
  const selectedSchedules = schedules.filter(
    (schedule) =>
      schedule.plannedDate === selectedDate && schedule.status === "planned",
  );
  const selectedDateLabel = new Date(
    `${selectedDate}T12:00:00`,
  ).toLocaleDateString("en", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  function changeMonth(offset: number) {
    const nextOffset = monthOffset + offset;
    const nextMonth = new Date(
      now.getFullYear(),
      now.getMonth() + nextOffset,
      1,
    );
    setMonthOffset(nextOffset);
    setSelectedDate(localDateOnly(nextMonth));
  }
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
              onClick={() => changeMonth(-1)}
            >
              <ArrowLeft size={16} />
            </button>
            <h2>{monthName}</h2>
            <button
              className="icon-button"
              aria-label="Next month"
              onClick={() => changeMonth(1)}
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
                    selectedDate === date && "selected",
                    draggingScheduleId && "schedule-target",
                  )}
                  key={date}
                  onDragOver={(event) => {
                    if (draggingScheduleId) event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const scheduleId =
                      draggingScheduleId ??
                      event.dataTransfer.getData("text/plain");
                    setDraggingScheduleId(null);
                    if (scheduleId) {
                      setSelectedDate(date);
                      onMoveSchedule(scheduleId, date);
                    }
                  }}
                >
                  {canSchedule ? (
                    <button
                      type="button"
                      className="calendar-day-action calendar-day-schedule"
                      aria-label={`Schedule a workout on ${date}`}
                      onClick={() => {
                        setSelectedDate(date);
                        onScheduleDay(date);
                      }}
                    >
                      <span aria-hidden="true">{day}</span>
                    </button>
                  ) : (
                    <span className="calendar-day-number">{day}</span>
                  )}
                  <button
                    type="button"
                    className="calendar-day-action calendar-day-select"
                    aria-label={`Show calendar items for ${date}`}
                    aria-pressed={selectedDate === date}
                    onClick={() => setSelectedDate(date)}
                  >
                    <span aria-hidden="true">{day}</span>
                  </button>
                  <div className="calendar-events">
                    {daySessions.map((session) => (
                      <button
                        key={session.id}
                        className="completed"
                        aria-label={`${session.workoutTitle}, completed on ${date}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedDate(date);
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
                            setSelectedDate(date);
                            onOpenPlan(schedule);
                          }}
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", schedule.id);
                            setSelectedDate(date);
                            setDraggingScheduleId(schedule.id);
                          }}
                          onDragEnd={() => setDraggingScheduleId(null)}
                        >
                          <CalendarPlus size={12} />
                          <span>{schedule.workoutTitle}</span>
                        </button>
                        <button
                          className="calendar-event-remove"
                          aria-label={`Remove ${schedule.workoutTitle} from the calendar`}
                          title="Remove from calendar"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedDate(date);
                            onRemoveSchedule(schedule.id);
                          }}
                        >
                          <CalendarMinus size={11} />
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
          <section
            className="calendar-day-agenda"
            aria-labelledby="calendar-selected-date-title"
          >
            <div className="calendar-day-agenda-heading">
              <div>
                <small>Selected day</small>
                <h3 id="calendar-selected-date-title" aria-live="polite">
                  {selectedDateLabel}
                </h3>
              </div>
              {canSchedule && (
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => onScheduleDay(selectedDate)}
                >
                  <CalendarPlus size={15} />
                  Schedule workout
                </button>
              )}
            </div>
            {selectedSchedules.length || selectedSessions.length ? (
              <div className="calendar-day-agenda-list">
                {selectedSchedules.map((schedule) => (
                  <div className="calendar-day-agenda-row" key={schedule.id}>
                    <button
                      type="button"
                      className="calendar-day-agenda-main planned"
                      onClick={() => onOpenPlan(schedule)}
                    >
                      <CalendarPlus size={16} />
                      <span>
                        <strong>{schedule.workoutTitle}</strong>
                        <small>{schedule.programTitle} · Planned</small>
                      </span>
                      <ChevronRight size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Remove ${schedule.workoutTitle} from the calendar`}
                      title="Remove from calendar"
                      onClick={() => onRemoveSchedule(schedule.id)}
                    >
                      <CalendarMinus size={16} />
                    </button>
                  </div>
                ))}
                {selectedSessions.map((session) => (
                  <div className="calendar-day-agenda-row" key={session.id}>
                    <button
                      type="button"
                      className="calendar-day-agenda-main completed"
                      onClick={() => onOpenResults(session)}
                    >
                      <Check size={16} />
                      <span>
                        <strong>{session.workoutTitle}</strong>
                        <small>
                          Completed
                          {session.durationMinutes
                            ? ` · ${session.durationMinutes} min`
                            : ""}
                          {session.rpe ? ` · RPE ${session.rpe}` : ""}
                        </small>
                      </span>
                      <ChevronRight size={16} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="calendar-day-agenda-empty">
                No workouts on this day.
              </p>
            )}
          </section>
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
  global,
  personal,
  copyingExerciseId,
  onScope,
  onQuery,
  onAdd,
  onOpen,
  onCopy,
  onEdit,
  onDelete,
}: {
  scope: "global" | "personal";
  query: string;
  global: Exercise[];
  personal: Exercise[];
  copyingExerciseId: string | null;
  onScope: (scope: "global" | "personal") => void;
  onQuery: (query: string) => void;
  onAdd: () => void;
  onOpen: (exercise: Exercise) => void;
  onCopy: (exercise: Exercise) => void;
  onEdit: (exercise: Exercise) => void;
  onDelete: (exercise: Exercise) => void;
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
          { value: "global", label: `Library (${global.length})`, icon: BookOpen },
          { value: "personal", label: `My exercises (${personal.length})`, icon: CircleUserRound },
        ]}
      />
      <ExercisesView
        scope={scope}
        query={query}
        global={global}
        personal={personal}
        copyingExerciseId={copyingExerciseId}
        onQuery={onQuery}
        onOpen={onOpen}
        onCopy={onCopy}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    </>
  );
}

function ExercisesView({
  scope,
  query,
  global,
  personal,
  copyingExerciseId,
  onQuery,
  onOpen,
  onCopy,
  onEdit,
  onDelete,
}: {
  scope: "global" | "personal";
  query: string;
  global: Exercise[];
  personal: Exercise[];
  copyingExerciseId: string | null;
  onQuery: (query: string) => void;
  onOpen: (exercise: Exercise) => void;
  onCopy: (exercise: Exercise) => void;
  onEdit: (exercise: Exercise) => void;
  onDelete: (exercise: Exercise) => void;
}) {
  const source = scope === "global" ? global : personal;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedStyles, setSelectedStyles] = useState<ExerciseDiscipline[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedModes, setSelectedModes] = useState<EntryMode[]>([]);
  const [selectedTracking, setSelectedTracking] = useState<TrackingField[]>([]);
  const categoryOptions = Array.from(
    new Set(source.map((exercise) => exercise.category)),
  )
    .filter((category) => category !== "Weightlifting")
    .sort((left, right) => left.localeCompare(right));
  const modeOptions = Array.from(new Set(source.map((exercise) => exercise.defaultMode)));
  const trackingOptions = Array.from(
    new Set(source.flatMap((exercise) => exercise.defaultFields)),
  );
  const filtered = source.filter(
    (exercise) =>
      `${exercise.name} ${exercise.category} ${modeLabel(exercise.defaultMode)} ${exercise.defaultFields.map(trackingFieldLabel).join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (!selectedStyles.length ||
        selectedStyles.includes(inferredExerciseDiscipline(exercise))) &&
      (!selectedCategories.length || selectedCategories.includes(exercise.category)) &&
      (!selectedModes.length || selectedModes.includes(exercise.defaultMode)) &&
      selectedTracking.every((field) => exercise.defaultFields.includes(field)),
  );
  const activeFilterCount =
    selectedStyles.length +
    selectedCategories.length +
    selectedModes.length +
    selectedTracking.length;
  function resetFilters() {
    setSelectedStyles([]);
    setSelectedCategories([]);
    setSelectedModes([]);
    setSelectedTracking([]);
  }
  function toggleTag<T extends string>(
    tag: T,
    setTags: Dispatch<SetStateAction<T[]>>,
  ) {
    setTags((current) =>
      current.includes(tag)
        ? current.filter((candidate) => candidate !== tag)
        : [...current, tag],
    );
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
              onChange={(event) => onQuery(event.target.value)}
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
            {selectedStyles.map((style) => (
              <button key={style} onClick={() => toggleTag(style, setSelectedStyles)}>{exerciseTrainingStyleLabel(style)} <X size={12} /></button>
            ))}
            {selectedCategories.map((category) => (
              <button className="filter-tag-category" key={category} onClick={() => toggleTag(category, setSelectedCategories)}>Category: {category} <X size={12} /></button>
            ))}
            {selectedModes.map((mode) => (
              <button className="filter-tag-logging" key={mode} onClick={() => toggleTag(mode, setSelectedModes)}>Logging: {modeLabel(mode)} <X size={12} /></button>
            ))}
            {selectedTracking.map((field) => (
              <button className="filter-tag-tracking" key={field} onClick={() => toggleTag(field, setSelectedTracking)}>Tracking: {trackingFieldLabel(field)} <X size={12} /></button>
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
                  <button className={selectedStyles.includes(value) ? "active" : ""} key={value} onClick={() => toggleTag(value, setSelectedStyles)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span>Category</span>
              <div className="library-filter-chip-row">
                {categoryOptions.map((category) => (
                  <button className={cn("filter-tag-category", selectedCategories.includes(category) && "active")} key={category} onClick={() => toggleTag(category, setSelectedCategories)}>{category}</button>
                ))}
              </div>
            </div>
            <div>
              <span>Logging</span>
              <div className="library-filter-chip-row">
                {modeOptions.map((mode) => (
                  <button className={cn("filter-tag-logging", selectedModes.includes(mode) && "active")} key={mode} onClick={() => toggleTag(mode, setSelectedModes)}>{modeLabel(mode)}</button>
                ))}
              </div>
            </div>
            {trackingOptions.length > 0 && (
              <div>
                <span>Tracking</span>
                <div className="library-filter-chip-row">
                  {trackingOptions.map((field) => (
                    <button className={cn("filter-tag-tracking", selectedTracking.includes(field) && "active")} key={field} onClick={() => toggleTag(field, setSelectedTracking)}>{trackingFieldLabel(field)}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <div
        id="exercise-library-results"
        role="tabpanel"
      >
      <div className="library-meta"><span>{filtered.length} exercises</span></div>
      <div className="exercise-list panel">
        {filtered.map((exercise) => (
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
                      {Boolean(assignedProgram.hiddenWorkoutCount) && (
                        <em
                          className="program-progress-more"
                          title={`${assignedProgram.hiddenWorkoutCount} additional workouts`}
                        >
                          +{assignedProgram.hiddenWorkoutCount}
                        </em>
                      )}
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
      {error && <InlineError>{error}</InlineError>}
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
  schedules,
  schedulableVersionIds,
  quickWorkoutVersionIds,
  editingId,
  initialDate,
  preparing,
  onClose,
  onSave,
}: {
  schedules: ScheduledWorkout[];
  schedulableVersionIds: string[];
  quickWorkoutVersionIds: string[];
  editingId: string | null;
  initialDate: string | null;
  preparing: boolean;
  onClose: () => void;
  onSave: (scheduleId: string, date: string | null) => Promise<void>;
}) {
  const schedulableVersions = new Set(schedulableVersionIds);
  const quickWorkoutVersions = new Set(quickWorkoutVersionIds);
  const candidates = schedules.filter(
    (schedule) =>
      schedule.status === "planned" &&
      (editingId
        ? schedule.id === editingId
        : !schedule.plannedDate &&
          schedulableVersions.has(schedule.programVersionId)),
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
            <span>Preparing your saved workouts for Calendar.</span>
          </div>
        </div>
      ) : candidates.length ? (
        <>
          <div className="form-grid">
            <label className="form-field full">
              <span>Workout</span>
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
                    {quickWorkoutVersions.has(schedule.programVersionId)
                      ? schedule.workoutTitle
                      : `${schedule.programTitle} · ${schedule.workoutTitle}`}
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
            Save an Own program or workout first. Library content must be
            copied to Own before you can schedule it.
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
