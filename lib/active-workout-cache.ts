import {
  activeWorkoutScopeKey,
  isActiveWorkoutLocalRecord,
  type ActiveWorkoutCacheEntry,
  type ActiveWorkoutJournalPatch,
  type ActiveWorkoutLocalRecord,
} from "./active-workout-local-types";

const STORAGE_PREFIX = "liftlog:active-workout:v1:";
const DEFAULT_DATABASE_NAME = "liftlog-active-workouts";
const DATABASE_VERSION = 1;
const SESSION_STORE = "sessions";
const PATCH_STORE = "patches";

export interface ActiveWorkoutCache {
  readonly kind: "indexeddb" | "local-storage" | "memory";
  load<Plan = unknown>(
    userId: string,
    sessionId: string,
  ): Promise<ActiveWorkoutCacheEntry<Plan> | null>;
  saveRecord<Plan>(record: ActiveWorkoutLocalRecord<Plan>): Promise<void>;
  appendPatch(
    userId: string,
    sessionId: string,
    patch: ActiveWorkoutJournalPatch,
  ): Promise<void>;
  replace<Plan>(
    record: ActiveWorkoutLocalRecord<Plan>,
    journal?: ActiveWorkoutJournalPatch[],
  ): Promise<void>;
  deleteSession(userId: string, sessionId: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function validPatch(value: unknown): value is ActiveWorkoutJournalPatch {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<ActiveWorkoutJournalPatch>;
  return (
    Number.isSafeInteger(candidate.sequence) &&
    Number(candidate.sequence) > 0 &&
    typeof candidate.createdAt === "string" &&
    Number.isFinite(Date.parse(candidate.createdAt)) &&
    typeof candidate.change === "object" &&
    candidate.change !== null &&
    typeof (candidate.change as { type?: unknown }).type === "string"
  );
}

function recordStorageKey(userId: string, sessionId: string) {
  return `${STORAGE_PREFIX}${activeWorkoutScopeKey(userId, sessionId)}:record`;
}

function patchStoragePrefix(userId: string, sessionId: string) {
  return `${STORAGE_PREFIX}${activeWorkoutScopeKey(userId, sessionId)}:patch:`;
}

function userStoragePrefix(userId: string) {
  activeWorkoutScopeKey(userId, "scope-check");
  return `${STORAGE_PREFIX}${encodeURIComponent(userId)}:`;
}

export class MemoryActiveWorkoutCache implements ActiveWorkoutCache {
  readonly kind = "memory" as const;
  readonly #records = new Map<string, ActiveWorkoutLocalRecord>();
  readonly #patches = new Map<string, Map<number, ActiveWorkoutJournalPatch>>();

  async load<Plan = unknown>(userId: string, sessionId: string) {
    const scopeKey = activeWorkoutScopeKey(userId, sessionId);
    const record = this.#records.get(scopeKey);
    if (!record) return null;
    return {
      record: cloneValue(record) as ActiveWorkoutLocalRecord<Plan>,
      journal: [...(this.#patches.get(scopeKey)?.values() ?? [])]
        .sort((left, right) => left.sequence - right.sequence)
        .map(cloneValue),
    };
  }

  async saveRecord<Plan>(record: ActiveWorkoutLocalRecord<Plan>) {
    this.#records.set(
      activeWorkoutScopeKey(record.userId, record.sessionId),
      cloneValue(record) as ActiveWorkoutLocalRecord,
    );
  }

  async appendPatch(
    userId: string,
    sessionId: string,
    patch: ActiveWorkoutJournalPatch,
  ) {
    const scopeKey = activeWorkoutScopeKey(userId, sessionId);
    const patches = this.#patches.get(scopeKey) ?? new Map();
    patches.set(patch.sequence, cloneValue(patch));
    this.#patches.set(scopeKey, patches);
  }

  async replace<Plan>(
    record: ActiveWorkoutLocalRecord<Plan>,
    journal: ActiveWorkoutJournalPatch[] = [],
  ) {
    const scopeKey = activeWorkoutScopeKey(record.userId, record.sessionId);
    this.#records.set(
      scopeKey,
      cloneValue(record) as ActiveWorkoutLocalRecord,
    );
    this.#patches.set(
      scopeKey,
      new Map(journal.map((patch) => [patch.sequence, cloneValue(patch)])),
    );
  }

  async deleteSession(userId: string, sessionId: string) {
    const scopeKey = activeWorkoutScopeKey(userId, sessionId);
    this.#records.delete(scopeKey);
    this.#patches.delete(scopeKey);
  }

  async deleteUser(userId: string) {
    activeWorkoutScopeKey(userId, "scope-check");
    for (const [scopeKey, record] of this.#records) {
      if (record.userId !== userId) continue;
      this.#records.delete(scopeKey);
      this.#patches.delete(scopeKey);
    }
  }
}

export class WebStorageActiveWorkoutCache implements ActiveWorkoutCache {
  readonly kind = "local-storage" as const;

  constructor(private readonly storage: Storage) {}

  async load<Plan = unknown>(userId: string, sessionId: string) {
    const recordKey = recordStorageKey(userId, sessionId);
    const serialized = this.storage.getItem(recordKey);
    if (serialized === null) return null;

    let record: unknown;
    try {
      record = JSON.parse(serialized);
    } catch {
      await this.deleteSession(userId, sessionId);
      return null;
    }
    if (!isActiveWorkoutLocalRecord(record)) {
      await this.deleteSession(userId, sessionId);
      return null;
    }
    if (record.userId !== userId || record.sessionId !== sessionId) {
      await this.deleteSession(userId, sessionId);
      return null;
    }

    const journal: ActiveWorkoutJournalPatch[] = [];
    const prefix = patchStoragePrefix(userId, sessionId);
    for (let index = 0; index < this.storage.length; index += 1) {
      const key = this.storage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const patchValue = this.storage.getItem(key);
      if (patchValue === null) continue;
      try {
        const patch: unknown = JSON.parse(patchValue);
        if (validPatch(patch)) journal.push(patch);
      } catch {
        // A malformed incremental patch is ignored; the compacted snapshot is
        // still valid and a later compaction will remove the bad key.
      }
    }
    journal.sort((left, right) => left.sequence - right.sequence);
    return {
      record: record as ActiveWorkoutLocalRecord<Plan>,
      journal,
    };
  }

  async saveRecord<Plan>(record: ActiveWorkoutLocalRecord<Plan>) {
    this.storage.setItem(
      recordStorageKey(record.userId, record.sessionId),
      JSON.stringify(record),
    );
  }

  async appendPatch(
    userId: string,
    sessionId: string,
    patch: ActiveWorkoutJournalPatch,
  ) {
    this.storage.setItem(
      `${patchStoragePrefix(userId, sessionId)}${patch.sequence}`,
      JSON.stringify(patch),
    );
  }

  async replace<Plan>(
    record: ActiveWorkoutLocalRecord<Plan>,
    journal: ActiveWorkoutJournalPatch[] = [],
  ) {
    // Write the new compacted base first. If the browser exits during cleanup,
    // stale patches at or below compactedThroughSequence are ignored on load.
    await this.saveRecord(record);
    const prefix = patchStoragePrefix(record.userId, record.sessionId);
    const keys: string[] = [];
    for (let index = 0; index < this.storage.length; index += 1) {
      const key = this.storage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    keys.forEach((key) => this.storage.removeItem(key));
    for (const patch of journal) {
      await this.appendPatch(record.userId, record.sessionId, patch);
    }
  }

  async deleteSession(userId: string, sessionId: string) {
    this.storage.removeItem(recordStorageKey(userId, sessionId));
    const prefix = patchStoragePrefix(userId, sessionId);
    const keys: string[] = [];
    for (let index = 0; index < this.storage.length; index += 1) {
      const key = this.storage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    keys.forEach((key) => this.storage.removeItem(key));
  }

  async deleteUser(userId: string) {
    const prefix = userStoragePrefix(userId);
    const keys: string[] = [];
    for (let index = 0; index < this.storage.length; index += 1) {
      const key = this.storage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    keys.forEach((key) => this.storage.removeItem(key));
  }
}

interface IndexedSessionRow {
  scopeKey: string;
  userId: string;
  record: ActiveWorkoutLocalRecord;
}

interface IndexedPatchRow {
  patchKey: string;
  scopeKey: string;
  userId: string;
  patch: ActiveWorkoutJournalPatch;
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("IndexedDB request failed")),
      { once: true },
    );
  });
}

function transactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener(
      "abort",
      () => reject(transaction.error ?? new Error("IndexedDB transaction aborted")),
      { once: true },
    );
    transaction.addEventListener(
      "error",
      () => reject(transaction.error ?? new Error("IndexedDB transaction failed")),
      { once: true },
    );
  });
}

function deleteIndexMatches(
  store: IDBObjectStore,
  indexName: string,
  value: IDBValidKey,
  afterDelete?: () => void,
) {
  return new Promise<void>((resolve, reject) => {
    const request = store.index(indexName).openKeyCursor(value);
    request.addEventListener("error", () => reject(request.error), { once: true });
    request.addEventListener("success", () => {
      const cursor = request.result;
      if (!cursor) {
        afterDelete?.();
        resolve();
        return;
      }
      store.delete(cursor.primaryKey);
      cursor.continue();
    });
  });
}

export class IndexedDbActiveWorkoutCache implements ActiveWorkoutCache {
  readonly kind = "indexeddb" as const;
  #openPromise: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly factory: IDBFactory,
    private readonly databaseName = DEFAULT_DATABASE_NAME,
  ) {}

  async load<Plan = unknown>(userId: string, sessionId: string) {
    const scopeKey = activeWorkoutScopeKey(userId, sessionId);
    const database = await this.#database();
    const transaction = database.transaction(
      [SESSION_STORE, PATCH_STORE],
      "readonly",
    );
    const completed = transactionComplete(transaction);
    const sessionRequest = transaction
      .objectStore(SESSION_STORE)
      .get(scopeKey) as IDBRequest<IndexedSessionRow | undefined>;
    const patchesRequest = transaction
      .objectStore(PATCH_STORE)
      .index("scopeKey")
      .getAll(scopeKey) as IDBRequest<IndexedPatchRow[]>;
    const [sessionRow, patchRows] = await Promise.all([
      requestResult(sessionRequest),
      requestResult(patchesRequest),
    ]);
    await completed;
    if (
      !sessionRow ||
      !isActiveWorkoutLocalRecord(sessionRow.record) ||
      sessionRow.record.userId !== userId ||
      sessionRow.record.sessionId !== sessionId
    ) {
      return null;
    }
    return {
      record: sessionRow.record as ActiveWorkoutLocalRecord<Plan>,
      journal: patchRows
        .map((row) => row.patch)
        .filter(validPatch)
        .sort((left, right) => left.sequence - right.sequence),
    };
  }

  async saveRecord<Plan>(record: ActiveWorkoutLocalRecord<Plan>) {
    const database = await this.#database();
    const transaction = database.transaction(SESSION_STORE, "readwrite");
    const completed = transactionComplete(transaction);
    transaction.objectStore(SESSION_STORE).put({
      scopeKey: activeWorkoutScopeKey(record.userId, record.sessionId),
      userId: record.userId,
      record,
    } satisfies IndexedSessionRow);
    await completed;
  }

  async appendPatch(
    userId: string,
    sessionId: string,
    patch: ActiveWorkoutJournalPatch,
  ) {
    const scopeKey = activeWorkoutScopeKey(userId, sessionId);
    const database = await this.#database();
    const transaction = database.transaction(PATCH_STORE, "readwrite");
    const completed = transactionComplete(transaction);
    transaction.objectStore(PATCH_STORE).put({
      patchKey: `${scopeKey}:${patch.sequence}`,
      scopeKey,
      userId,
      patch,
    } satisfies IndexedPatchRow);
    await completed;
  }

  async replace<Plan>(
    record: ActiveWorkoutLocalRecord<Plan>,
    journal: ActiveWorkoutJournalPatch[] = [],
  ) {
    const scopeKey = activeWorkoutScopeKey(record.userId, record.sessionId);
    const database = await this.#database();
    const transaction = database.transaction(
      [SESSION_STORE, PATCH_STORE],
      "readwrite",
    );
    const completed = transactionComplete(transaction);
    transaction.objectStore(SESSION_STORE).put({
      scopeKey,
      userId: record.userId,
      record,
    } satisfies IndexedSessionRow);
    const patchStore = transaction.objectStore(PATCH_STORE);
    await deleteIndexMatches(
      patchStore,
      "scopeKey",
      scopeKey,
      () =>
        journal.forEach((patch) =>
          patchStore.put({
            patchKey: `${scopeKey}:${patch.sequence}`,
            scopeKey,
            userId: record.userId,
            patch,
          } satisfies IndexedPatchRow),
        ),
    );
    await completed;
  }

  async deleteSession(userId: string, sessionId: string) {
    const scopeKey = activeWorkoutScopeKey(userId, sessionId);
    const database = await this.#database();
    const transaction = database.transaction(
      [SESSION_STORE, PATCH_STORE],
      "readwrite",
    );
    const completed = transactionComplete(transaction);
    transaction.objectStore(SESSION_STORE).delete(scopeKey);
    await deleteIndexMatches(
      transaction.objectStore(PATCH_STORE),
      "scopeKey",
      scopeKey,
    );
    await completed;
  }

  async deleteUser(userId: string) {
    activeWorkoutScopeKey(userId, "scope-check");
    const database = await this.#database();
    const transaction = database.transaction(
      [SESSION_STORE, PATCH_STORE],
      "readwrite",
    );
    const completed = transactionComplete(transaction);
    await Promise.all([
      deleteIndexMatches(transaction.objectStore(SESSION_STORE), "userId", userId),
      deleteIndexMatches(transaction.objectStore(PATCH_STORE), "userId", userId),
    ]);
    await completed;
  }

  async dispose() {
    const database = await this.#openPromise;
    database?.close();
    this.#openPromise = null;
  }

  #database() {
    if (this.#openPromise) return this.#openPromise;
    const pending = new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory.open(this.databaseName, DATABASE_VERSION);
      request.addEventListener("upgradeneeded", () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(SESSION_STORE)) {
          const sessions = database.createObjectStore(SESSION_STORE, {
            keyPath: "scopeKey",
          });
          sessions.createIndex("userId", "userId", { unique: false });
        }
        if (!database.objectStoreNames.contains(PATCH_STORE)) {
          const patches = database.createObjectStore(PATCH_STORE, {
            keyPath: "patchKey",
          });
          patches.createIndex("scopeKey", "scopeKey", { unique: false });
          patches.createIndex("userId", "userId", { unique: false });
        }
      });
      request.addEventListener("success", () => resolve(request.result), {
        once: true,
      });
      request.addEventListener(
        "error",
        () => reject(request.error ?? new Error("IndexedDB could not be opened")),
        { once: true },
      );
      request.addEventListener(
        "blocked",
        () => reject(new Error("IndexedDB upgrade is blocked by another tab")),
        { once: true },
      );
    });
    const recoverable = pending.catch((error) => {
      if (this.#openPromise === recoverable) this.#openPromise = null;
      throw error;
    });
    this.#openPromise = recoverable;
    return this.#openPromise;
  }
}

export interface ActiveWorkoutCacheFactoryOptions {
  indexedDB?: IDBFactory | null;
  storage?: Storage | null;
  databaseName?: string;
}

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Uses IndexedDB in browsers and deterministic safe fallbacks in tests. */
export function createActiveWorkoutCache(
  options: ActiveWorkoutCacheFactoryOptions = {},
): ActiveWorkoutCache {
  const factory =
    options.indexedDB === undefined
      ? typeof indexedDB === "undefined"
        ? null
        : indexedDB
      : options.indexedDB;
  if (factory) {
    return new IndexedDbActiveWorkoutCache(factory, options.databaseName);
  }
  const storage =
    options.storage === undefined ? browserStorage() : options.storage;
  return storage
    ? new WebStorageActiveWorkoutCache(storage)
    : new MemoryActiveWorkoutCache();
}
