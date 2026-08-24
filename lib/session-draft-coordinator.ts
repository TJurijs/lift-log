export type SessionDraftSaveStatus =
  | "saved"
  | "saving"
  | "unsaved-offline"
  | "error";

export interface SessionDraftMutation<Snapshot> {
  expectedRevision: number;
  writeToken: string;
  snapshot: Snapshot;
}

export interface SessionDraftCoordinatorOptions {
  initialRevision?: number;
  online?: boolean;
  createToken?: () => string;
  onStatusChange?: (status: SessionDraftSaveStatus) => void;
  onError?: (error: unknown) => void;
}

type StagedMutation<Snapshot> = Omit<
  SessionDraftMutation<Snapshot>,
  "expectedRevision"
>;

type FlushWaiter = {
  resolve: (revision: number) => void;
  reject: (error: unknown) => void;
};

export class SessionDraftOfflineError extends Error {
  constructor() {
    super("Reconnect before saving this workout");
    this.name = "SessionDraftOfflineError";
  }
}

export class SessionDraftCoordinatorClosedError extends Error {
  constructor() {
    super("Session draft coordinator is closed");
    this.name = "SessionDraftCoordinatorClosedError";
  }
}

function defaultToken() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  throw new Error("A secure UUID generator is required for workout autosave");
}

/**
 * Serializes complete workout-draft snapshots while retaining an uncertain
 * write for exact-token replay. A newer staged snapshot waits until that replay
 * establishes the authoritative server revision.
 */
export class SessionDraftCoordinator<Snapshot> {
  readonly #write: (
    mutation: SessionDraftMutation<Snapshot>,
  ) => Promise<number>;
  readonly #createToken: () => string;
  readonly #onStatusChange?: (status: SessionDraftSaveStatus) => void;
  readonly #onError?: (error: unknown) => void;
  readonly #flushWaiters = new Set<FlushWaiter>();

  #confirmedRevision: number;
  #online: boolean;
  #status: SessionDraftSaveStatus = "saved";
  #closed = false;
  #active: SessionDraftMutation<Snapshot> | null = null;
  #retry: SessionDraftMutation<Snapshot> | null = null;
  #pending: StagedMutation<Snapshot> | null = null;

  constructor(
    write: (mutation: SessionDraftMutation<Snapshot>) => Promise<number>,
    options: SessionDraftCoordinatorOptions = {},
  ) {
    this.#write = write;
    this.#confirmedRevision = options.initialRevision ?? 0;
    this.#online = options.online ?? true;
    this.#createToken = options.createToken ?? defaultToken;
    this.#onStatusChange = options.onStatusChange;
    this.#onError = options.onError;
  }

  get confirmedRevision() {
    return this.#confirmedRevision;
  }

  get status() {
    return this.#status;
  }

  get hasUnsavedChanges() {
    return Boolean(this.#active || this.#retry || this.#pending);
  }

  stage(snapshot: Snapshot) {
    this.#assertOpen();
    this.#pending = { snapshot, writeToken: this.#createToken() };
    this.#setStatus(this.#online ? "saving" : "unsaved-offline");
  }

  enqueue(snapshot: Snapshot) {
    this.stage(snapshot);
    this.save();
  }

  save() {
    this.#assertOpen();
    if (!this.#online) {
      this.#setStatus("unsaved-offline");
      return;
    }
    this.#startNext();
  }

  setOnline(online: boolean) {
    if (this.#closed) return;
    this.#online = online;
    if (!online) {
      if (this.hasUnsavedChanges) this.#setStatus("unsaved-offline");
      return;
    }
    if (this.hasUnsavedChanges) {
      this.#setStatus("saving");
      this.#startNext();
    }
  }

  flushLatest(snapshot?: Snapshot): Promise<number> {
    if (this.#closed) {
      return Promise.reject(new SessionDraftCoordinatorClosedError());
    }
    if (snapshot !== undefined) this.stage(snapshot);
    if (!this.#online) {
      this.#setStatus("unsaved-offline");
      return Promise.reject(new SessionDraftOfflineError());
    }
    if (!this.hasUnsavedChanges) return Promise.resolve(this.#confirmedRevision);

    this.#setStatus("saving");
    this.#startNext();
    return new Promise<number>((resolve, reject) => {
      this.#flushWaiters.add({ resolve, reject });
    });
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#pending = null;
    this.#retry = null;
    this.#rejectFlushWaiters(new SessionDraftCoordinatorClosedError());
  }

  #assertOpen() {
    if (this.#closed) throw new SessionDraftCoordinatorClosedError();
  }

  #setStatus(status: SessionDraftSaveStatus) {
    if (this.#status === status) return;
    this.#status = status;
    this.#onStatusChange?.(status);
  }

  #startNext() {
    if (this.#closed || !this.#online || this.#active) return;

    const mutation =
      this.#retry ??
      (this.#pending
        ? {
            ...this.#pending,
            expectedRevision: this.#confirmedRevision,
          }
        : null);
    if (!mutation) {
      this.#setStatus("saved");
      this.#resolveFlushWaiters();
      return;
    }

    if (this.#retry) this.#retry = null;
    else this.#pending = null;
    this.#active = mutation;
    this.#setStatus("saving");

    void this.#write(mutation).then(
      (revision) => this.#settleSuccess(mutation, revision),
      (error: unknown) => this.#settleFailure(mutation, error),
    );
  }

  #settleSuccess(
    mutation: SessionDraftMutation<Snapshot>,
    revision: number,
  ) {
    if (this.#active !== mutation) return;
    this.#active = null;
    if (this.#closed) return;
    if (!Number.isSafeInteger(revision) || revision <= mutation.expectedRevision) {
      this.#settleFailure(
        mutation,
        new Error("Workout autosave returned an invalid revision"),
      );
      return;
    }
    this.#confirmedRevision = revision;

    if (!this.#online && this.#pending) {
      this.#setStatus("unsaved-offline");
      return;
    }
    this.#startNext();
  }

  #settleFailure(mutation: SessionDraftMutation<Snapshot>, error: unknown) {
    if (this.#active === mutation) this.#active = null;
    if (this.#closed) return;
    this.#retry = mutation;
    this.#setStatus(this.#online ? "error" : "unsaved-offline");
    try {
      this.#onError?.(error);
    } catch {
      // Reporting must never discard the exact mutation needed for replay.
    }
    this.#rejectFlushWaiters(error);
  }

  #resolveFlushWaiters() {
    for (const waiter of this.#flushWaiters) {
      waiter.resolve(this.#confirmedRevision);
    }
    this.#flushWaiters.clear();
  }

  #rejectFlushWaiters(error: unknown) {
    for (const waiter of this.#flushWaiters) waiter.reject(error);
    this.#flushWaiters.clear();
  }
}
