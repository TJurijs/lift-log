import type { PreviousWorkoutValues, SessionSetValue } from "./domain";

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function display(value: unknown, divisor = 1): string {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? String(value / divisor) : "";
}

/** Parse the single bounded read RPC without treating any target as an actual. */
export function parsePreviousWorkoutValues(value: unknown): PreviousWorkoutValues | null {
  const source = record(value);
  if (!source || typeof source.sessionId !== "string" || !source.sessionId || typeof source.completedAt !== "string" || !Number.isFinite(Date.parse(source.completedAt)) || !Array.isArray(source.items)) return null;
  const items: [string, PreviousWorkoutValues["items"][string]][] = [];
  for (const rawItem of source.items.slice(0, 250)) {
    const item = record(rawItem);
    if (!item || typeof item.workoutItemId !== "string" || !item.workoutItemId || !Array.isArray(item.entries)) continue;
    const fields = Array.isArray(item.fields) ? item.fields : [];
    const entries = item.entries.flatMap((rawEntry) => {
      const entry = record(rawEntry);
      return entry && typeof entry.position === "number" && Number.isInteger(entry.position) && entry.position >= 0 && entry.position < 250 ? [entry] : [];
    });
    const metric = (entry: Record<string, unknown>, field: string, property: string, divisor = 1) => fields.includes(field) ? display(entry[property], divisor) : "";
    const setLogs: SessionSetValue[] = [];
    const resultLog: Record<string, string> = {};
    if (item.mode === "sets") {
      const count = entries.reduce((maximum, entry) => Math.max(maximum, Number(entry.position) + 1), 0);
      for (let index = 0; index < count; index += 1) setLogs.push({ reps: "", load: "", rpe: "" });
      for (const entry of entries) setLogs[Number(entry.position)] = {
        reps: metric(entry, "reps", "reps"), load: metric(entry, "load", "loadKg"), rpe: metric(entry, "rpe", "rpe"),
        ...(fields.includes("duration") ? { duration: metric(entry, "duration", "durationSeconds", 60) } : {}),
        ...(fields.includes("distance") ? { distance: metric(entry, "distance", "distanceMetres", 1000) } : {}),
        ...(fields.includes("heartRate") ? { heartRate: metric(entry, "heartRate", "heartRate") } : {}),
      };
    } else if (item.mode === "intervals") {
      for (const entry of entries) {
        const prefix = `round.${entry.position}.`;
        resultLog[`${prefix}completed`] = metric(entry, "rounds", "rounds");
        resultLog[`${prefix}duration`] = metric(entry, "duration", "durationSeconds");
        resultLog[`${prefix}distance`] = metric(entry, "distance", "distanceMetres", 1000);
        resultLog[`${prefix}heartRate`] = metric(entry, "heartRate", "heartRate");
        resultLog[`${prefix}rpe`] = metric(entry, "rpe", "rpe");
      }
    } else if (item.mode === "result") {
      const entry = entries.find((candidate) => candidate.position === 0);
      if (entry) Object.assign(resultLog, {
        rounds: metric(entry, "rounds", "rounds"), duration: metric(entry, "duration", "durationSeconds", 60),
        distance: metric(entry, "distance", "distanceMetres", 1000), load: metric(entry, "load", "loadKg"),
        heartRate: metric(entry, "heartRate", "heartRate"), rpe: metric(entry, "rpe", "rpe"),
      });
    } else continue;
    items.push([item.workoutItemId, { setLogs, resultLog }]);
  }
  return { sessionId: source.sessionId, completedAt: source.completedAt, items: Object.fromEntries(items) };
}

/** Validate the separate offline reference cache without accepting draft data. */
export function validatePreviousWorkoutValues(value: unknown): PreviousWorkoutValues | null {
  const source = record(value);
  const itemMap = record(source?.items);
  if (!source || typeof source.sessionId !== "string" || !source.sessionId || source.sessionId.length > 128 || typeof source.completedAt !== "string" || !Number.isFinite(Date.parse(source.completedAt)) || !itemMap || Object.keys(itemMap).length > 250) return null;
  const numericString = (value: unknown) => typeof value === "string" && value.length <= 40 && (value === "" || (value.trim() === value && Number.isFinite(Number(value)) && Number(value) >= 0));
  const setFields = ["reps", "load", "rpe", "duration", "distance", "heartRate"];
  const resultFields = [...setFields, "rounds"];
  const items: [string, PreviousWorkoutValues["items"][string]][] = [];
  for (const [id, rawItem] of Object.entries(itemMap)) {
    const item = record(rawItem), results = record(item?.resultLog);
    if (!id || id.length > 128 || !item || !Array.isArray(item.setLogs) || item.setLogs.length > 250 || !results || Object.keys(results).length > 1500) return null;
    const sets: SessionSetValue[] = [];
    for (const rawSet of item.setLogs) {
      const set = record(rawSet);
      if (!set || !["reps", "load", "rpe"].every((key) => typeof set[key] === "string") || Object.entries(set).some(([key, value]) => !setFields.includes(key) || !numericString(value))) return null;
      sets.push({ ...set } as unknown as SessionSetValue);
    }
    if (Object.entries(results).some(([key, value]) => (!resultFields.includes(key) && !/^round\.(?:0|[1-9]\d{0,2})\.(?:completed|duration|distance|heartRate|rpe)$/.test(key)) || !numericString(value))) return null;
    items.push([id, { setLogs: sets, resultLog: Object.fromEntries(Object.entries(results)) as Record<string, string> }]);
  }
  return { sessionId: source.sessionId, completedAt: source.completedAt, items: Object.fromEntries(items) };
}
