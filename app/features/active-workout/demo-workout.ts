import type { ActiveSession, CompletedSessionDetail, CompletedSessionEntry, ScheduledWorkout } from "../../../lib/domain";
import { workoutItemNotes } from "../../../lib/domain";
import type { ActiveWorkoutDraftSnapshot } from "../../../lib/active-workout-draft-storage";
import { localDateOnly } from "../../../lib/date-only";
import { starterSetLogs } from "./useActiveWorkoutForm";

export function createDemoWorkoutSession(schedule: ScheduledWorkout): ActiveSession {
  const id = `demo-session-${crypto.randomUUID()}`;
  return {
    id,
    draftRevision: 0,
    workoutId: schedule.workoutId,
    programVersionId: schedule.programVersionId,
    scheduledWorkoutId: schedule.id,
    itemLogIds: Object.fromEntries(schedule.workout.sections.flatMap((section) => section.items).map((item) => [item.id, `${id}:${item.id}`])),
    itemFields: Object.fromEntries(schedule.workout.sections.flatMap((section) => section.items).map((item) => [item.id, item.fields])),
    setLogs: starterSetLogs(schedule.workout, null),
    resultLogs: {},
    sessionRpe: "",
    sessionNote: "",
  };
}

function number(value: string | undefined, divisor = 1) {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed / divisor : undefined;
}

export function completeDemoWorkout(
  session: ActiveSession,
  schedule: ScheduledWorkout,
  snapshot: ActiveWorkoutDraftSnapshot,
): CompletedSessionDetail {
  return {
    id: session.id,
    workoutId: session.workoutId,
    programVersionId: session.programVersionId,
    workoutTitle: schedule.workoutTitle,
    date: schedule.plannedDate ?? localDateOnly(),
    durationMinutes: schedule.workout.durationMinutes,
    rpe: number(snapshot.sessionRpe) ?? 0,
    note: snapshot.sessionNote,
    items: schedule.workout.sections.flatMap((section) => section.items).map((item, position) => {
      const result = snapshot.resultLogs[item.id] ?? {};
      const sets = snapshot.setLogs[item.id];
      const roundPositions = [...new Set(Object.keys(result).flatMap((key) => {
        const match = /^round\.(\d+)\./.exec(key);
        return match ? [Number(match[1])] : [];
      }))].sort((a, b) => a - b);
      const entries: CompletedSessionEntry[] = item.mode === "sets" && sets
        ? sets.map((set, index) => ({ position: index, reps: number(set.reps), loadKg: number(set.load), rpe: number(set.rpe), durationMinutes: number(set.duration), distanceKm: number(set.distance), heartRate: number(set.heartRate) }))
        : item.mode === "intervals"
          ? roundPositions.map((index) => ({
            position: index,
            durationMinutes: number(result[`round.${index}.duration`], 60),
            distanceKm: number(result[`round.${index}.distance`]),
            rounds: result[`round.${index}.completed`] === "1" ? 1 : undefined,
            heartRate: number(result[`round.${index}.heartRate`]),
            rpe: number(result[`round.${index}.rpe`]),
          }))
          : item.mode === "result" && Object.keys(result).length
            ? [{ position: 0, loadKg: number(result.load), durationMinutes: number(result.duration), distanceKm: number(result.distance), heartRate: number(result.heartRate), rpe: number(result.rpe) }]
            : [];
      for (const entry of entries) {
        if (!item.fields.includes("reps")) delete entry.reps;
        if (!item.fields.includes("load")) delete entry.loadKg;
        if (!item.fields.includes("duration")) delete entry.durationMinutes;
        if (!item.fields.includes("distance")) delete entry.distanceKm;
        if (!item.fields.includes("rounds")) delete entry.rounds;
        if (!item.fields.includes("heartRate")) delete entry.heartRate;
        if (!item.fields.includes("rpe")) delete entry.rpe;
      }
      return { id: session.itemLogIds[item.id], title: item.title, category: item.category, videoUrl: item.videoUrl, videoLinks: item.videoLinks?.map((video) => ({ ...video })), cue: workoutItemNotes(item), mode: item.mode, fields: item.fields, position, entries };
    }),
  };
}
