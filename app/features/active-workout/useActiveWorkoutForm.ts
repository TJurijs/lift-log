import { useCallback, useMemo, useState } from "react";
import type { ActiveSession, PlannedWorkout, SessionSetValue } from "../../../lib/domain";
import type { ActiveWorkoutDraftSnapshot } from "../../../lib/active-workout-draft-storage";

export function starterSetLogs(workout: PlannedWorkout, session: ActiveSession | null) {
  if (session?.workoutId === workout.id) return session.setLogs;
  const logs: Record<string, SessionSetValue[]> = {};
  for (const item of workout.sections.flatMap((section) => section.items)) {
    if (item.mode !== "sets") continue;
    const entries = item.prescription.entries?.length
      ? item.prescription.entries
      : Array.from({ length: item.prescription.sets ?? 1 }, () => item.prescription);
    logs[item.id] = entries.map((entry) => ({
      reps: entry.reps?.split("–")[0] ?? item.prescription.reps?.split("–")[0] ?? "",
      load: "",
      rpe: "",
    }));
  }
  return logs;
}

/** Active logging owns this state. Read-only previews never write into it. */
export function useActiveWorkoutForm(
  initialSession: ActiveSession | null,
  workout?: PlannedWorkout,
) {
  const [setLogs, setSetLogs] = useState<Record<string, SessionSetValue[]>>(() =>
    initialSession?.setLogs ?? (workout ? starterSetLogs(workout, null) : {}));
  const [resultLogs, setResultLogs] = useState<ActiveWorkoutDraftSnapshot["resultLogs"]>(
    initialSession?.resultLogs ?? {},
  );
  const [sessionRpe, setSessionRpe] = useState(initialSession?.sessionRpe ?? "7");
  const [sessionNote, setSessionNote] = useState(initialSession?.sessionNote ?? "");
  const snapshot = useMemo(
    () => ({ setLogs, resultLogs, sessionRpe, sessionNote }),
    [setLogs, resultLogs, sessionRpe, sessionNote],
  );
  const applySnapshot = useCallback((next: ActiveWorkoutDraftSnapshot) => {
    setSetLogs(next.setLogs);
    setResultLogs(next.resultLogs);
    setSessionRpe(next.sessionRpe);
    setSessionNote(next.sessionNote);
  }, []);
  const updateSet = useCallback((
    itemId: string,
    index: number,
    field: keyof SessionSetValue,
    value: string,
  ) => {
    setSetLogs((previous) => ({
      ...previous,
      [itemId]: (previous[itemId] ?? []).map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: value } : row),
    }));
  }, []);
  const addSet = useCallback((itemId: string) => {
    setSetLogs((previous) => ({
      ...previous,
      [itemId]: [...(previous[itemId] ?? []), { reps: "", load: "", rpe: "" }],
    }));
  }, []);
  const removeSet = useCallback((itemId: string, index: number) => {
    setSetLogs((previous) => ({
      ...previous,
      [itemId]: (previous[itemId] ?? []).filter((_, rowIndex) => rowIndex !== index),
    }));
  }, []);
  const updateResult = useCallback((itemId: string, field: string, value: string) => {
    setResultLogs((previous) => ({
      ...previous,
      [itemId]: { ...(previous[itemId] ?? {}), [field]: value },
    }));
  }, []);
  return {
    ...snapshot,
    snapshot,
    applySnapshot,
    setSetLogs,
    setResultLogs,
    setSessionRpe,
    setSessionNote,
    updateSet,
    addSet,
    removeSet,
    updateResult,
  };
}
