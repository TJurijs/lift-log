import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Exercise, ExerciseCursor } from "../../../lib/domain";
import type { LiftLogRepository } from "../../../lib/repository";
import { entryModesForFormats, trackingFiltersForExerciseSearch, type ExerciseLibraryFilters } from "./exercise-library";

type ExerciseSearchRepository = Pick<LiftLogRepository, "searchExercises">;
type Scope = "global" | "personal";

/** Keeps a cursor attached to the exact search that produced it. */
export function useExerciseSearch({ repository, enabled, query, scope, filters, onPage }: {
  repository: ExerciseSearchRepository | null;
  enabled: boolean;
  query: string;
  scope: Scope;
  filters: ExerciseLibraryFilters;
  onPage: (items: Exercise[], scope: Scope, append: boolean) => void;
}) {
  const [retryKey, setRetryKey] = useState(0);
  const request = useMemo(() => ({ repository, query, scope, filters, retryKey }), [repository, query, scope, filters, retryKey]);
  const [result, setResult] = useState<{
    request: typeof request;
    cursor?: ExerciseCursor;
    error: string;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const generation = useRef(0);
  const readyRequest = useRef<typeof request | null>(null);
  const loadingMore = useRef(false);

  useEffect(() => {
    const requestId = ++generation.current;
    readyRequest.current = null;
    if (!enabled || !repository) return;
    const timer = window.setTimeout(() => {
      setPending(true);
      void repository.searchExercises({
        query,
        scope,
        disciplines: filters.disciplines,
        categories: filters.categories,
        modes: entryModesForFormats(filters.formats),
        tracking: trackingFiltersForExerciseSearch(filters),
        limit: 50,
      }).then((page) => {
        if (requestId !== generation.current) return;
        onPage(page.items, scope, false);
        readyRequest.current = request;
        setResult({ request, cursor: page.nextCursor, error: "" });
      }).catch((error: unknown) => {
        if (requestId !== generation.current) return;
        setResult({ request, error: error instanceof Error ? error.message : "The exercise library could not be searched." });
      }).finally(() => {
        if (requestId === generation.current) setPending(false);
      });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      generation.current = requestId + 1;
      readyRequest.current = null;
      loadingMore.current = false;
    };
  }, [enabled, repository, query, scope, filters, request, onPage]);

  const currentResult = result?.request === request ? result : null;
  const cursor = enabled && repository ? currentResult?.cursor : undefined;
  const loadMore = useCallback(async () => {
    // This guard also protects the debounce interval and two clicks in one render.
    if (!enabled || !repository || !cursor || readyRequest.current !== request || loadingMore.current) return;
    loadingMore.current = true;
    setPending(true);
    setResult((current) => current?.request === request ? { ...current, error: "" } : current);
    const requestId = generation.current;
    try {
      const page = await repository.searchExercises({
        query,
        scope,
        disciplines: filters.disciplines,
        categories: filters.categories,
        modes: entryModesForFormats(filters.formats),
        tracking: trackingFiltersForExerciseSearch(filters),
        limit: 50,
        cursor,
      });
      if (requestId !== generation.current) return;
      onPage(page.items, scope, true);
      setResult({ request, cursor: page.nextCursor, error: "" });
    } catch (error) {
      if (requestId === generation.current) {
        setResult({ request, cursor, error: error instanceof Error ? error.message : "More exercises could not be loaded." });
      }
    } finally {
      if (requestId === generation.current) {
        loadingMore.current = false;
        setPending(false);
      }
    }
  }, [enabled, repository, cursor, request, query, scope, filters, onPage]);

  const retry = useCallback(() => setRetryKey((value) => value + 1), []);
  return {
    cursor,
    loading: Boolean(enabled && repository && (!currentResult || pending)),
    error: enabled ? currentResult?.error ?? "" : "",
    loadMore,
    retry,
  };
}
