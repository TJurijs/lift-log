import { useCallback, useEffect, useRef, useState } from "react";

import type {
  ActiveSession,
  OwnProfile,
  PlannedWorkout,
  ScheduledWorkout,
  WorkspaceData,
} from "../../../lib/domain";
import type { AppViewer } from "../../../lib/auth";
import type { LiftLogRepository } from "../../../lib/repository";
import {
  isAmbiguousSessionDraftError,
  SessionRevisionConflictError,
} from "../../../lib/repository";
import { mergeActiveWorkoutDraftSnapshots } from "../../../lib/active-workout-draft-merge";
import { ActiveWorkoutDraftStore } from "../../../lib/active-workout-draft-storage";
import {
  ActiveWorkoutLocalController,
  activeWorkoutSnapshotsEqual,
  classifyActiveWorkoutFailure,
  createActiveWorkoutCache,
  importLegacyActiveWorkoutDraft,
  materializeActiveWorkoutEntry,
  runWithActiveWorkoutRetry,
  type ActiveWorkoutCache,
  type ActiveWorkoutDraftSnapshot,
  type ActiveWorkoutLocalState,
  type ActiveWorkoutPatchChange,
  type ActiveWorkoutRetryDecision,
  type ActiveWorkoutRevisionConflict,
} from "../../../lib/active-workout-local";
import type { SessionDraftSaveStatus } from "../../../lib/session-draft-coordinator";

const POINTER_PREFIX = "liftlog:active-workout-pointer:v1:";
const SERVER_SYNC_DELAY_MS = 2_500;
const MAX_REVISION_RECOVERIES = 3;

let sharedCache: ActiveWorkoutCache | null = null;
const userClearGenerations = new Map<string, number>();
const sessionWorkTails = new Map<string, Promise<void>>();

function sessionWorkKey(userId: string, sessionId: string) {
  return `${encodeURIComponent(userId)}:${encodeURIComponent(sessionId)}`;
}

function trackSessionWork(
  userId: string,
  sessionId: string,
  operation: Promise<unknown>,
) {
  const key = sessionWorkKey(userId, sessionId);
  const tail = operation.then(
    () => undefined,
    () => undefined,
  );
  sessionWorkTails.set(key, tail);
  void tail.then(() => {
    if (sessionWorkTails.get(key) === tail) sessionWorkTails.delete(key);
  });
}

function userClearGeneration(userId: string) {
  return userClearGenerations.get(userId) ?? 0;
}

function invalidateUserPersistence(userId: string) {
  userClearGenerations.set(userId, userClearGeneration(userId) + 1);
}

export interface CachedActiveWorkoutPlan {
  workout: PlannedWorkout;
  schedule?: ScheduledWorkout;
  profile: OwnProfile;
}

export interface ActiveWorkoutUiConflict {
  sessionId: string;
  conflicts: string[];
  localCandidate: ActiveWorkoutDraftSnapshot;
  serverCandidate: ActiveWorkoutDraftSnapshot;
}

export interface UseActiveWorkoutPersistenceOptions {
  userId: string;
  session: ActiveSession | null;
  workout: PlannedWorkout | undefined;
  schedule?: ScheduledWorkout;
  profile: OwnProfile;
  repository: LiftLogRepository | null;
  snapshot: ActiveWorkoutDraftSnapshot;
  onApplySnapshot: (snapshot: ActiveWorkoutDraftSnapshot) => void;
  onSessionRefresh: (session: ActiveSession) => void;
  onRevisionConfirmed: (revision: number, writeToken: string) => void;
  onSyncError?: (error: unknown) => void;
}

function cache() {
  sharedCache ??= createActiveWorkoutCache();
  return sharedCache;
}

function browserStorage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function pointerKey(userId: string) {
  return `${POINTER_PREFIX}${encodeURIComponent(userId)}`;
}

function writePointer(userId: string, sessionId: string) {
  try {
    browserStorage()?.setItem(
      pointerKey(userId),
      JSON.stringify({ schemaVersion: 1, sessionId }),
    );
    return true;
  } catch {
    return false;
  }
}

function readPointer(userId: string) {
  try {
    const serialized = browserStorage()?.getItem(pointerKey(userId));
    if (!serialized) return null;
    const value: unknown = JSON.parse(serialized);
    if (
      typeof value !== "object" ||
      value === null ||
      (value as { schemaVersion?: unknown }).schemaVersion !== 1 ||
      typeof (value as { sessionId?: unknown }).sessionId !== "string"
    ) {
      browserStorage()?.removeItem(pointerKey(userId));
      return null;
    }
    return (value as { sessionId: string }).sessionId;
  } catch {
    return null;
  }
}

function clearPointer(userId: string, sessionId?: string) {
  try {
    if (sessionId && readPointer(userId) !== sessionId) return;
    browserStorage()?.removeItem(pointerKey(userId));
  } catch {
    // Best-effort pointer cleanup; the scoped cache remains authoritative.
  }
}

function activeSnapshot(session: ActiveSession): ActiveWorkoutDraftSnapshot {
  return {
    setLogs: session.setLogs,
    resultLogs: session.resultLogs,
    sessionRpe: session.sessionRpe,
    sessionNote: session.sessionNote,
  };
}

function sessionIdentity(session: ActiveSession) {
  return {
    id: session.id,
    workoutId: session.workoutId,
    programVersionId: session.programVersionId,
    ...(session.scheduledWorkoutId
      ? { scheduledWorkoutId: session.scheduledWorkoutId }
      : {}),
    itemLogIds: session.itemLogIds,
  };
}

function isCachedPlan(value: unknown): value is CachedActiveWorkoutPlan {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<CachedActiveWorkoutPlan>;
  return (
    typeof candidate.workout?.id === "string" &&
    typeof candidate.workout.title === "string" &&
    Array.isArray(candidate.workout.sections) &&
    typeof candidate.profile?.id === "string" &&
    typeof candidate.profile.displayName === "string"
  );
}

function profileFromViewer(viewer: AppViewer): OwnProfile {
  const names = viewer.name.trim().split(/\s+/);
  return {
    id: viewer.id,
    firstName: names[0] ?? viewer.name,
    lastName: names.slice(1).join(" "),
    displayName: viewer.name,
    liftlogId: viewer.email,
    weekStartsOnSunday: false,
    weightUnit: "kg",
    distanceUnit: "km",
  };
}

/** Builds the smallest useful signed-in shell while bootstrap is offline. */
export async function loadCachedActiveWorkoutWorkspace(
  viewer: AppViewer,
): Promise<WorkspaceData | null> {
  const sessionId = readPointer(viewer.id);
  if (!sessionId) return null;
  const entry = await cache().load<CachedActiveWorkoutPlan>(viewer.id, sessionId);
  if (!entry || !isCachedPlan(entry.record.plan)) {
    clearPointer(viewer.id, sessionId);
    return null;
  }
  let materialized: ReturnType<typeof materializeActiveWorkoutEntry>;
  try {
    materialized = materializeActiveWorkoutEntry(entry);
  } catch {
    clearPointer(viewer.id, sessionId);
    await cache().deleteSession(viewer.id, sessionId).catch(() => undefined);
    return null;
  }
  const plan = entry.record.plan;
  const identity = entry.record.session;
  const session: ActiveSession = {
    id: identity.id,
    draftRevision: entry.record.confirmedRevision,
    ...(entry.record.confirmedWriteToken
      ? { draftWriteToken: entry.record.confirmedWriteToken }
      : {}),
    draftSavedAt: entry.record.updatedAt,
    workoutId: identity.workoutId,
    programVersionId: identity.programVersionId,
    ...(identity.scheduledWorkoutId
      ? { scheduledWorkoutId: identity.scheduledWorkoutId }
      : {}),
    itemLogIds: identity.itemLogIds ?? {},
    ...materialized.snapshot,
  };
  const schedule: ScheduledWorkout = plan.schedule
    ? {
        ...plan.schedule,
        status: "in_progress",
        workout: { ...plan.workout, scheduledWorkoutId: plan.schedule.id },
        detailsLoaded: true,
      }
    : {
        id: identity.scheduledWorkoutId ?? `cached-${identity.id}`,
        programId: `cached-${identity.programVersionId}`,
        programTitle: "Cached workout",
        programVersionId: identity.programVersionId,
        workoutId: identity.workoutId,
        workoutTitle: plan.workout.title,
        slotLabel: plan.workout.dayLabel || plan.workout.title,
        plannedDate: plan.workout.plannedDate,
        sequenceNumber: 1,
        status: "in_progress",
        workout: {
          ...plan.workout,
          scheduledWorkoutId:
            identity.scheduledWorkoutId ?? `cached-${identity.id}`,
        },
        detailsLoaded: true,
      };
  return {
    profile: plan.profile ?? profileFromViewer(viewer),
    programCatalog: [],
    schedulableProgramIds: [],
    schedulablePrograms: [],
    draftProgram: null,
    activeProgram: null,
    scheduledWorkouts: [schedule],
    globalExercises: [],
    personalExercises: [],
    completedSessions: [],
    coachConnections: [],
    coachedAthletes: [],
    pendingCoachInvites: [],
    outgoingCoachInvites: [],
    activeSession: session,
  };
}

export async function clearActiveWorkoutPersistenceForUser(userId: string) {
  invalidateUserPersistence(userId);
  clearPointer(userId);
  new ActiveWorkoutDraftStore().clearOnSignOut(userId);
  let cacheError: unknown;
  try {
    await cache().deleteUser(userId);
  } catch (error) {
    cacheError = error;
  }
  if (cacheError) throw cacheError;
}

function recordKeys(value: Record<string, unknown>) {
  return new Set(Object.keys(value));
}

/** Converts a full React form state transition into small durable operations. */
export function diffActiveWorkoutSnapshots(
  current: ActiveWorkoutDraftSnapshot,
  next: ActiveWorkoutDraftSnapshot,
) {
  const changes: ActiveWorkoutPatchChange[] = [];
  const setItemIds = new Set([
    ...Object.keys(current.setLogs),
    ...Object.keys(next.setLogs),
  ]);
  for (const itemId of setItemIds) {
    const currentRows = current.setLogs[itemId] ?? [];
    const nextRows = next.setLogs[itemId] ?? [];
    const commonLength = Math.min(currentRows.length, nextRows.length);
    for (let index = 0; index < commonLength; index += 1) {
      for (const field of ["reps", "load", "rpe"] as const) {
        if (currentRows[index][field] !== nextRows[index][field]) {
          changes.push({
            type: "set-set-field",
            itemId,
            index,
            field,
            value: nextRows[index][field],
          });
        }
      }
    }
    for (let index = currentRows.length - 1; index >= nextRows.length; index -= 1) {
      changes.push({ type: "remove-set", itemId, index });
    }
    for (let index = currentRows.length; index < nextRows.length; index += 1) {
      changes.push({
        type: "insert-set",
        itemId,
        index,
        value: nextRows[index],
      });
    }
  }

  const resultItemIds = new Set([
    ...Object.keys(current.resultLogs),
    ...Object.keys(next.resultLogs),
  ]);
  for (const itemId of resultItemIds) {
    const currentFields = current.resultLogs[itemId] ?? {};
    const nextFields = next.resultLogs[itemId] ?? {};
    const fields = new Set([
      ...recordKeys(currentFields),
      ...recordKeys(nextFields),
    ]);
    for (const field of fields) {
      if (!Object.prototype.hasOwnProperty.call(nextFields, field)) {
        changes.push({ type: "remove-result-field", itemId, field });
      } else if (currentFields[field] !== nextFields[field]) {
        changes.push({
          type: "set-result-field",
          itemId,
          field,
          value: nextFields[field],
        });
      }
    }
  }
  if (current.sessionRpe !== next.sessionRpe) {
    changes.push({ type: "set-session-rpe", value: next.sessionRpe });
  }
  if (current.sessionNote !== next.sessionNote) {
    changes.push({ type: "set-session-note", value: next.sessionNote });
  }
  return changes;
}

function retryDecision(error: unknown): ActiveWorkoutRetryDecision {
  if (error instanceof SessionRevisionConflictError) {
    return {
      category: "revision-conflict",
      retryable: false,
      ambiguous: false,
    };
  }
  const classified = classifyActiveWorkoutFailure(error, {
    online: typeof navigator === "undefined" ? undefined : navigator.onLine,
  });
  if (!classified.retryable && isAmbiguousSessionDraftError(error)) {
    return { category: "network", retryable: true, ambiguous: true };
  }
  return classified;
}

function uiConflict(
  sessionId: string,
  conflict: ActiveWorkoutRevisionConflict | null,
): ActiveWorkoutUiConflict | null {
  return conflict
    ? {
        sessionId,
        conflicts: conflict.conflicts,
        localCandidate: conflict.localCandidate,
        serverCandidate: conflict.serverCandidate,
      }
    : null;
}

export function useActiveWorkoutPersistence(
  options: UseActiveWorkoutPersistenceOptions,
) {
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);
  const [status, setStatus] =
    useState<SessionDraftSaveStatus>("saved");
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [localRecoveryAvailable, setLocalRecoveryAvailable] = useState(
    () => cache().kind !== "memory",
  );
  const [conflict, setConflict] =
    useState<ActiveWorkoutUiConflict | null>(null);
  const controllerRef =
    useRef<ActiveWorkoutLocalController<CachedActiveWorkoutPlan> | null>(null);
  const readySessionIdRef = useRef<string | null>(null);
  const controllerUserGenerationRef = useRef(
    userClearGeneration(options.userId),
  );
  const clearedSessionIdsRef = useRef(new Set<string>());
  const queuedSnapshotRef = useRef<{
    sessionId: string;
    snapshot: ActiveWorkoutDraftSnapshot;
  } | null>(null);
  const initializationPromiseRef = useRef<Promise<void>>(Promise.resolve());
  const stageTailRef = useRef<Promise<void>>(Promise.resolve());
  const syncPromiseRef = useRef<Promise<number> | null>(null);
  const syncTimerRef = useRef<number | null>(null);
  const syncNowRef = useRef<
    ((required?: boolean) => Promise<number>) | undefined
  >(undefined);
  const synchronousDraftStoreRef = useRef(new ActiveWorkoutDraftStore());

  const clearSyncTimer = useCallback(() => {
    if (syncTimerRef.current !== null) {
      window.clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
  }, []);

  const persistenceInvalidated = useCallback(
    (userId: string, sessionId: string) =>
      clearedSessionIdsRef.current.has(sessionId) ||
      userClearGeneration(userId) !== controllerUserGenerationRef.current,
    [],
  );

  const scheduleSync = useCallback(
    (delayMs = SERVER_SYNC_DELAY_MS) => {
      clearSyncTimer();
      syncTimerRef.current = window.setTimeout(() => {
        syncTimerRef.current = null;
        void syncNowRef.current?.(false).catch(() => undefined);
      }, delayMs);
    },
    [clearSyncTimer],
  );

  const stageSnapshot = useCallback(
    (next: ActiveWorkoutDraftSnapshot) => {
      const stagedFor = optionsRef.current;
      const stagedSessionId = stagedFor.session?.id;
      const readyAtCall =
        Boolean(stagedSessionId) &&
        readySessionIdRef.current === stagedSessionId &&
        controllerRef.current !== null;
      if (
        readyAtCall &&
        stagedFor.session &&
        stagedSessionId &&
        !persistenceInvalidated(stagedFor.userId, stagedSessionId)
      ) {
        const mirrored = synchronousDraftStoreRef.current.save(
          stagedFor.userId,
          stagedSessionId,
          stagedFor.session.draftRevision,
          next,
          activeSnapshot(stagedFor.session),
        );
        if (mirrored) setLocalRecoveryAvailable(true);
      }
      const operation = stageTailRef.current.then(async () => {
        const controller = controllerRef.current;
        const currentOptions = optionsRef.current;
        const sessionId = currentOptions.session?.id;
        if (!sessionId) return;
        if (persistenceInvalidated(currentOptions.userId, sessionId)) return;
        if (!controller || readySessionIdRef.current !== sessionId) {
          queuedSnapshotRef.current = { sessionId, snapshot: next };
          return;
        }
        const current = controller.getSnapshot()?.snapshot;
        if (!current) return;
        if (activeWorkoutSnapshotsEqual(current, next)) {
          if (cache().kind !== "memory") {
            synchronousDraftStoreRef.current.clearAfterCompletion(
              currentOptions.userId,
              sessionId,
            );
          }
          return;
        }
        for (const change of diffActiveWorkoutSnapshots(current, next)) {
          await controller.applyPatch(change);
        }
        if (cache().kind !== "memory") {
          synchronousDraftStoreRef.current.clearAfterCompletion(
            currentOptions.userId,
            sessionId,
          );
        }
        setLocalRecoveryAvailable(cache().kind !== "memory");
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          setStatus("unsaved-offline");
        } else {
          scheduleSync();
        }
      });
      stageTailRef.current = operation.then(
        () => undefined,
        () => undefined,
      );
      if (readyAtCall && stagedSessionId) {
        trackSessionWork(stagedFor.userId, stagedSessionId, operation);
      }
      return operation.catch((error) => {
        setLocalRecoveryAvailable(false);
        setStatus("error");
        optionsRef.current.onSyncError?.(error);
        throw error;
      });
    },
    [persistenceInvalidated, scheduleSync],
  );

  const reconcileRevisionConflict = useCallback(async () => {
    const controller = controllerRef.current;
    const repository = optionsRef.current.repository;
    const session = optionsRef.current.session;
    if (!controller || !repository || !session) {
      throw new Error("The active workout recovery context is unavailable");
    }
    const authoritative = await repository.reloadActiveSession(session.id);
    if (!authoritative) {
      throw new Error(
        "This workout is no longer active. Your entries remain saved on this device.",
      );
    }
    const state = await controller.reconcileAuthoritative(
      authoritative.draftRevision,
      activeSnapshot(authoritative),
      authoritative.draftWriteToken,
    );
    optionsRef.current.onSessionRefresh(authoritative);
    optionsRef.current.onApplySnapshot(state.snapshot);
    const nextConflict = uiConflict(session.id, state.revisionConflict);
    setConflict(nextConflict);
    if (nextConflict) {
      setStatus("error");
      throw new SessionRevisionConflictError(
        "This workout changed elsewhere. Choose which conflicting values to keep.",
      );
    }
    return state;
  }, []);

  const syncNow = useCallback(
    (required = false): Promise<number> => {
      if (syncPromiseRef.current) {
        const currentSync = syncPromiseRef.current;
        if (!required) return currentSync;
        return currentSync.then(() => {
          const nextSync = syncNowRef.current;
          if (!nextSync) {
            throw new Error("The active workout sync context is unavailable");
          }
          return nextSync(true);
        });
      }
      clearSyncTimer();
      const operation = (async () => {
        await initializationPromiseRef.current;
        await stageTailRef.current;
        const controller = controllerRef.current;
        const repository = optionsRef.current.repository;
        const session = optionsRef.current.session;
        if (!controller || !session) return 0;
        if (persistenceInvalidated(optionsRef.current.userId, session.id)) {
          return controller.getSnapshot()?.confirmedRevision ?? 0;
        }
        if (!repository) return controller.getSnapshot()?.confirmedRevision ?? 0;
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          setStatus("unsaved-offline");
          if (required) throw new Error("Reconnect before saving this workout");
          return controller.getSnapshot()?.confirmedRevision ?? 0;
        }

        for (
          let recoveryAttempt = 0;
          recoveryAttempt < MAX_REVISION_RECOVERIES;
          recoveryAttempt += 1
        ) {
          const pending = await controller.preparePendingMutation();
          if (!pending) {
            setStatus("saved");
            return controller.getSnapshot()?.confirmedRevision ?? 0;
          }
          setStatus("saving");
          try {
            const result = await runWithActiveWorkoutRetry(
              async () => {
                if (
                  persistenceInvalidated(optionsRef.current.userId, session.id)
                ) {
                  return {
                    revision:
                      controller.getSnapshot()?.confirmedRevision ??
                      pending.expectedRevision,
                  };
                }
                await controller.recordMutationAttempt(pending.idempotencyKey);
                const currentSession = optionsRef.current.session ?? session;
                return repository.saveSessionDraft(
                  currentSession,
                  pending.snapshot.setLogs,
                  pending.snapshot.resultLogs,
                  pending.snapshot.sessionRpe,
                  pending.snapshot.sessionNote,
                  pending.expectedRevision,
                  pending.idempotencyKey,
                );
              },
              {
                maxAttempts: 4,
                classify: retryDecision,
                onRetry: async (decision, _attempt, delayMs) => {
                  await controller.recordMutationFailure(
                    pending.idempotencyKey,
                    decision,
                    delayMs,
                  );
                },
              },
            );
            if (persistenceInvalidated(optionsRef.current.userId, session.id)) {
              return result.revision;
            }
            await controller.acknowledgeMutation(
              pending.idempotencyKey,
              result.revision,
            );
            optionsRef.current.onRevisionConfirmed(
              result.revision,
              pending.idempotencyKey,
            );
          } catch (error) {
            if (persistenceInvalidated(optionsRef.current.userId, session.id)) {
              return controller.getSnapshot()?.confirmedRevision ?? 0;
            }
            const decision = retryDecision(error);
            if (decision.category === "revision-conflict") {
              await reconcileRevisionConflict();
              continue;
            }
            try {
              await controller.recordMutationFailure(
                pending.idempotencyKey,
                decision,
              );
            } catch {
              // The mutation may already have been reconciled by another event.
            }
            setStatus(
              typeof navigator !== "undefined" && !navigator.onLine
                ? "unsaved-offline"
                : "error",
            );
            optionsRef.current.onSyncError?.(error);
            throw error;
          }
        }
        throw new SessionRevisionConflictError();
      })();
      const tracked = operation.finally(() => {
        if (syncPromiseRef.current === tracked) syncPromiseRef.current = null;
      });
      syncPromiseRef.current = tracked;
      return tracked;
    },
    [clearSyncTimer, persistenceInvalidated, reconcileRevisionConflict],
  );
  useEffect(() => {
    syncNowRef.current = syncNow;
  }, [syncNow]);

  useEffect(() => {
    const session = options.session;
    const workout = options.workout;
    clearSyncTimer();
    controllerRef.current?.dispose();
    controllerRef.current = null;
    readySessionIdRef.current = null;
    stageTailRef.current = Promise.resolve();
    queuedSnapshotRef.current = null;
    initializationPromiseRef.current = Promise.resolve();
    if (!session || !workout) {
      return;
    }

    let cancelled = false;
    clearedSessionIdsRef.current.delete(session.id);
    const initialUserGeneration = userClearGeneration(options.userId);
    controllerUserGenerationRef.current = initialUserGeneration;
    const previousSessionWork = sessionWorkTails.get(
      sessionWorkKey(options.userId, session.id),
    );
    const invalidated = () =>
      clearedSessionIdsRef.current.has(session.id) ||
      userClearGeneration(options.userId) !== initialUserGeneration;
    const initialUiSnapshot = options.snapshot;
    const plan: CachedActiveWorkoutPlan = {
      workout,
      ...(options.schedule ? { schedule: options.schedule } : {}),
      profile: options.profile,
    };
    const controller = new ActiveWorkoutLocalController<CachedActiveWorkoutPlan>({
      cache: cache(),
      userId: options.userId,
      sessionId: session.id,
      onPersistenceError: () => setLocalRecoveryAvailable(false),
    });

    const initialization = (async () => {
      await previousSessionWork;
      if (!cancelled) setConflict(null);
      await importLegacyActiveWorkoutDraft({
        cache: cache(),
        userId: options.userId,
        session: sessionIdentity(session),
        serverRevision: session.draftRevision,
        plan,
      });
      await controller.initialize({
        session: sessionIdentity(session),
        plan,
        serverRevision: session.draftRevision,
        serverWriteToken: session.draftWriteToken,
        serverSnapshot: activeSnapshot(session),
      });
      const reconciled = await controller.reconcileAuthoritative(
        session.draftRevision,
        activeSnapshot(session),
        session.draftWriteToken,
      );
      const queued = queuedSnapshotRef.current;
      const newestUiSnapshot =
        queued?.sessionId === session.id
          ? queued.snapshot
          : optionsRef.current.snapshot;
      const desiredSnapshot = activeWorkoutSnapshotsEqual(
        newestUiSnapshot,
        initialUiSnapshot,
      )
        ? reconciled.snapshot
        : mergeActiveWorkoutDraftSnapshots(
            initialUiSnapshot,
            newestUiSnapshot,
            reconciled.snapshot,
          ).snapshot;
      if (invalidated()) {
        await controller.clearAfterCompletion();
        controller.dispose();
        return;
      }
      if (cancelled) {
        for (const change of diffActiveWorkoutSnapshots(
          reconciled.snapshot,
          desiredSnapshot,
        )) {
          await controller.applyPatch(change);
        }
        if (invalidated()) await controller.clearAfterCompletion();
        controller.dispose();
        return;
      }
      controllerRef.current = controller;
      readySessionIdRef.current = session.id;
      queuedSnapshotRef.current = null;
      writePointer(options.userId, session.id);
      setLocalRecoveryAvailable(cache().kind !== "memory");

      optionsRef.current.onApplySnapshot(desiredSnapshot);
      const nextConflict = uiConflict(session.id, reconciled.revisionConflict);
      setConflict(nextConflict);
      if (!activeWorkoutSnapshotsEqual(desiredSnapshot, reconciled.snapshot)) {
        await stageSnapshot(desiredSnapshot);
      }
      const latestState = controller.getSnapshot();
      if (nextConflict) setStatus("error");
      else if (latestState?.dirty) {
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          setStatus("unsaved-offline");
        } else {
          scheduleSync(0);
        }
      } else setStatus("saved");
    })();
    initializationPromiseRef.current = initialization;
    trackSessionWork(options.userId, session.id, initialization);
    void initialization.catch((error) => {
      if (cancelled) {
        controller.dispose();
        return;
      }
      controller.dispose();
      setLocalRecoveryAvailable(false);
      setStatus(
        typeof navigator !== "undefined" && !navigator.onLine
          ? "unsaved-offline"
          : "error",
      );
      optionsRef.current.onSyncError?.(error);
    });

    return () => {
      cancelled = true;
      const wasReady = controllerRef.current === controller;
      if (wasReady) {
        controllerRef.current = null;
        readySessionIdRef.current = null;
        controller.dispose();
      }
    };
    // The session/workout identity owns a controller. Other values flow via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.userId, options.session?.id, options.workout?.id]);

  useEffect(() => {
    if (!options.session || conflict) {
      return;
    }
    void stageSnapshot(options.snapshot).catch(() => undefined);
  }, [conflict, options.session, options.snapshot, stageSnapshot]);

  useEffect(() => {
    const resume = () => {
      const connected = navigator.onLine;
      setOnline(connected);
      if (connected) void syncNowRef.current?.(false).catch(() => undefined);
      else if (controllerRef.current?.getSnapshot()?.dirty) {
        setStatus("unsaved-offline");
      }
    };
    const background = () => {
      clearSyncTimer();
      void stageSnapshot(optionsRef.current.snapshot)
        .then(() =>
          navigator.onLine ? syncNowRef.current?.(false) : undefined,
        )
        .catch(() => undefined);
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") background();
      else resume();
    };
    window.addEventListener("online", resume);
    window.addEventListener("offline", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("pagehide", background);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("pagehide", background);
      document.removeEventListener("visibilitychange", visibility);
      clearSyncTimer();
    };
  }, [clearSyncTimer, stageSnapshot]);

  const resolveConflict = useCallback(
    async (keepLocal: boolean) => {
      const controller = controllerRef.current;
      if (!controller) throw new Error("The active workout is not ready");
      const state = await controller.resolveRevisionConflict(
        keepLocal ? "local" : "server",
      );
      setConflict(null);
      optionsRef.current.onApplySnapshot(state.snapshot);
      if (state.dirty) scheduleSync(0);
      else setStatus("saved");
      return state;
    },
    [scheduleSync],
  );

  const clearAfterCompletion = useCallback(async (sessionId: string) => {
    clearSyncTimer();
    clearedSessionIdsRef.current.add(sessionId);
    const userId = optionsRef.current.userId;
    clearPointer(userId, sessionId);
    new ActiveWorkoutDraftStore().clearAfterCompletion(
      userId,
      sessionId,
    );
    await syncPromiseRef.current?.catch(() => undefined);
    await stageTailRef.current.catch(() => undefined);
    const controller = controllerRef.current;
    try {
      if (controller && readySessionIdRef.current === sessionId) {
        await controller.clearAfterCompletion();
      } else {
        await cache().deleteSession(userId, sessionId);
      }
    } catch (error) {
      setLocalRecoveryAvailable(false);
      optionsRef.current.onSyncError?.(error);
    } finally {
      if (controller && readySessionIdRef.current === sessionId) {
        controller.dispose();
        controllerRef.current = null;
        readySessionIdRef.current = null;
      }
    }
    setConflict(null);
    setStatus("saved");
  }, [clearSyncTimer]);

  return {
    status,
    online,
    localRecoveryAvailable,
    conflict,
    flush: () => syncNow(true),
    recover: async () => {
      await reconcileRevisionConflict();
      return syncNow(true);
    },
    resolveConflict,
    clearAfterCompletion,
  };
}

export type ActiveWorkoutPersistenceState = ActiveWorkoutLocalState<CachedActiveWorkoutPlan>;
