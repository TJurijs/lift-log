import { mergeActiveWorkoutDraftSnapshots } from "./active-workout-draft-merge";
import type { ActiveWorkoutDraftSnapshot } from "./active-workout-draft-storage";
import type { ActiveWorkoutCache } from "./active-workout-cache";
import {
  activeWorkoutScopeKey,
  activeWorkoutSnapshotsEqual,
  applyActiveWorkoutPatch,
  cloneActiveWorkoutSnapshot,
  isActiveWorkoutDraftSnapshot,
  isActiveWorkoutLocalRecord,
  materializeActiveWorkoutEntry,
  ACTIVE_WORKOUT_LOCAL_SCHEMA_VERSION,
  type ActiveWorkoutCacheEntry,
  type ActiveWorkoutJournalPatch,
  type ActiveWorkoutLocalRecord,
  type ActiveWorkoutLocalState,
  type ActiveWorkoutPatchChange,
  type ActiveWorkoutPendingMutation,
  type ActiveWorkoutRevisionConflict,
  type ActiveWorkoutSessionIdentity,
} from "./active-workout-local-types";
import type { ActiveWorkoutRetryDecision } from "./active-workout-retry";

const DEFAULT_COMPACTION_PATCH_COUNT = 50;
const DEFAULT_COMPACTION_BYTES = 64 * 1_024;

export interface ActiveWorkoutLocalSeed<Plan = unknown> {
  session: ActiveWorkoutSessionIdentity;
  plan?: Plan;
  serverRevision: number;
  serverWriteToken?: string;
  serverSnapshot: ActiveWorkoutDraftSnapshot;
  createdAt?: string;
}

export interface ActiveWorkoutLocalControllerOptions {
  cache: ActiveWorkoutCache;
  userId: string;
  sessionId: string;
  now?: () => number;
  createIdempotencyKey?: () => string;
  compactAfterPatches?: number;
  compactAfterBytes?: number;
  onPersistenceError?: (error: unknown) => void;
}

export type ActiveWorkoutConflictResolution =
  | "local"
  | "server"
  | ActiveWorkoutDraftSnapshot;

function copyValue<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function defaultIdempotencyKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `active-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function assertRevision(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be zero or greater`);
  }
}

function assertTimestamp(value: string, label: string) {
  if (!Number.isFinite(Date.parse(value))) throw new TypeError(`${label} is invalid`);
}

function stateFromEntry<Plan>(
  entry: ActiveWorkoutCacheEntry<Plan>,
  materializedOverride?: ReturnType<typeof materializeActiveWorkoutEntry<Plan>>,
) {
  const materialized =
    materializedOverride ?? materializeActiveWorkoutEntry(entry);
  if (
    entry.record.pendingMutation &&
    entry.record.pendingMutation.throughSequence > materialized.latestSequence
  ) {
    throw new Error("Pending active workout mutation is ahead of local state");
  }
  if (
    entry.record.revisionConflict &&
    !activeWorkoutSnapshotsEqual(
      entry.record.revisionConflict.localCandidate,
      materialized.snapshot,
    )
  ) {
    throw new Error("Active workout conflict does not match local state");
  }
  const updatedAt =
    materialized.journal.at(-1)?.createdAt ?? entry.record.updatedAt;
  const state: ActiveWorkoutLocalState<Plan> = {
    userId: entry.record.userId,
    sessionId: entry.record.sessionId,
    session: copyValue(entry.record.session),
    ...(entry.record.plan === undefined
      ? {}
      : { plan: copyValue(entry.record.plan) }),
    snapshot: materialized.snapshot,
    confirmedSnapshot: cloneActiveWorkoutSnapshot(
      entry.record.confirmedSnapshot,
    ),
    confirmedRevision: entry.record.confirmedRevision,
    ...(entry.record.confirmedWriteToken === undefined
      ? {}
      : { confirmedWriteToken: entry.record.confirmedWriteToken }),
    latestSequence: materialized.latestSequence,
    confirmedThroughSequence: entry.record.confirmedThroughSequence,
    dirty:
      materialized.latestSequence > entry.record.confirmedThroughSequence ||
      !activeWorkoutSnapshotsEqual(
        materialized.snapshot,
        entry.record.confirmedSnapshot,
      ),
    pendingMutation: entry.record.pendingMutation
      ? copyValue(entry.record.pendingMutation)
      : null,
    revisionConflict: entry.record.revisionConflict
      ? copyValue(entry.record.revisionConflict)
      : null,
    updatedAt,
    ...(entry.record.legacyImport
      ? { legacyImport: copyValue(entry.record.legacyImport) }
      : {}),
  };
  return {
    state,
    normalizedEntry: {
      record: entry.record,
      journal: materialized.journal,
    } satisfies ActiveWorkoutCacheEntry<Plan>,
  };
}

/**
 * Local-first active workout state with a React external-store contract.
 * Every mutating method resolves only after the change is durable.
 */
export class ActiveWorkoutLocalController<Plan = unknown> {
  readonly #cache: ActiveWorkoutCache;
  readonly #userId: string;
  readonly #sessionId: string;
  readonly #now: () => number;
  readonly #createIdempotencyKey: () => string;
  readonly #compactAfterPatches: number;
  readonly #compactAfterBytes: number;
  readonly #onPersistenceError?: (error: unknown) => void;
  readonly #listeners = new Set<() => void>();
  #entry: ActiveWorkoutCacheEntry<Plan> | null = null;
  #state: ActiveWorkoutLocalState<Plan> | null = null;
  #tail: Promise<void> = Promise.resolve();
  #disposed = false;

  constructor(options: ActiveWorkoutLocalControllerOptions) {
    activeWorkoutScopeKey(options.userId, options.sessionId);
    const compactAfterPatches =
      options.compactAfterPatches ?? DEFAULT_COMPACTION_PATCH_COUNT;
    const compactAfterBytes =
      options.compactAfterBytes ?? DEFAULT_COMPACTION_BYTES;
    if (!Number.isSafeInteger(compactAfterPatches) || compactAfterPatches < 1) {
      throw new RangeError("Patch compaction threshold must be one or greater");
    }
    if (!Number.isSafeInteger(compactAfterBytes) || compactAfterBytes < 1) {
      throw new RangeError("Byte compaction threshold must be one or greater");
    }
    this.#cache = options.cache;
    this.#userId = options.userId;
    this.#sessionId = options.sessionId;
    this.#now = options.now ?? Date.now;
    this.#createIdempotencyKey =
      options.createIdempotencyKey ?? defaultIdempotencyKey;
    this.#compactAfterPatches = compactAfterPatches;
    this.#compactAfterBytes = compactAfterBytes;
    this.#onPersistenceError = options.onPersistenceError;
  }

  /** Pass directly to React's `useSyncExternalStore`. */
  readonly subscribe = (listener: () => void) => {
    this.#assertUsable();
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** Pass directly to React's `useSyncExternalStore`. */
  readonly getSnapshot = () => this.#state;

  async hydrate() {
    return this.#enqueue(async () => {
      const entry = await this.#cache.load<Plan>(this.#userId, this.#sessionId);
      if (!entry) {
        this.#setEntry(null);
        return null;
      }
      this.#assertEntryScope(entry);
      this.#setEntry(entry);
      return this.#state;
    });
  }

  async initialize(seed: ActiveWorkoutLocalSeed<Plan>) {
    return this.#enqueue(async () => {
      this.#assertSeed(seed);
      const existing = await this.#cache.load<Plan>(
        this.#userId,
        this.#sessionId,
      );
      if (existing) {
        this.#assertEntryScope(existing);
        if (
          existing.record.session.workoutId !== seed.session.workoutId ||
          existing.record.session.programVersionId !==
            seed.session.programVersionId
        ) {
          throw new Error("Stored active workout identity does not match the seed");
        }
        this.#setEntry(existing);
        return this.#requireState();
      }

      const createdAt = seed.createdAt ?? this.#timestamp();
      assertTimestamp(createdAt, "Active workout creation time");
      const snapshot = cloneActiveWorkoutSnapshot(seed.serverSnapshot);
      const record: ActiveWorkoutLocalRecord<Plan> = {
        schemaVersion: ACTIVE_WORKOUT_LOCAL_SCHEMA_VERSION,
        userId: this.#userId,
        sessionId: this.#sessionId,
        session: copyValue(seed.session),
        ...(seed.plan === undefined ? {} : { plan: copyValue(seed.plan) }),
        confirmedRevision: seed.serverRevision,
        ...(seed.serverWriteToken === undefined
          ? {}
          : { confirmedWriteToken: seed.serverWriteToken }),
        confirmedSnapshot: cloneActiveWorkoutSnapshot(snapshot),
        confirmedThroughSequence: 0,
        compactedSnapshot: snapshot,
        compactedThroughSequence: 0,
        pendingMutation: null,
        revisionConflict: null,
        createdAt,
        updatedAt: createdAt,
      };
      if (!isActiveWorkoutLocalRecord(record)) {
        throw new TypeError("Active workout seed is invalid");
      }
      await this.#cache.replace(record);
      this.#setEntry({ record, journal: [] });
      return this.#requireState();
    });
  }

  async applyPatch(change: ActiveWorkoutPatchChange) {
    return this.#enqueue(async () => {
      const state = this.#requireState();
      const entry = this.#requireEntry();
      const snapshot = applyActiveWorkoutPatch(state.snapshot, change);
      const patch: ActiveWorkoutJournalPatch = {
        sequence: state.latestSequence + 1,
        createdAt: this.#timestamp(),
        change: copyValue(change),
      };
      await this.#cache.appendPatch(this.#userId, this.#sessionId, patch);
      const nextEntry = {
        record: entry.record,
        journal: [...entry.journal, patch],
      };
      this.#setEntry(nextEntry, {
        snapshot,
        latestSequence: patch.sequence,
        journal: nextEntry.journal,
      });

      const currentEntry = this.#requireEntry();
      const journalBytes = currentEntry.journal.reduce(
        (total, item) => total + JSON.stringify(item).length,
        0,
      );
      if (
        currentEntry.journal.length >= this.#compactAfterPatches ||
        journalBytes >= this.#compactAfterBytes
      ) {
        try {
          await this.#compactCurrent(snapshot, patch.sequence, patch.createdAt);
        } catch (error) {
          // The incremental patch is already durable and remains reloadable.
          // Surface compaction trouble separately without misreporting the edit.
          this.#onPersistenceError?.(error);
        }
      }
      return this.#requireState();
    });
  }

  async compact() {
    return this.#enqueue(async () => {
      const state = this.#requireState();
      await this.#compactCurrent(
        state.snapshot,
        state.latestSequence,
        this.#timestamp(),
      );
      return this.#requireState();
    });
  }

  async preparePendingMutation() {
    return this.#enqueue(async () => {
      const state = this.#requireState();
      const entry = this.#requireEntry();
      if (state.revisionConflict) {
        throw new Error("Resolve the active workout revision conflict first");
      }
      if (state.pendingMutation) return copyValue(state.pendingMutation);
      if (!state.dirty) return null;

      const idempotencyKey = this.#createIdempotencyKey();
      if (
        typeof idempotencyKey !== "string" ||
        idempotencyKey.length === 0 ||
        idempotencyKey.length > 256
      ) {
        throw new TypeError("Idempotency key generator returned an invalid key");
      }
      const pendingMutation: ActiveWorkoutPendingMutation = {
        idempotencyKey,
        expectedRevision: state.confirmedRevision,
        throughSequence: state.latestSequence,
        snapshot: cloneActiveWorkoutSnapshot(state.snapshot),
        createdAt: this.#timestamp(),
        attemptCount: 0,
      };
      const record = {
        ...entry.record,
        pendingMutation,
        updatedAt: pendingMutation.createdAt,
      };
      await this.#cache.saveRecord(record);
      this.#setEntry({ record, journal: entry.journal });
      return copyValue(pendingMutation);
    });
  }

  async recordMutationAttempt(idempotencyKey: string) {
    return this.#enqueue(async () => {
      const entry = this.#requireEntry();
      const pending = this.#matchingPending(idempotencyKey);
      const attemptedAt = this.#timestamp();
      const pendingMutation: ActiveWorkoutPendingMutation = {
        ...pending,
        attemptCount: pending.attemptCount + 1,
        lastAttemptAt: attemptedAt,
        nextRetryAt: undefined,
        lastFailureCategory: undefined,
      };
      const record = {
        ...entry.record,
        pendingMutation,
        updatedAt: attemptedAt,
      };
      await this.#cache.saveRecord(record);
      this.#setEntry({ record, journal: entry.journal });
      return copyValue(pendingMutation);
    });
  }

  async recordMutationFailure(
    idempotencyKey: string,
    retryDecision: ActiveWorkoutRetryDecision,
    retryDelayMs?: number,
  ) {
    return this.#enqueue(async () => {
      const entry = this.#requireEntry();
      const pending = this.#matchingPending(idempotencyKey);
      if (
        retryDelayMs !== undefined &&
        (!Number.isFinite(retryDelayMs) || retryDelayMs < 0)
      ) {
        throw new RangeError("Retry delay must be zero or greater");
      }
      const failedAt = this.#timestamp();
      const pendingMutation: ActiveWorkoutPendingMutation = {
        ...pending,
        lastFailureCategory: retryDecision.category,
        nextRetryAt:
          retryDecision.retryable && retryDelayMs !== undefined
            ? new Date(Date.parse(failedAt) + retryDelayMs).toISOString()
            : undefined,
      };
      const record = {
        ...entry.record,
        pendingMutation,
        updatedAt: failedAt,
      };
      await this.#cache.saveRecord(record);
      this.#setEntry({ record, journal: entry.journal });
      return copyValue(pendingMutation);
    });
  }

  async acknowledgeMutation(idempotencyKey: string, confirmedRevision: number) {
    return this.#enqueue(async () => {
      assertRevision(confirmedRevision, "Confirmed revision");
      const state = this.#requireState();
      const entry = this.#requireEntry();
      const pending = this.#matchingPending(idempotencyKey);
      if (confirmedRevision !== pending.expectedRevision + 1) {
        throw new Error("Mutation acknowledgement has an unexpected revision");
      }
      const updatedAt = this.#timestamp();
      const record: ActiveWorkoutLocalRecord<Plan> = {
        ...entry.record,
        confirmedRevision,
        confirmedWriteToken: idempotencyKey,
        confirmedSnapshot: cloneActiveWorkoutSnapshot(pending.snapshot),
        confirmedThroughSequence: pending.throughSequence,
        compactedSnapshot: cloneActiveWorkoutSnapshot(state.snapshot),
        compactedThroughSequence: state.latestSequence,
        pendingMutation: null,
        revisionConflict: null,
        updatedAt,
      };
      await this.#cache.replace(record);
      this.#setEntry({ record, journal: [] });
      return this.#requireState();
    });
  }

  async reconcileAuthoritative(
    authoritativeRevision: number,
    authoritativeSnapshot: ActiveWorkoutDraftSnapshot,
    authoritativeWriteToken?: string,
  ) {
    return this.#enqueue(async () => {
      assertRevision(authoritativeRevision, "Authoritative revision");
      if (!isActiveWorkoutDraftSnapshot(authoritativeSnapshot)) {
        throw new TypeError("Authoritative active workout snapshot is invalid");
      }
      if (
        authoritativeWriteToken !== undefined &&
        (typeof authoritativeWriteToken !== "string" ||
          authoritativeWriteToken.length === 0 ||
          authoritativeWriteToken.length > 256)
      ) {
        throw new TypeError("Authoritative write token is invalid");
      }
      const state = this.#requireState();
      const entry = this.#requireEntry();
      if (authoritativeRevision < state.confirmedRevision) {
        throw new Error("Authoritative revision is older than the local base");
      }

      const authoritative = cloneActiveWorkoutSnapshot(authoritativeSnapshot);
      const pending = state.pendingMutation;
      if (
        pending &&
        authoritativeRevision === pending.expectedRevision + 1 &&
        (authoritativeWriteToken === pending.idempotencyKey ||
          activeWorkoutSnapshotsEqual(authoritative, pending.snapshot))
      ) {
        return this.#reconcileCommittedPending(
          entry,
          state,
          pending,
          authoritativeRevision,
          authoritative,
          authoritativeWriteToken ?? pending.idempotencyKey,
        );
      }

      if (authoritativeRevision === state.confirmedRevision) {
        if (
          activeWorkoutSnapshotsEqual(
            authoritative,
            state.confirmedSnapshot,
          )
        ) {
          if (
            authoritativeWriteToken !== undefined &&
            authoritativeWriteToken !== state.confirmedWriteToken
          ) {
            const record = {
              ...entry.record,
              confirmedWriteToken: authoritativeWriteToken,
              updatedAt: this.#timestamp(),
            };
            await this.#cache.saveRecord(record);
            this.#setEntry({ record, journal: entry.journal });
            return this.#requireState();
          }
          return state;
        }
        throw new Error("Server snapshot changed without a revision increment");
      }

      if (!state.dirty && !pending) {
        return this.#adoptAuthoritative(
          entry,
          state.latestSequence,
          authoritativeRevision,
          authoritative,
          authoritativeWriteToken,
        );
      }

      const merged = mergeActiveWorkoutDraftSnapshots(
        state.confirmedSnapshot,
        state.snapshot,
        authoritative,
      );
      const serverMerged = mergeActiveWorkoutDraftSnapshots(
        state.confirmedSnapshot,
        authoritative,
        state.snapshot,
      );
      const updatedAt = this.#timestamp();
      if (merged.conflicts.length > 0) {
        const revisionConflict: ActiveWorkoutRevisionConflict = {
          rejectedMutation: pending ? copyValue(pending) : null,
          authoritativeRevision,
          ...(authoritativeWriteToken === undefined
            ? {}
            : { authoritativeWriteToken }),
          authoritativeSnapshot: cloneActiveWorkoutSnapshot(authoritative),
          localCandidate: cloneActiveWorkoutSnapshot(merged.snapshot),
          serverCandidate: cloneActiveWorkoutSnapshot(serverMerged.snapshot),
          conflicts: [...merged.conflicts],
          detectedAt: updatedAt,
        };
        const record: ActiveWorkoutLocalRecord<Plan> = {
          ...entry.record,
          compactedSnapshot: cloneActiveWorkoutSnapshot(merged.snapshot),
          compactedThroughSequence: state.latestSequence,
          pendingMutation: null,
          revisionConflict,
          updatedAt,
        };
        await this.#cache.replace(record);
        this.#setEntry({ record, journal: [] });
        return this.#requireState();
      }

      const mergedIsConfirmed = activeWorkoutSnapshotsEqual(
        merged.snapshot,
        authoritative,
      );
      const compactedThroughSequence = mergedIsConfirmed
        ? state.latestSequence
        : state.latestSequence + 1;
      const record: ActiveWorkoutLocalRecord<Plan> = {
        ...entry.record,
        confirmedRevision: authoritativeRevision,
        ...(authoritativeWriteToken === undefined
          ? { confirmedWriteToken: undefined }
          : { confirmedWriteToken: authoritativeWriteToken }),
        confirmedSnapshot: cloneActiveWorkoutSnapshot(authoritative),
        confirmedThroughSequence: state.latestSequence,
        compactedSnapshot: cloneActiveWorkoutSnapshot(merged.snapshot),
        compactedThroughSequence,
        pendingMutation: null,
        revisionConflict: null,
        updatedAt,
      };
      await this.#cache.replace(record);
      this.#setEntry({ record, journal: [] });
      return this.#requireState();
    });
  }

  async resolveRevisionConflict(resolution: ActiveWorkoutConflictResolution) {
    return this.#enqueue(async () => {
      const state = this.#requireState();
      const entry = this.#requireEntry();
      const conflict = state.revisionConflict;
      if (!conflict) throw new Error("There is no active workout conflict to resolve");
      const snapshot =
        resolution === "local"
          ? conflict.localCandidate
          : resolution === "server"
            ? conflict.serverCandidate
            : resolution;
      if (!isActiveWorkoutDraftSnapshot(snapshot)) {
        throw new TypeError("Active workout conflict resolution is invalid");
      }
      const matchesServer = activeWorkoutSnapshotsEqual(
        snapshot,
        conflict.authoritativeSnapshot,
      );
      const compactedThroughSequence = matchesServer
        ? state.latestSequence
        : state.latestSequence + 1;
      const record: ActiveWorkoutLocalRecord<Plan> = {
        ...entry.record,
        confirmedRevision: conflict.authoritativeRevision,
        ...(conflict.authoritativeWriteToken === undefined
          ? { confirmedWriteToken: undefined }
          : { confirmedWriteToken: conflict.authoritativeWriteToken }),
        confirmedSnapshot: cloneActiveWorkoutSnapshot(
          conflict.authoritativeSnapshot,
        ),
        confirmedThroughSequence: state.latestSequence,
        compactedSnapshot: cloneActiveWorkoutSnapshot(snapshot),
        compactedThroughSequence,
        pendingMutation: null,
        revisionConflict: null,
        updatedAt: this.#timestamp(),
      };
      await this.#cache.replace(record);
      this.#setEntry({ record, journal: [] });
      return this.#requireState();
    });
  }

  async clearAfterCompletion() {
    return this.#enqueue(async () => {
      await this.#cache.deleteSession(this.#userId, this.#sessionId);
      this.#setEntry(null);
    });
  }

  async clearOnSignOut() {
    return this.#enqueue(async () => {
      await this.#cache.deleteUser(this.#userId);
      this.#setEntry(null);
    });
  }

  dispose() {
    this.#disposed = true;
    this.#listeners.clear();
  }

  #enqueue<T>(operation: () => Promise<T>) {
    this.#assertUsable();
    const result = this.#tail.then(operation, operation);
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  #assertUsable() {
    if (this.#disposed) throw new Error("Active workout controller is disposed");
  }

  #timestamp() {
    const value = this.#now();
    if (!Number.isFinite(value)) throw new TypeError("Current time is invalid");
    return new Date(value).toISOString();
  }

  #assertSeed(seed: ActiveWorkoutLocalSeed<Plan>) {
    if (seed.session.id !== this.#sessionId) {
      throw new Error("Active workout seed has the wrong session ID");
    }
    assertRevision(seed.serverRevision, "Server revision");
    if (
      seed.serverWriteToken !== undefined &&
      (typeof seed.serverWriteToken !== "string" ||
        seed.serverWriteToken.length === 0 ||
        seed.serverWriteToken.length > 256)
    ) {
      throw new TypeError("Server write token is invalid");
    }
    if (!isActiveWorkoutDraftSnapshot(seed.serverSnapshot)) {
      throw new TypeError("Active workout seed snapshot is invalid");
    }
  }

  #assertEntryScope(entry: ActiveWorkoutCacheEntry<Plan>) {
    if (
      entry.record.userId !== this.#userId ||
      entry.record.sessionId !== this.#sessionId
    ) {
      throw new Error("Active workout cache returned a different user or session");
    }
  }

  #setEntry(
    entry: ActiveWorkoutCacheEntry<Plan> | null,
    materializedOverride?: ReturnType<typeof materializeActiveWorkoutEntry<Plan>>,
  ) {
    const previous = this.#state;
    if (!entry) {
      this.#entry = null;
      this.#state = null;
    } else {
      const { state, normalizedEntry } = stateFromEntry(
        entry,
        materializedOverride,
      );
      this.#entry = normalizedEntry;
      this.#state = state;
    }
    if (this.#state !== previous) {
      this.#listeners.forEach((listener) => listener());
    }
  }

  #requireEntry() {
    if (!this.#entry) throw new Error("Active workout controller is not initialized");
    return this.#entry;
  }

  #requireState() {
    if (!this.#state) throw new Error("Active workout controller is not initialized");
    return this.#state;
  }

  #matchingPending(idempotencyKey: string) {
    const pending = this.#requireState().pendingMutation;
    if (!pending || pending.idempotencyKey !== idempotencyKey) {
      throw new Error("Active workout pending mutation key does not match");
    }
    return pending;
  }

  async #compactCurrent(
    snapshot: ActiveWorkoutDraftSnapshot,
    latestSequence: number,
    updatedAt: string,
  ) {
    const entry = this.#requireEntry();
    const record: ActiveWorkoutLocalRecord<Plan> = {
      ...entry.record,
      compactedSnapshot: cloneActiveWorkoutSnapshot(snapshot),
      compactedThroughSequence: latestSequence,
      updatedAt,
    };
    await this.#cache.replace(record);
    this.#setEntry({ record, journal: [] });
  }

  async #reconcileCommittedPending(
    entry: ActiveWorkoutCacheEntry<Plan>,
    state: ActiveWorkoutLocalState<Plan>,
    pending: ActiveWorkoutPendingMutation,
    authoritativeRevision: number,
    authoritativeSnapshot: ActiveWorkoutDraftSnapshot,
    authoritativeWriteToken: string,
  ) {
    const merged = mergeActiveWorkoutDraftSnapshots(
      pending.snapshot,
      state.snapshot,
      authoritativeSnapshot,
    );
    const serverMerged = mergeActiveWorkoutDraftSnapshots(
      pending.snapshot,
      authoritativeSnapshot,
      state.snapshot,
    );
    const updatedAt = this.#timestamp();
    if (merged.conflicts.length > 0) {
      const revisionConflict: ActiveWorkoutRevisionConflict = {
        rejectedMutation: null,
        authoritativeRevision,
        authoritativeWriteToken,
        authoritativeSnapshot: cloneActiveWorkoutSnapshot(
          authoritativeSnapshot,
        ),
        localCandidate: cloneActiveWorkoutSnapshot(merged.snapshot),
        serverCandidate: cloneActiveWorkoutSnapshot(serverMerged.snapshot),
        conflicts: [...merged.conflicts],
        detectedAt: updatedAt,
      };
      const conflictRecord: ActiveWorkoutLocalRecord<Plan> = {
        ...entry.record,
        compactedSnapshot: cloneActiveWorkoutSnapshot(merged.snapshot),
        compactedThroughSequence: state.latestSequence,
        pendingMutation: null,
        revisionConflict,
        updatedAt,
      };
      await this.#cache.replace(conflictRecord);
      this.#setEntry({ record: conflictRecord, journal: [] });
      return this.#requireState();
    }
    const matchesAuthoritative = activeWorkoutSnapshotsEqual(
      merged.snapshot,
      authoritativeSnapshot,
    );
    const record: ActiveWorkoutLocalRecord<Plan> = {
      ...entry.record,
      confirmedRevision: authoritativeRevision,
      confirmedWriteToken: authoritativeWriteToken,
      confirmedSnapshot: cloneActiveWorkoutSnapshot(authoritativeSnapshot),
      confirmedThroughSequence: matchesAuthoritative
        ? state.latestSequence
        : pending.throughSequence,
      compactedSnapshot: cloneActiveWorkoutSnapshot(merged.snapshot),
      compactedThroughSequence: state.latestSequence,
      pendingMutation: null,
      revisionConflict: null,
      updatedAt,
    };
    await this.#cache.replace(record);
    this.#setEntry({ record, journal: [] });
    return this.#requireState();
  }

  async #adoptAuthoritative(
    entry: ActiveWorkoutCacheEntry<Plan>,
    latestSequence: number,
    authoritativeRevision: number,
    authoritativeSnapshot: ActiveWorkoutDraftSnapshot,
    authoritativeWriteToken?: string,
  ) {
    const record: ActiveWorkoutLocalRecord<Plan> = {
      ...entry.record,
      confirmedRevision: authoritativeRevision,
      ...(authoritativeWriteToken === undefined
        ? { confirmedWriteToken: undefined }
        : { confirmedWriteToken: authoritativeWriteToken }),
      confirmedSnapshot: cloneActiveWorkoutSnapshot(authoritativeSnapshot),
      confirmedThroughSequence: latestSequence,
      compactedSnapshot: cloneActiveWorkoutSnapshot(authoritativeSnapshot),
      compactedThroughSequence: latestSequence,
      pendingMutation: null,
      revisionConflict: null,
      updatedAt: this.#timestamp(),
    };
    await this.#cache.replace(record);
    this.#setEntry({ record, journal: [] });
    return this.#requireState();
  }
}

/** Clears every active-workout cache entry owned by the signing-out user. */
export function clearActiveWorkoutUser(
  cache: ActiveWorkoutCache,
  userId: string,
) {
  activeWorkoutScopeKey(userId, "scope-check");
  return cache.deleteUser(userId);
}
