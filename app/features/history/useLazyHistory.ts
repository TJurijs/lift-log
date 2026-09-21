import { useCallback, useEffect, useMemo, useState } from "react";

interface HistoryPage<Item, Cursor> {
  items: Item[];
  nextCursor?: Cursor;
}

interface HistoryScope<Cursor> {
  active: boolean;
  generation: number;
  loaded: boolean;
  cursor?: Cursor;
  pending: Promise<void> | null;
  pendingReset: boolean;
}

/** One repository owns each lazy history cursor, request, and invalidation. */
export function useLazyHistory<Item extends { id: string }, Cursor, Repository>(
  repository: Repository | null,
  initialItems: Item[],
  fetchPage: (repository: Repository, cursor?: Cursor) => Promise<HistoryPage<Item, Cursor>>,
  fallbackError: string,
) {
  const scope = useMemo<HistoryScope<Cursor>>(() => ({
    active: true,
    generation: 0,
    loaded: !repository,
    pending: null,
    pendingReset: false,
  }), [repository]);
  const [state, setState] = useState({
    scope,
    items: initialItems,
    cursor: undefined as Cursor | undefined,
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
    // After invalidation, an old Load more handler must retry the first page.
    const append = more && scope.loaded;
    if (append ? !scope.cursor : scope.loaded) return;
    const generation = scope.generation;
    const cursor = append ? scope.cursor : undefined;
    setState((previous) => ({
      scope,
      items: previous.scope === scope ? previous.items : initialItems,
      cursor,
      loading: true,
      error: "",
    }));
    const request = (async () => {
      try {
        const page = await Promise.resolve().then(() => fetchPage(repository, cursor));
        if (!scope.active || generation !== scope.generation) return;
        scope.loaded = true;
        scope.cursor = page.nextCursor;
        setState((previous) => ({
          scope,
          items: [...new Map([
            ...(append && previous.scope === scope ? previous.items : []),
            ...page.items,
          ].map((item) => [item.id, item])).values()],
          cursor: page.nextCursor,
          loading: false,
          error: "",
        }));
      } catch (error) {
        if (!scope.active || generation !== scope.generation) return;
        setState((previous) => ({
          ...previous,
          loading: false,
          error: error instanceof Error ? error.message : fallbackError,
        }));
      } finally {
        scope.pending = null;
        // Coalesce invalidations into one refresh after the stale request.
        if (scope.active && scope.pendingReset) {
          scope.pendingReset = false;
          await load();
        }
      }
    })();
    scope.pending = request;
    return request;
  }, [fetchPage, initialItems, fallbackError, repository, scope]);

  const invalidate = useCallback(() => {
    if (!repository || !scope.active) return;
    scope.generation += 1;
    scope.loaded = false;
    scope.cursor = undefined;
    scope.pendingReset = Boolean(scope.pending);
    setState((previous) => previous.scope === scope
      ? { ...previous, cursor: undefined, error: "" }
      : previous);
  }, [repository, scope]);

  return {
    items: !repository ? initialItems : state.scope === scope ? state.items : initialItems,
    cursor: state.scope === scope ? state.cursor : undefined,
    loading: state.scope === scope && state.loading,
    error: state.scope === scope ? state.error : "",
    load,
    invalidate,
  };
}
