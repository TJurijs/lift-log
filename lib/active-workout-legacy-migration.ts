import {
  ActiveWorkoutDraftStore,
  type ActiveWorkoutDraftRestoreResult,
  type StoredActiveWorkoutDraft,
} from "./active-workout-draft-storage";
import type { ActiveWorkoutCache } from "./active-workout-cache";
import {
  ACTIVE_WORKOUT_LOCAL_SCHEMA_VERSION,
  activeWorkoutSnapshotsEqual,
  cloneActiveWorkoutSnapshot,
  isActiveWorkoutLocalRecord,
  materializeActiveWorkoutEntry,
  type ActiveWorkoutCacheEntry,
  type ActiveWorkoutLocalRecord,
  type ActiveWorkoutSessionIdentity,
} from "./active-workout-local-types";

export interface ActiveWorkoutLegacyMigrationOptions<Plan = unknown> {
  draft: StoredActiveWorkoutDraft;
  session: ActiveWorkoutSessionIdentity;
  plan?: Plan;
  now?: () => number;
}

export interface ImportLegacyActiveWorkoutDraftOptions<Plan = unknown> {
  cache: ActiveWorkoutCache;
  storage?: Storage | null;
  userId: string;
  session: ActiveWorkoutSessionIdentity;
  /** Current server revision, used to report a legacy revision mismatch. */
  serverRevision: number;
  plan?: Plan;
  now?: () => number;
  removeAfterImport?: boolean;
}

type LegacyTerminalStatus = Exclude<
  ActiveWorkoutDraftRestoreResult["status"],
  "restored" | "revision-mismatch"
>;

export type ActiveWorkoutLegacyImportResult<Plan = unknown> =
  | {
      status: "imported";
      legacyStatus: "restored" | "revision-mismatch";
      entry: ActiveWorkoutCacheEntry<Plan>;
      legacyRemoved: boolean;
    }
  | { status: "already-present"; entry: ActiveWorkoutCacheEntry<Plan> }
  | { status: LegacyTerminalStatus };

function copyValue<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function timestamp(now: () => number) {
  const value = now();
  if (!Number.isFinite(value)) throw new TypeError("Current time is invalid");
  return new Date(value).toISOString();
}

/** Converts a validated schema-v1 localStorage draft into the journal store. */
export function migrateLegacyActiveWorkoutDraft<Plan = unknown>(
  options: ActiveWorkoutLegacyMigrationOptions<Plan>,
) {
  const { draft, session } = options;
  if (session.id !== draft.sessionId) {
    throw new Error("Legacy draft and active session IDs do not match");
  }
  if (!Number.isSafeInteger(draft.baseRevision) || draft.baseRevision < 0) {
    throw new TypeError("Legacy draft revision is invalid");
  }
  const importedAt = timestamp(options.now ?? Date.now);
  const confirmedSnapshot = cloneActiveWorkoutSnapshot(
    draft.baseSnapshot ?? draft.snapshot,
  );
  const localSnapshot = cloneActiveWorkoutSnapshot(draft.snapshot);
  // A legacy payload without baseSnapshot cannot prove that its local values
  // were server-confirmed, so conservatively retain it as one dirty change.
  const dirty =
    draft.baseSnapshot === undefined ||
    !activeWorkoutSnapshotsEqual(confirmedSnapshot, localSnapshot);
  const record: ActiveWorkoutLocalRecord<Plan> = {
    schemaVersion: ACTIVE_WORKOUT_LOCAL_SCHEMA_VERSION,
    userId: draft.userId,
    sessionId: draft.sessionId,
    session: copyValue(session),
    ...(options.plan === undefined ? {} : { plan: copyValue(options.plan) }),
    confirmedRevision: draft.baseRevision,
    confirmedSnapshot,
    confirmedThroughSequence: 0,
    compactedSnapshot: localSnapshot,
    compactedThroughSequence: dirty ? 1 : 0,
    pendingMutation: null,
    revisionConflict: null,
    createdAt: draft.savedAt,
    updatedAt: importedAt,
    legacyImport: {
      schemaVersion: draft.schemaVersion,
      importedAt,
      legacySavedAt: draft.savedAt,
    },
  };
  if (!isActiveWorkoutLocalRecord(record)) {
    throw new TypeError("Legacy active workout draft cannot be migrated");
  }
  return record;
}

/**
 * Imports at most once. The legacy key is removed only after the v1 cache has
 * durably accepted the replacement record.
 */
export async function importLegacyActiveWorkoutDraft<Plan = unknown>(
  options: ImportLegacyActiveWorkoutDraftOptions<Plan>,
): Promise<ActiveWorkoutLegacyImportResult<Plan>> {
  const { userId, session } = options;
  const legacyStore = new ActiveWorkoutDraftStore({
    storage: options.storage,
    now: options.now,
  });
  const restored = legacyStore.restore(
    userId,
    session.id,
    options.serverRevision,
  );
  const existing = await options.cache.load<Plan>(userId, session.id);
  if (existing) {
    if (
      restored.status !== "restored" &&
      restored.status !== "revision-mismatch"
    ) {
      return { status: "already-present", entry: existing };
    }
    const materialized = materializeActiveWorkoutEntry(existing);
    if (
      activeWorkoutSnapshotsEqual(
        materialized.snapshot,
        restored.draft.snapshot,
      )
    ) {
      if (options.removeAfterImport !== false) {
        legacyStore.clearAfterCompletion(userId, session.id);
      }
      return { status: "already-present", entry: existing };
    }
    // The synchronous mirror is written before each async journal update. A
    // differing mirror therefore represents work that may have been cut off by
    // suspension between the localStorage write and the IndexedDB transaction.
  }
  if (restored.status !== "restored" && restored.status !== "revision-mismatch") {
    return { status: restored.status };
  }

  const record = migrateLegacyActiveWorkoutDraft({
    draft: restored.draft,
    session,
    ...(options.plan === undefined ? {} : { plan: options.plan }),
    now: options.now,
  });
  await options.cache.replace(record);
  const legacyRemoved =
    options.removeAfterImport === false
      ? false
      : legacyStore.clearAfterCompletion(userId, session.id);
  return {
    status: "imported",
    legacyStatus: restored.status,
    entry: { record, journal: [] },
    legacyRemoved,
  };
}
