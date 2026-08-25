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
  isRevisionConflict?: (error: unknown) => boolean;
  /** Defaults to true so existing callers keep exact-token replay semantics. */
  isAmbiguousFailure?: (error: unknown) => boolean;
  onStatusChange?: (status: SessionDraftSaveStatus) => void;
  onError?: (error: unknown) => void;
}

type PendingMutation<Snapshot> = {
  snapshot: Snapshot;
  writeToken: string | null;
};

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
  readonly #isRevisionConflict: (error: unknown) => boolean;
  readonly #isAmbiguousFailure: (error: unknown) => boolean;
  readonly #onStatusChange?: (status: SessionDraftSaveStatus) => void;
  readonly #onError?: (error: unknown) => void;
  readonly #flushWaiters = new Set<FlushWaiter>();

  #confirmedRevision: number;
  #online: boolean;
  #status: SessionDraftSaveStatus = "saved";
  #closed = false;
  #active: SessionDraftMutation<Snapshot> | null = null;
  #retry: SessionDraftMutation<Snapshot> | null = null;
  #pending: PendingMutation<Snapshot> | null = null;
  #revisionConflict: unknown | null = null;
  #deterministicFailure: unknown | null = null;

  constructor(
    write: (mutation: SessionDraftMutation<Snapshot>) => Promise<number>,
    options: SessionDraftCoordinatorOptions = {},
  ) {
    this.#write = write;
    this.#confirmedRevision = options.initialRevision ?? 0;
    this.#online = options.online ?? true;
    this.#createToken = options.createToken ?? defaultToken;
    this.#isRevisionConflict = options.isRevisionConflict ?? (() => false);
    this.#isAmbiguousFailure = options.isAmbiguousFailure ?? (() => true);
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

  get revisionResetRequired() {
    return this.#revisionConflict !== null;
  }

  stage(snapshot: Snapshot) {
    this.#assertOpen();
    this.#deterministicFailure = null;
    try {
      this.#pending = { snapshot, writeToken: this.#createToken() };
    } catch (error) {
      this.#pending = { snapshot, writeToken: null };
      this.#deterministicFailure = error;
      this.#setStatus(this.#online ? "error" : "unsaved-offline");
      this.#reportError(error);
      this.#rejectFlushWaiters(error);
      return;
    }
    this.#setStatus(
      !this.#online
        ? "unsaved-offline"
        : this.#revisionConflict !== null
          ? "error"
          : "saving",
    );
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
    if (this.#revisionConflict !== null) {
      this.#setStatus("error");
      return;
    }
    if (this.#deterministicFailure !== null) {
      this.#setStatus("error");
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
      if (
        this.#revisionConflict !== null ||
        this.#deterministicFailure !== null
      ) {
        this.#setStatus("error");
      } else {
        this.#setStatus("saving");
        this.#startNext();
      }
    }
  }

  /**
   * Re-seeds compare-and-swap state after the caller has loaded the
   * authoritative server revision. A known revision conflict keeps the latest
   * local snapshot pending, but never replays the rejected mutation until this
   * method is called. Ambiguous writes must still be resolved by exact-token
   * replay and therefore cannot be rebased.
   */
  rebase(authoritativeRevision: number) {
    this.#assertOpen();
    if (!Number.isSafeInteger(authoritativeRevision) || authoritativeRevision < 0) {
      throw new RangeError("Authoritative workout revision must be zero or greater");
    }
    if (this.#active) {
      throw new Error("Cannot rebase while a workout save is in progress");
    }
    if (this.#retry) {
      throw new Error("Cannot rebase an ambiguous workout save");
    }

    this.#confirmedRevision = authoritativeRevision;
    this.#revisionConflict = null;
    if (!this.hasUnsavedChanges) {
      this.#setStatus("saved");
      return;
    }
    if (!this.#online) {
      this.#setStatus("unsaved-offline");
      return;
    }
    if (this.#deterministicFailure !== null) {
      this.#setStatus("error");
      return;
    }
    this.#setStatus("saving");
    this.#startNext();
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
    if (this.#revisionConflict !== null) {
      this.#setStatus("error");
      return Promise.reject(this.#revisionConflict);
    }
    if (this.#deterministicFailure !== null) {
      this.#setStatus("error");
      return Promise.reject(this.#deterministicFailure);
    }
    if (!this.hasUnsavedChanges) return Promise.resolve(this.#confirmedRevision);

    this.#setStatus("saving");
    return new Promise<number>((resolve, reject) => {
      this.#flushWaiters.add({ resolve, reject });
      this.#startNext();
    });
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#pending = null;
    this.#retry = null;
    this.#revisionConflict = null;
    this.#deterministicFailure = null;
    this.#rejectFlushWaiters(new SessionDraftCoordinatorClosedError());
  }

  #assertOpen() {
    if (this.#closed) throw new SessionDraftCoordinatorClosedError();
  }

  #setStatus(status: SessionDraftSaveStatus) {
    if (this.#status === status) return;
    this.#status = status;
    try {
      this.#onStatusChange?.(status);
    } catch (error) {
      this.#reportError(error);
    }
  }

  #startNext() {
    if (
      this.#closed ||
      !this.#online ||
      this.#active ||
      this.#revisionConflict !== null ||
      this.#deterministicFailure !== null
    )
      return;

    const mutation =
      this.#retry ??
      (this.#pending?.writeToken
        ? {
            snapshot: this.#pending.snapshot,
            writeToken: this.#pending.writeToken,
            expectedRevision: this.#confirmedRevision,
          }
        : null);
    if (!mutation) {
      if (this.#pending) return;
      this.#setStatus("saved");
      this.#resolveFlushWaiters();
      return;
    }

    if (this.#retry) this.#retry = null;
    else this.#pending = null;
    this.#active = mutation;
    this.#setStatus("saving");

    let write: Promise<number>;
    try {
      write = this.#write(mutation);
    } catch (error) {
      this.#settleFailure(mutation, error);
      return;
    }
    void write.then(
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
    if (
      !Number.isSafeInteger(revision) ||
      revision !== mutation.expectedRevision + 1
    ) {
      this.#settleFailure(
        mutation,
        new Error("Workout autosave returned an invalid revision"),
        false,
      );
      return;
    }
    this.#confirmedRevision = revision;

    if (!this.#online) {
      if (this.#pending) {
        this.#setStatus("unsaved-offline");
      } else {
        this.#setStatus("saved");
        this.#resolveFlushWaiters();
      }
      return;
    }
    this.#startNext();
  }

  #settleFailure(
    mutation: SessionDraftMutation<Snapshot>,
    error: unknown,
    ambiguousOverride?: boolean,
  ) {
    if (this.#active === mutation) this.#active = null;
    if (this.#closed) return;
    if (this.#classify(this.#isRevisionConflict, error, false)) {
      this.#revisionConflict = error;
      this.#retry = null;
      if (!this.#pending) {
        let writeToken = mutation.writeToken;
        try {
          writeToken = this.#createToken();
        } catch (tokenError) {
          this.#reportError(tokenError);
        }
        this.#pending = { snapshot: mutation.snapshot, writeToken };
      }
    } else if (
      ambiguousOverride ??
      this.#classify(this.#isAmbiguousFailure, error, true)
    ) {
      this.#retry = mutation;
    } else {
      this.#retry = null;
      this.#pending ??= {
        snapshot: mutation.snapshot,
        writeToken: mutation.writeToken,
      };
      this.#deterministicFailure = error;
    }
    this.#setStatus(this.#online ? "error" : "unsaved-offline");
    this.#reportError(error);
    this.#rejectFlushWaiters(error);
  }

  #classify(
    classifier: (error: unknown) => boolean,
    error: unknown,
    fallback: boolean,
  ) {
    try {
      return classifier(error);
    } catch (classifierError) {
      this.#reportError(classifierError);
      return fallback;
    }
  }

  #reportError(error: unknown) {
    try {
      this.#onError?.(error);
    } catch {
      // Reporting must never change save/replay state or strand flush waiters.
    }
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
