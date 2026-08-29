import type { ActiveWorkoutDraftSnapshot } from "./active-workout-draft-storage";
import type { SessionSetValue } from "./domain";

export const ACTIVE_WORKOUT_LOCAL_SCHEMA_VERSION = 1 as const;
export const ACTIVE_WORKOUT_LOCAL_MAX_PATCHES = 5_000;

const MAX_ITEM_COUNT = 250;
const MAX_ENTRY_COUNT = 5_000;
const MAX_KEY_LENGTH = 256;
const MAX_FIELD_LENGTH = 128;
const blockedRecordKeys = new Set(["__proto__", "constructor", "prototype"]);

export interface ActiveWorkoutSessionIdentity {
  id: string;
  workoutId: string;
  programVersionId: string;
  scheduledWorkoutId?: string;
  itemLogIds?: Record<string, string>;
}

export type ActiveWorkoutPatchChange =
  | { type: "set-session-rpe"; value: string }
  | { type: "set-session-note"; value: string }
  | {
      type: "set-set-field";
      itemId: string;
      index: number;
      field: keyof SessionSetValue;
      value: string;
    }
  | {
      type: "replace-set";
      itemId: string;
      index: number;
      value: SessionSetValue;
    }
  | {
      type: "insert-set";
      itemId: string;
      index: number;
      value: SessionSetValue;
    }
  | { type: "remove-set"; itemId: string; index: number }
  | {
      type: "set-result-field";
      itemId: string;
      field: string;
      value: string;
    }
  | { type: "remove-result-field"; itemId: string; field: string };

export interface ActiveWorkoutJournalPatch {
  sequence: number;
  createdAt: string;
  change: ActiveWorkoutPatchChange;
}

export type ActiveWorkoutFailureCategory =
  | "offline"
  | "timeout"
  | "network"
  | "rate-limit"
  | "server"
  | "revision-conflict"
  | "auth"
  | "validation"
  | "aborted"
  | "unknown";

export interface ActiveWorkoutPendingMutation {
  idempotencyKey: string;
  expectedRevision: number;
  throughSequence: number;
  snapshot: ActiveWorkoutDraftSnapshot;
  createdAt: string;
  attemptCount: number;
  lastAttemptAt?: string;
  nextRetryAt?: string;
  lastFailureCategory?: ActiveWorkoutFailureCategory;
}

export interface ActiveWorkoutRevisionConflict {
  rejectedMutation: ActiveWorkoutPendingMutation | null;
  authoritativeRevision: number;
  authoritativeWriteToken?: string;
  authoritativeSnapshot: ActiveWorkoutDraftSnapshot;
  localCandidate: ActiveWorkoutDraftSnapshot;
  serverCandidate: ActiveWorkoutDraftSnapshot;
  conflicts: string[];
  detectedAt: string;
}

export interface ActiveWorkoutLegacyImportMetadata {
  schemaVersion: number;
  importedAt: string;
  legacySavedAt: string;
}

/**
 * Durable metadata and compacted snapshots. Journal patches live separately in
 * the cache so a keystroke never needs to rewrite this full record.
 */
export interface ActiveWorkoutLocalRecord<Plan = unknown> {
  schemaVersion: typeof ACTIVE_WORKOUT_LOCAL_SCHEMA_VERSION;
  userId: string;
  sessionId: string;
  session: ActiveWorkoutSessionIdentity;
  plan?: Plan;
  confirmedRevision: number;
  /** Idempotency token attached to the currently confirmed server revision. */
  confirmedWriteToken?: string;
  confirmedSnapshot: ActiveWorkoutDraftSnapshot;
  confirmedThroughSequence: number;
  compactedSnapshot: ActiveWorkoutDraftSnapshot;
  compactedThroughSequence: number;
  pendingMutation: ActiveWorkoutPendingMutation | null;
  revisionConflict: ActiveWorkoutRevisionConflict | null;
  createdAt: string;
  updatedAt: string;
  legacyImport?: ActiveWorkoutLegacyImportMetadata;
}

export interface ActiveWorkoutCacheEntry<Plan = unknown> {
  record: ActiveWorkoutLocalRecord<Plan>;
  journal: ActiveWorkoutJournalPatch[];
}

export interface ActiveWorkoutLocalState<Plan = unknown> {
  userId: string;
  sessionId: string;
  session: ActiveWorkoutSessionIdentity;
  plan?: Plan;
  snapshot: ActiveWorkoutDraftSnapshot;
  confirmedSnapshot: ActiveWorkoutDraftSnapshot;
  confirmedRevision: number;
  confirmedWriteToken?: string;
  latestSequence: number;
  confirmedThroughSequence: number;
  dirty: boolean;
  pendingMutation: ActiveWorkoutPendingMutation | null;
  revisionConflict: ActiveWorkoutRevisionConflict | null;
  updatedAt: string;
  legacyImport?: ActiveWorkoutLegacyImportMetadata;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSafeKey(value: unknown) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_KEY_LENGTH &&
    !blockedRecordKeys.has(value)
  );
}

function isBoundedString(value: unknown, maximumLength = MAX_FIELD_LENGTH) {
  return typeof value === "string" && value.length <= maximumLength;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isSetValue(value: unknown): value is SessionSetValue {
  return (
    isPlainRecord(value) &&
    Object.keys(value).every((key) => ["reps", "load", "rpe"].includes(key)) &&
    isBoundedString(value.reps) &&
    isBoundedString(value.load) &&
    isBoundedString(value.rpe)
  );
}

export function isActiveWorkoutDraftSnapshot(
  value: unknown,
): value is ActiveWorkoutDraftSnapshot {
  if (
    !isPlainRecord(value) ||
    !hasOnlyKeys(value, ["setLogs", "resultLogs", "sessionRpe", "sessionNote"]) ||
    !isPlainRecord(value.setLogs) ||
    !isPlainRecord(value.resultLogs) ||
    !/^(?:|[1-9]|10)$/.test(String(value.sessionRpe)) ||
    !isBoundedString(value.sessionNote, 4_000)
  ) {
    return false;
  }

  const setLogs = Object.entries(value.setLogs);
  const resultLogs = Object.entries(value.resultLogs);
  if (setLogs.length + resultLogs.length > MAX_ITEM_COUNT) return false;

  let entryCount = 0;
  for (const [itemId, entries] of setLogs) {
    if (!isSafeKey(itemId) || !Array.isArray(entries)) return false;
    entryCount += entries.length;
    if (entryCount > MAX_ENTRY_COUNT || !entries.every(isSetValue)) return false;
  }

  for (const [itemId, fields] of resultLogs) {
    if (!isSafeKey(itemId) || !isPlainRecord(fields)) return false;
    for (const [field, fieldValue] of Object.entries(fields)) {
      entryCount += 1;
      if (
        entryCount > MAX_ENTRY_COUNT ||
        !isSafeKey(field) ||
        !isBoundedString(fieldValue)
      ) {
        return false;
      }
    }
  }
  return true;
}

export function cloneActiveWorkoutSnapshot(
  snapshot: ActiveWorkoutDraftSnapshot,
): ActiveWorkoutDraftSnapshot {
  return {
    setLogs: Object.fromEntries(
      Object.entries(snapshot.setLogs).map(([itemId, entries]) => [
        itemId,
        entries.map((entry) => ({ ...entry })),
      ]),
    ),
    resultLogs: Object.fromEntries(
      Object.entries(snapshot.resultLogs).map(([itemId, fields]) => [
        itemId,
        { ...fields },
      ]),
    ),
    sessionRpe: snapshot.sessionRpe,
    sessionNote: snapshot.sessionNote,
  };
}

function sameStringRecord(
  left: Record<string, string>,
  right: Record<string, string>,
) {
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        left[key] === right[key],
    )
  );
}

export function activeWorkoutSnapshotsEqual(
  left: ActiveWorkoutDraftSnapshot,
  right: ActiveWorkoutDraftSnapshot,
) {
  if (
    left.sessionRpe !== right.sessionRpe ||
    left.sessionNote !== right.sessionNote
  ) {
    return false;
  }
  const leftSetIds = Object.keys(left.setLogs);
  if (leftSetIds.length !== Object.keys(right.setLogs).length) return false;
  for (const itemId of leftSetIds) {
    const leftEntries = left.setLogs[itemId];
    const rightEntries = right.setLogs[itemId];
    if (
      !rightEntries ||
      leftEntries.length !== rightEntries.length ||
      leftEntries.some(
        (entry, index) =>
          entry.reps !== rightEntries[index].reps ||
          entry.load !== rightEntries[index].load ||
          entry.rpe !== rightEntries[index].rpe,
      )
    ) {
      return false;
    }
  }
  const leftResultIds = Object.keys(left.resultLogs);
  return (
    leftResultIds.length === Object.keys(right.resultLogs).length &&
    leftResultIds.every(
      (itemId) =>
        right.resultLogs[itemId] !== undefined &&
        sameStringRecord(left.resultLogs[itemId], right.resultLogs[itemId]),
    )
  );
}

function assertSafeKey(value: string, label: string) {
  if (!isSafeKey(value)) throw new TypeError(`${label} is invalid`);
}

function assertIndex(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be zero or greater`);
  }
}

function assertSetValue(value: SessionSetValue) {
  if (!isSetValue(value)) throw new TypeError("Workout set value is invalid");
}

function assertSnapshotGrowth(
  snapshot: ActiveWorkoutDraftSnapshot,
  additionalItems: number,
  additionalEntries: number,
) {
  const itemCount =
    Object.keys(snapshot.setLogs).length +
    Object.keys(snapshot.resultLogs).length;
  let entryCount = 0;
  Object.values(snapshot.setLogs).forEach((entries) => {
    entryCount += entries.length;
  });
  Object.values(snapshot.resultLogs).forEach((fields) => {
    entryCount += Object.keys(fields).length;
  });
  if (
    itemCount + additionalItems > MAX_ITEM_COUNT ||
    entryCount + additionalEntries > MAX_ENTRY_COUNT
  ) {
    throw new RangeError("Workout patch exceeds the local draft bounds");
  }
}

export function applyActiveWorkoutPatch(
  source: ActiveWorkoutDraftSnapshot,
  change: ActiveWorkoutPatchChange,
): ActiveWorkoutDraftSnapshot {
  if (change.type === "set-session-rpe") {
    if (
      typeof change.value !== "string" ||
      !/^(?:|[1-9]|10)$/.test(change.value)
    ) {
      throw new RangeError("Session RPE must be empty or a whole number from 1 to 10");
    }
    return { ...source, sessionRpe: change.value };
  }
  if (change.type === "set-session-note") {
    if (!isBoundedString(change.value, 4_000)) {
      throw new RangeError("Session note cannot exceed 4000 characters");
    }
    return { ...source, sessionNote: change.value };
  }

  assertSafeKey(change.itemId, "Workout item ID");
  if (change.type === "set-result-field") {
    assertSafeKey(change.field, "Result field");
    if (!isBoundedString(change.value)) {
      throw new RangeError("Result value is too long");
    }
    const existingFields = source.resultLogs[change.itemId];
    if (
      existingFields === undefined ||
      !Object.prototype.hasOwnProperty.call(existingFields, change.field)
    ) {
      assertSnapshotGrowth(source, existingFields === undefined ? 1 : 0, 1);
    }
    return {
      ...source,
      resultLogs: {
        ...source.resultLogs,
        [change.itemId]: {
          ...(source.resultLogs[change.itemId] ?? {}),
          [change.field]: change.value,
        },
      },
    };
  }
  if (change.type === "remove-result-field") {
    assertSafeKey(change.field, "Result field");
    const fields = { ...(source.resultLogs[change.itemId] ?? {}) };
    delete fields[change.field];
    const resultLogs = { ...source.resultLogs };
    if (Object.keys(fields).length) resultLogs[change.itemId] = fields;
    else delete resultLogs[change.itemId];
    return { ...source, resultLogs };
  }

  assertIndex(change.index, "Workout set index");
  const entries = [...(source.setLogs[change.itemId] ?? [])];
  if (change.type === "insert-set") {
    if (change.index > entries.length) {
      throw new RangeError("Workout set insertion is outside the current list");
    }
    assertSetValue(change.value);
    assertSnapshotGrowth(
      source,
      Object.prototype.hasOwnProperty.call(source.setLogs, change.itemId) ? 0 : 1,
      1,
    );
    entries.splice(change.index, 0, { ...change.value });
  } else {
    if (change.index >= entries.length) {
      throw new RangeError("Workout set index does not exist");
    }
    if (change.type === "remove-set") {
      entries.splice(change.index, 1);
    } else if (change.type === "replace-set") {
      assertSetValue(change.value);
      entries[change.index] = { ...change.value };
    } else {
      if (!isBoundedString(change.value)) {
        throw new RangeError("Workout set value is too long");
      }
      if (!(["reps", "load", "rpe"] as unknown[]).includes(change.field)) {
        throw new TypeError("Workout set field is invalid");
      }
      entries[change.index] = {
        ...entries[change.index],
        [change.field]: change.value,
      };
    }
  }
  const snapshot = {
    ...source,
    setLogs: { ...source.setLogs, [change.itemId]: entries },
  };
  return snapshot;
}

export function materializeActiveWorkoutEntry<Plan>(
  entry: ActiveWorkoutCacheEntry<Plan>,
) {
  const patches = [...entry.journal]
    .filter((patch) => patch.sequence > entry.record.compactedThroughSequence)
    .sort((left, right) => left.sequence - right.sequence);
  if (patches.length > ACTIVE_WORKOUT_LOCAL_MAX_PATCHES) {
    throw new RangeError("Active workout patch journal is too large");
  }
  let previousSequence = entry.record.compactedThroughSequence;
  let snapshot = cloneActiveWorkoutSnapshot(entry.record.compactedSnapshot);
  for (const patch of patches) {
    if (
      !Number.isSafeInteger(patch.sequence) ||
      patch.sequence !== previousSequence + 1
    ) {
      throw new Error("Active workout patch journal is out of order");
    }
    snapshot = applyActiveWorkoutPatch(snapshot, patch.change);
    previousSequence = patch.sequence;
  }
  return { snapshot, latestSequence: previousSequence, journal: patches };
}

function isSessionIdentity(value: unknown): value is ActiveWorkoutSessionIdentity {
  if (!isPlainRecord(value)) return false;
  if (
    !hasOnlyKeys(value, [
      "id",
      "workoutId",
      "programVersionId",
      "scheduledWorkoutId",
      "itemLogIds",
    ]) ||
    !isSafeKey(value.id) ||
    !isSafeKey(value.workoutId) ||
    !isSafeKey(value.programVersionId) ||
    (value.scheduledWorkoutId !== undefined &&
      !isSafeKey(value.scheduledWorkoutId))
  ) {
    return false;
  }
  if (value.itemLogIds === undefined) return true;
  return (
    isPlainRecord(value.itemLogIds) &&
    Object.entries(value.itemLogIds).every(
      ([itemId, itemLogId]) => isSafeKey(itemId) && isSafeKey(itemLogId),
    )
  );
}

function isPendingMutation(value: unknown): value is ActiveWorkoutPendingMutation {
  if (!isPlainRecord(value)) return false;
  return (
    hasOnlyKeys(value, [
      "idempotencyKey",
      "expectedRevision",
      "throughSequence",
      "snapshot",
      "createdAt",
      "attemptCount",
      "lastAttemptAt",
      "nextRetryAt",
      "lastFailureCategory",
    ]) &&
    isSafeKey(value.idempotencyKey) &&
    Number.isSafeInteger(value.expectedRevision) &&
    Number(value.expectedRevision) >= 0 &&
    Number.isSafeInteger(value.throughSequence) &&
    Number(value.throughSequence) >= 0 &&
    isActiveWorkoutDraftSnapshot(value.snapshot) &&
    typeof value.createdAt === "string" &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    Number.isSafeInteger(value.attemptCount) &&
    Number(value.attemptCount) >= 0 &&
    (value.lastAttemptAt === undefined ||
      (typeof value.lastAttemptAt === "string" &&
        Number.isFinite(Date.parse(value.lastAttemptAt)))) &&
    (value.nextRetryAt === undefined ||
      (typeof value.nextRetryAt === "string" &&
        Number.isFinite(Date.parse(value.nextRetryAt)))) &&
    (value.lastFailureCategory === undefined ||
      [
        "offline",
        "timeout",
        "network",
        "rate-limit",
        "server",
        "revision-conflict",
        "auth",
        "validation",
        "aborted",
        "unknown",
      ].includes(String(value.lastFailureCategory)))
  );
}

function isRevisionConflict(value: unknown): value is ActiveWorkoutRevisionConflict {
  if (!isPlainRecord(value)) return false;
  return (
    hasOnlyKeys(value, [
      "rejectedMutation",
      "authoritativeRevision",
      "authoritativeWriteToken",
      "authoritativeSnapshot",
      "localCandidate",
      "serverCandidate",
      "conflicts",
      "detectedAt",
    ]) &&
    (value.rejectedMutation === null || isPendingMutation(value.rejectedMutation)) &&
    Number.isSafeInteger(value.authoritativeRevision) &&
    Number(value.authoritativeRevision) >= 0 &&
    (value.authoritativeWriteToken === undefined ||
      isSafeKey(value.authoritativeWriteToken)) &&
    isActiveWorkoutDraftSnapshot(value.authoritativeSnapshot) &&
    isActiveWorkoutDraftSnapshot(value.localCandidate) &&
    isActiveWorkoutDraftSnapshot(value.serverCandidate) &&
    Array.isArray(value.conflicts) &&
    value.conflicts.length > 0 &&
    value.conflicts.every((path) => isBoundedString(path, 1_024)) &&
    typeof value.detectedAt === "string" &&
    Number.isFinite(Date.parse(value.detectedAt))
  );
}

function isLegacyImport(value: unknown): value is ActiveWorkoutLegacyImportMetadata {
  return (
    isPlainRecord(value) &&
    hasOnlyKeys(value, ["schemaVersion", "importedAt", "legacySavedAt"]) &&
    Number.isSafeInteger(value.schemaVersion) &&
    Number(value.schemaVersion) >= 1 &&
    typeof value.importedAt === "string" &&
    Number.isFinite(Date.parse(value.importedAt)) &&
    typeof value.legacySavedAt === "string" &&
    Number.isFinite(Date.parse(value.legacySavedAt))
  );
}

export function isActiveWorkoutLocalRecord(
  value: unknown,
): value is ActiveWorkoutLocalRecord {
  if (!isPlainRecord(value)) return false;
  const session = value.session;
  return (
    hasOnlyKeys(value, [
      "schemaVersion",
      "userId",
      "sessionId",
      "session",
      "plan",
      "confirmedRevision",
      "confirmedWriteToken",
      "confirmedSnapshot",
      "confirmedThroughSequence",
      "compactedSnapshot",
      "compactedThroughSequence",
      "pendingMutation",
      "revisionConflict",
      "createdAt",
      "updatedAt",
      "legacyImport",
    ]) &&
    value.schemaVersion === ACTIVE_WORKOUT_LOCAL_SCHEMA_VERSION &&
    isSafeKey(value.userId) &&
    isSafeKey(value.sessionId) &&
    isSessionIdentity(session) &&
    session.id === value.sessionId &&
    Number.isSafeInteger(value.confirmedRevision) &&
    Number(value.confirmedRevision) >= 0 &&
    (value.confirmedWriteToken === undefined ||
      isSafeKey(value.confirmedWriteToken)) &&
    Number.isSafeInteger(value.confirmedThroughSequence) &&
    Number(value.confirmedThroughSequence) >= 0 &&
    Number.isSafeInteger(value.compactedThroughSequence) &&
    Number(value.compactedThroughSequence) >= Number(value.confirmedThroughSequence) &&
    isActiveWorkoutDraftSnapshot(value.confirmedSnapshot) &&
    isActiveWorkoutDraftSnapshot(value.compactedSnapshot) &&
    (value.pendingMutation === null ||
      (isPendingMutation(value.pendingMutation) &&
        value.pendingMutation.expectedRevision === value.confirmedRevision &&
        value.pendingMutation.throughSequence >=
          Number(value.confirmedThroughSequence))) &&
    (value.revisionConflict === null ||
      (isRevisionConflict(value.revisionConflict) &&
        value.revisionConflict.authoritativeRevision >
          Number(value.confirmedRevision))) &&
    !(value.pendingMutation && value.revisionConflict) &&
    typeof value.createdAt === "string" &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    typeof value.updatedAt === "string" &&
    Number.isFinite(Date.parse(value.updatedAt)) &&
    (value.legacyImport === undefined || isLegacyImport(value.legacyImport))
  );
}

export function activeWorkoutScopeKey(userId: string, sessionId: string) {
  assertSafeKey(userId, "User ID");
  assertSafeKey(sessionId, "Session ID");
  return `${encodeURIComponent(userId)}:${encodeURIComponent(sessionId)}`;
}
