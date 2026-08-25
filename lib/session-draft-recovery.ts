import type { SessionDraftCoordinator } from "./session-draft-coordinator";

export interface SessionDraftSnapshotContext {
  /** Zero for the initial flush, then one-based for each conflict recovery. */
  recoveryAttempt: number;
  /** Present only after the authoritative session has been reloaded. */
  authoritativeRevision?: number;
}

export interface SessionDraftRecoveryOptions<Snapshot> {
  coordinator: SessionDraftCoordinator<Snapshot>;
  getLatestSnapshot: (
    context: SessionDraftSnapshotContext,
  ) => Snapshot | Promise<Snapshot>;
  loadAuthoritativeRevision: () => Promise<number>;
  isRevisionConflict: (error: unknown) => boolean;
  /** Number of authoritative reload/rebase attempts after the initial flush. */
  maxRevisionRecoveries?: number;
  /** Reload/rebase before writing, for a stale completion handshake. */
  startWithAuthoritativeRevision?: boolean;
}

/**
 * Flushes the newest complete draft and recovers bounded compare-and-swap
 * conflicts. The latest snapshot is prepared only after each authoritative
 * revision reload, so edits made during recovery are included. Unclassified
 * failures are returned untouched, leaving the coordinator's exact-token
 * replay state intact.
 */
export async function flushSessionDraftWithRecovery<Snapshot>({
  coordinator,
  getLatestSnapshot,
  loadAuthoritativeRevision,
  isRevisionConflict,
  maxRevisionRecoveries = 2,
  startWithAuthoritativeRevision = false,
}: SessionDraftRecoveryOptions<Snapshot>): Promise<number> {
  if (
    !Number.isSafeInteger(maxRevisionRecoveries) ||
    maxRevisionRecoveries < 0
  ) {
    throw new RangeError(
      "Maximum workout revision recoveries must be zero or greater",
    );
  }

  let recoveryAttempt = 0;

  if (!startWithAuthoritativeRevision) {
    const initialSnapshot = await getLatestSnapshot({ recoveryAttempt: 0 });
    try {
      return await coordinator.flushLatest(initialSnapshot);
    } catch (initialError) {
      if (!isRevisionConflict(initialError)) throw initialError;
      if (recoveryAttempt >= maxRevisionRecoveries) throw initialError;
    }
  } else if (maxRevisionRecoveries === 0) {
    throw new RangeError(
      "At least one recovery is required for an authoritative-first flush",
    );
  }

  while (recoveryAttempt < maxRevisionRecoveries) {
    recoveryAttempt += 1;
    const authoritativeRevision = await loadAuthoritativeRevision();
    const latestSnapshot = await getLatestSnapshot({
      authoritativeRevision,
      recoveryAttempt,
    });

    // Staging while the coordinator is conflict-gated replaces any older
    // failed snapshot and allocates a fresh write token before the rebase.
    coordinator.stage(latestSnapshot);
    coordinator.rebase(authoritativeRevision);

    try {
      return await coordinator.flushLatest();
    } catch (error) {
      if (!isRevisionConflict(error)) throw error;
      if (recoveryAttempt >= maxRevisionRecoveries) throw error;
    }
  }

  // The loop returns or throws on every path. This guards future edits to the
  // bounds above without manufacturing a replacement for the server error.
  throw new Error("Workout revision recovery ended unexpectedly");
}
