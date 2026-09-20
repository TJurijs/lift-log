import { useEffect, useMemo, useState } from "react";
import type { PreviousWorkoutValues } from "../../../lib/domain";
import type { LiftLogRepository } from "../../../lib/repository";
import { validatePreviousWorkoutValues } from "../../../lib/previous-workout";

const prefix = "liftlog:previous-workout:v1:";
const userPrefix = (viewerId: string) => `${prefix}${encodeURIComponent(viewerId)}:`;
const cacheKey = (viewerId: string, workoutId: string) => `${userPrefix(viewerId)}${encodeURIComponent(workoutId)}`;

function readCached(key: string) {
  try { return validatePreviousWorkoutValues(JSON.parse(localStorage.getItem(key) ?? "null")); }
  catch { return null; }
}

function cacheValues(viewerId: string, key: string, value: PreviousWorkoutValues | null) {
  try {
    localStorage.removeItem(key);
    if (value) localStorage.setItem(key, JSON.stringify(value));
    const keys = Object.keys(localStorage).filter((candidate) => candidate.startsWith(userPrefix(viewerId)));
    for (const stale of keys.slice(0, Math.max(0, keys.length - 12))) localStorage.removeItem(stale);
  } catch { /* History hints are optional when storage is full or unavailable. */ }
}

export function clearPreviousWorkoutValuesForUser(viewerId: string) {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(userPrefix(viewerId))) localStorage.removeItem(key);
  } catch { /* Nothing to clear if storage is unavailable. */ }
}

/** Separate from draft state: a failed history read must never interrupt logging. */
export function usePreviousWorkoutValues({ repository, viewerId, workoutId, excludeSessionId, online, demoValues }: {
  repository: Pick<LiftLogRepository, "loadPreviousWorkoutValues"> | null;
  viewerId: string;
  workoutId?: string;
  excludeSessionId?: string;
  online: boolean;
  demoValues?: PreviousWorkoutValues | null;
}) {
  const scope = workoutId ? cacheKey(viewerId, workoutId) : "";
  const cached = useMemo(() => repository && scope ? readCached(scope) : null, [repository, scope]);
  const [loaded, setLoaded] = useState<{ scope: string; value: PreviousWorkoutValues | null } | null>(null);
  useEffect(() => {
    if (!repository || !workoutId) return;
    let current = true;
    if (online) void Promise.resolve().then(() => repository.loadPreviousWorkoutValues(workoutId, excludeSessionId)).then((value) => {
      if (!current) return;
      cacheValues(viewerId, scope, value);
      setLoaded({ scope, value });
    }).catch(() => { /* Retain any cached reference while the history service is unavailable. */ });
    return () => { current = false; };
  }, [repository, viewerId, workoutId, excludeSessionId, online, scope]);
  const value = repository ? loaded?.scope === scope ? loaded.value : cached : demoValues;
  return value?.sessionId === excludeSessionId ? null : value ?? null;
}
