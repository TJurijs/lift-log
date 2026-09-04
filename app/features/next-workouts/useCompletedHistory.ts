import { useCallback, useEffect, useMemo, useState } from "react";
import type { CompletedSession, HistoryCursor } from "../../../lib/domain";
import type { LiftLogRepository } from "../../../lib/repository";

type HistoryRepository = Pick<LiftLogRepository, "listCompletedSessionSummaries">;

interface HistoryScope {
  active: boolean;
  generation: number;
  loaded: boolean;
  cursor?: HistoryCursor;
  pending: Promise<void> | null;
  pendingReset: boolean;
}

/** Lazy history pages belong to one repository/account and survive page errors. */
export function useCompletedHistory(
  repository: HistoryRepository | null,
  initialSessions: CompletedSession[],
) {
  const scope = useMemo<HistoryScope>(() => ({
    active: true,
    generation: 0,
    loaded: !repository,
    pending: null,
    pendingReset: false,
  }), [repository]);
  const [state, setState] = useState({
    scope,
    sessions: initialSessions,
    cursor: undefined as HistoryCursor | undefined,
    loading: false,
    error: "",
  });

  useEffect(() => {
    scope.active = true;
    return () => {
      scope.active = false;
      scope.generation += 1;
    };
  }, [scope]);

  const load = useCallback(async function load(more = false): Promise<void> {
    if (!repository || !scope.active) return;
    if (scope.pending) return scope.pending;
    // A stale cursor must never turn a failed refresh into an older-page retry.
    const append = more && scope.loaded;
    if (append ? !scope.cursor : scope.loaded) return;
    const generation = scope.generation;
    const cursor = append ? scope.cursor : undefined;
    setState((previous) => ({
      scope,
      sessions: previous.scope === scope ? previous.sessions : initialSessions,
      cursor,
      loading: true,
      error: "",
    }));
    const request = (async () => {
      try {
        const page = await Promise.resolve().then(() =>
          repository.listCompletedSessionSummaries({ limit: 20, ...(cursor ? { cursor } : {}) }),
        );
        if (!scope.active || generation !== scope.generation) return;
        scope.loaded = true;
        scope.cursor = page.nextCursor;
        setState((previous) => ({
          scope,
          sessions: [...new Map([
            ...(append && previous.scope === scope ? previous.sessions : []),
            ...page.items,
          ].map((session) => [session.id, session])).values()],
          cursor: page.nextCursor,
          loading: false,
          error: "",
        }));
      } catch (error) {
        if (!scope.active || generation !== scope.generation) return;
        setState((previous) => ({
          ...previous,
          loading: false,
          error: error instanceof Error ? error.message : "Completed workouts could not be loaded.",
        }));
      } finally {
        scope.pending = null;
        if (scope.active && scope.pendingReset) {
          scope.pendingReset = false;
          await load();
        }
      }
    })();
    scope.pending = request;
    return request;
  }, [initialSessions, repository, scope]);

  const invalidate = useCallback(() => {
    if (!repository) return;
    scope.generation += 1;
    scope.loaded = false;
    scope.cursor = undefined;
    // Wait for an existing request, ignore its stale result, then refresh once.
    scope.pendingReset = Boolean(scope.pending);
    setState((previous) => ({ ...previous, cursor: undefined, error: "" }));
  }, [repository, scope]);

  return {
    sessions: state.scope === scope ? state.sessions : initialSessions,
    cursor: state.scope === scope ? state.cursor : undefined,
    loading: state.scope === scope && state.loading,
    error: state.scope === scope ? state.error : "",
    load,
    invalidate,
  };
}
