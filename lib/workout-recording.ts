import { loggingFormatFor, requiredTrackingFieldsForLoggingFormat, type PlannedWorkout, type SessionSetValue, type WorkoutItem } from "./domain";

/** Copy only exact, objective targets. Effort is always reported by the athlete. */
export function plannedRecordingValues(item: WorkoutItem, index = 0): Partial<SessionSetValue> {
  const target = item.prescription.entries?.[index] ?? item.prescription;
  const fields = item.fields;
  const values: Partial<SessionSetValue> = {};
  if (fields.includes("reps") && /^\d+$/.test(target.reps ?? "")) values.reps = target.reps;
  if (fields.includes("load") && target.loadKg !== undefined) values.load = String(target.loadKg);
  if (fields.includes("duration") && target.durationMinutes !== undefined) values.duration = String(target.durationMinutes);
  if (fields.includes("distance") && target.distance !== undefined) values.distance = String(target.distance / (target.distanceUnit === "m" ? 1000 : 1));
  return values;
}

/** A new interval session starts with the planned rounds retained as completed. */
export function plannedIntervalRecordingValues(item: WorkoutItem): Record<string, string> {
  const entries = item.prescription.entries?.length ? item.prescription.entries : [item.prescription];
  const count = Math.max(1, item.prescription.rounds ?? entries.length);
  const values: Record<string, string> = {};
  for (let index = 0; index < count; index++) {
    const target = entries[index] ?? entries.at(-1) ?? item.prescription;
    if (item.fields.includes("rounds")) values[`round.${index}.completed`] = "1";
    if (item.fields.includes("duration")) {
      const seconds = target.workSeconds ?? (target.durationMinutes === undefined ? undefined : Math.round(target.durationMinutes * 60));
      values[`round.${index}.duration`] = seconds === undefined ? "" : String(seconds);
    }
    if (item.fields.includes("distance")) {
      values[`round.${index}.distance`] = target.distance === undefined ? "" : String(target.distance / (target.distanceUnit === "m" ? 1000 : 1));
    }
    if (item.fields.includes("heartRate")) values[`round.${index}.heartRate`] = "";
    if (item.fields.includes("rpe")) values[`round.${index}.rpe`] = "";
  }
  return values;
}

export function unrecordedEntryCount(workout: PlannedWorkout, sets: Record<string, SessionSetValue[]>, results: Record<string, Record<string, string>>) {
  let count = 0;
  for (const item of workout.sections.flatMap((section) => section.items)) {
    if (item.mode === "none") continue;
    if (item.mode === "intervals") {
      const rounds = item.prescription.rounds ?? item.prescription.entries?.length ?? 1;
      for (let index = 0; index < rounds; index++) if (results[item.id]?.[`round.${index}.completed`] !== "1") count++;
      continue;
    }
    const primary = requiredTrackingFieldsForLoggingFormat(loggingFormatFor(item.mode, item.fields))[0];
    if (!primary) continue;
    const rows = item.mode === "sets" ? sets[item.id] ?? [] : [results[item.id] ?? {}];
    if (!rows.length) { count += item.prescription.sets ?? item.prescription.entries?.length ?? 1; continue; }
    for (const row of rows) {
      const value = row[primary as keyof typeof row];
      if (typeof value !== "string" || !value.trim()) count++;
    }
  }
  return count;
}
