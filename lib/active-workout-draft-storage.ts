import type { SessionSetValue } from "./domain";

export const ACTIVE_WORKOUT_DRAFT_SCHEMA_VERSION = 1 as const;
export const ACTIVE_WORKOUT_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const STORAGE_PREFIX = "liftlog:active-workout-draft:";
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_SERIALIZED_SIZE = 1_000_000;
const MAX_ITEM_COUNT = 250;
const MAX_ENTRY_COUNT = 5_000;
const MAX_SCOPE_LENGTH = 256;
const MAX_FIELD_LENGTH = 128;

export interface ActiveWorkoutDraftSnapshot {
  setLogs: Record<string, SessionSetValue[]>;
  resultLogs: Record<string, Record<string, string>>;
  sessionRpe: string;
  sessionNote: string;
}

export interface StoredActiveWorkoutDraft {
  schemaVersion: typeof ACTIVE_WORKOUT_DRAFT_SCHEMA_VERSION;
  userId: string;
  sessionId: string;
  /** Server-confirmed revision on which the local snapshot was based. */
  baseRevision: number;
  /**
   * Exact snapshot confirmed at `baseRevision`. Legacy schema-v1 records may
   * omit this until they are saved again.
   */
  baseSnapshot?: ActiveWorkoutDraftSnapshot;
  savedAt: string;
  snapshot: ActiveWorkoutDraftSnapshot;
}

export type ActiveWorkoutDraftRestoreResult =
  | { status: "restored"; draft: StoredActiveWorkoutDraft }
  | { status: "revision-mismatch"; draft: StoredActiveWorkoutDraft }
  | {
      status:
        | "missing"
        | "storage-unavailable"
        | "corrupt"
        | "unsupported-version"
        | "scope-mismatch"
        | "expired";
    };

export interface ActiveWorkoutDraftStoreOptions {
  storage?: Storage | null;
  now?: () => number;
  maxAgeMs?: number;
}

function defaultStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
) {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function isBoundedString(value: unknown, maximumLength: number) {
  return typeof value === "string" && value.length <= maximumLength;
}

function isValidScope(value: unknown) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_SCOPE_LENGTH
  );
}

function isValidItemKey(value: string) {
  return value.length > 0 && value.length <= MAX_SCOPE_LENGTH;
}

function isValidSetValue(value: unknown): value is SessionSetValue {
  return (
    isPlainRecord(value) &&
    hasOnlyKeys(value, ["reps", "load", "rpe"]) &&
    isBoundedString(value.reps, MAX_FIELD_LENGTH) &&
    isBoundedString(value.load, MAX_FIELD_LENGTH) &&
    isBoundedString(value.rpe, MAX_FIELD_LENGTH)
  );
}

function isValidSnapshot(value: unknown): value is ActiveWorkoutDraftSnapshot {
  if (
    !isPlainRecord(value) ||
    !hasOnlyKeys(value, ["setLogs", "resultLogs", "sessionRpe", "sessionNote"]) ||
    !isPlainRecord(value.setLogs) ||
    !isPlainRecord(value.resultLogs) ||
    !isBoundedString(value.sessionNote, 4_000) ||
    typeof value.sessionRpe !== "string" ||
    !/^(?:|[1-9]|10)$/.test(value.sessionRpe)
  ) {
    return false;
  }

  const setLogs = Object.entries(value.setLogs);
  const resultLogs = Object.entries(value.resultLogs);
  if (setLogs.length + resultLogs.length > MAX_ITEM_COUNT) return false;

  let entryCount = 0;
  for (const [itemId, entries] of setLogs) {
    if (!isValidItemKey(itemId) || !Array.isArray(entries)) return false;
    entryCount += entries.length;
    if (entryCount > MAX_ENTRY_COUNT || !entries.every(isValidSetValue)) {
      return false;
    }
  }

  for (const [itemId, fields] of resultLogs) {
    if (!isValidItemKey(itemId) || !isPlainRecord(fields)) return false;
    const fieldEntries = Object.entries(fields);
    entryCount += fieldEntries.length;
    if (
      entryCount > MAX_ENTRY_COUNT ||
      fieldEntries.some(
        ([field, fieldValue]) =>
          !isValidItemKey(field) ||
          !isBoundedString(fieldValue, MAX_FIELD_LENGTH),
      )
    ) {
      return false;
    }
  }

  return true;
}

function isStoredDraft(value: unknown): value is StoredActiveWorkoutDraft {
  return (
    isPlainRecord(value) &&
    hasOnlyKeys(value, [
      "schemaVersion",
      "userId",
      "sessionId",
      "baseRevision",
      "baseSnapshot",
      "savedAt",
      "snapshot",
    ]) &&
    value.schemaVersion === ACTIVE_WORKOUT_DRAFT_SCHEMA_VERSION &&
    isValidScope(value.userId) &&
    isValidScope(value.sessionId) &&
    Number.isSafeInteger(value.baseRevision) &&
    Number(value.baseRevision) >= 0 &&
    (value.baseSnapshot === undefined ||
      isValidSnapshot(value.baseSnapshot)) &&
    typeof value.savedAt === "string" &&
    Number.isFinite(Date.parse(value.savedAt)) &&
    isValidSnapshot(value.snapshot)
  );
}

function assertScope(userId: string, sessionId?: string) {
  if (!isValidScope(userId)) throw new TypeError("A valid user ID is required");
  if (sessionId !== undefined && !isValidScope(sessionId)) {
    throw new TypeError("A valid workout session ID is required");
  }
}

export function activeWorkoutDraftStorageKey(
  userId: string,
  sessionId: string,
) {
  assertScope(userId, sessionId);
  return `${STORAGE_PREFIX}${encodeURIComponent(userId)}:${encodeURIComponent(sessionId)}`;
}

function userStoragePrefix(userId: string) {
  assertScope(userId);
  return `${STORAGE_PREFIX}${encodeURIComponent(userId)}:`;
}

/**
 * Best-effort, synchronous recovery for an in-progress workout.
 *
 * localStorage is intentional: the client can restore the last typed snapshot
 * during reload bootstrap without waiting for IndexedDB. The tradeoff is that
 * the data is unencrypted and readable by scripts on this origin. Keep only
 * active-workout fields here, expire them quickly, and call the explicit clear
 * methods after confirmed completion and on sign-out.
 */
export class ActiveWorkoutDraftStore {
  readonly #storage: Storage | null;
  readonly #now: () => number;
  readonly #maxAgeMs: number;

  constructor(options: ActiveWorkoutDraftStoreOptions = {}) {
    this.#storage =
      options.storage === undefined ? defaultStorage() : options.storage;
    this.#now = options.now ?? Date.now;
    this.#maxAgeMs = options.maxAgeMs ?? ACTIVE_WORKOUT_DRAFT_MAX_AGE_MS;
    if (!Number.isFinite(this.#maxAgeMs) || this.#maxAgeMs <= 0) {
      throw new TypeError("Workout draft maximum age must be positive");
    }
  }

  save(
    userId: string,
    sessionId: string,
    baseRevision: number,
    snapshot: ActiveWorkoutDraftSnapshot,
    baseSnapshot: ActiveWorkoutDraftSnapshot = snapshot,
  ) {
    assertScope(userId, sessionId);
    if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) {
      throw new TypeError("Workout draft base revision must be zero or greater");
    }
    if (!isValidSnapshot(snapshot) || !isValidSnapshot(baseSnapshot)) {
      return false;
    }

    const now = this.#now();
    if (!Number.isFinite(now)) throw new TypeError("Current time is invalid");
    const draft: StoredActiveWorkoutDraft = {
      schemaVersion: ACTIVE_WORKOUT_DRAFT_SCHEMA_VERSION,
      userId,
      sessionId,
      baseRevision,
      baseSnapshot,
      savedAt: new Date(now).toISOString(),
      snapshot,
    };
    if (!isStoredDraft(draft)) {
      return false;
    }

    let serialized: string;
    try {
      serialized = JSON.stringify(draft);
    } catch {
      return false;
    }
    if (serialized.length > MAX_SERIALIZED_SIZE) {
      return false;
    }
    if (!this.#storage) return false;

    try {
      this.#storage.setItem(
        activeWorkoutDraftStorageKey(userId, sessionId),
        serialized,
      );
      return true;
    } catch {
      return false;
    }
  }

  restore(
    userId: string,
    sessionId: string,
    baseRevision: number,
  ): ActiveWorkoutDraftRestoreResult {
    assertScope(userId, sessionId);
    if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) {
      throw new TypeError("Workout draft base revision must be zero or greater");
    }
    if (!this.#storage) return { status: "storage-unavailable" };

    const key = activeWorkoutDraftStorageKey(userId, sessionId);
    let serialized: string | null;
    try {
      serialized = this.#storage.getItem(key);
    } catch {
      return { status: "storage-unavailable" };
    }
    if (serialized === null) return { status: "missing" };
    if (serialized.length > MAX_SERIALIZED_SIZE) {
      this.#remove(key);
      return { status: "corrupt" };
    }

    let candidate: unknown;
    try {
      candidate = JSON.parse(serialized);
    } catch {
      this.#remove(key);
      return { status: "corrupt" };
    }
    if (
      isPlainRecord(candidate) &&
      candidate.schemaVersion !== ACTIVE_WORKOUT_DRAFT_SCHEMA_VERSION
    ) {
      this.#remove(key);
      return { status: "unsupported-version" };
    }
    if (!isStoredDraft(candidate)) {
      this.#remove(key);
      return { status: "corrupt" };
    }
    if (candidate.userId !== userId || candidate.sessionId !== sessionId) {
      this.#remove(key);
      return { status: "scope-mismatch" };
    }

    const savedAt = Date.parse(candidate.savedAt);
    const age = this.#now() - savedAt;
    if (!Number.isFinite(age) || age < -MAX_CLOCK_SKEW_MS) {
      this.#remove(key);
      return { status: "corrupt" };
    }
    if (age > this.#maxAgeMs) {
      this.#remove(key);
      return { status: "expired" };
    }
    if (candidate.baseRevision !== baseRevision) {
      // The payload is still valid and correctly scoped. Return it so the
      // caller can preserve the athlete's newest local entries while using
      // the revision-recovery flow instead of silently discarding them.
      return { status: "revision-mismatch", draft: candidate };
    }

    return { status: "restored", draft: candidate };
  }

  /** Clear after the server confirms completion or abandonment. */
  clearAfterCompletion(userId: string, sessionId: string) {
    assertScope(userId, sessionId);
    return this.#remove(activeWorkoutDraftStorageKey(userId, sessionId));
  }

  /** Clear every locally recoverable workout belonging to the signing-out user. */
  clearOnSignOut(userId: string) {
    const prefix = userStoragePrefix(userId);
    if (!this.#storage) return 0;

    let removed = 0;
    try {
      for (let index = this.#storage.length - 1; index >= 0; index -= 1) {
        const key = this.#storage.key(index);
        if (key?.startsWith(prefix)) {
          this.#storage.removeItem(key);
          removed += 1;
        }
      }
    } catch {
      return removed;
    }
    return removed;
  }

  #remove(key: string) {
    if (!this.#storage) return false;
    try {
      this.#storage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }
}
