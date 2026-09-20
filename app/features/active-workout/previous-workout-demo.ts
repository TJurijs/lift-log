import type { CompletedSessionDetail, PlannedWorkout, ScheduledWorkout } from "../../../lib/domain";
import { parsePreviousWorkoutValues } from "../../../lib/previous-workout";
import { createExerciseRecordingDemoWorkspace } from "../../../lib/demo-data";
import { completeDemoWorkout, createDemoWorkoutSession } from "./demo-workout";

export function createPreviousValuesDemoWorkspace() {
  const workspace = createExerciseRecordingDemoWorkspace();
  const items = workspace.scheduledWorkouts[0].workout.sections.flatMap((section) => section.items);
  const squat = items.find((item) => item.id === "preview-squat")!;
  squat.fields.push("rpe");
  squat.prescription.targetRpe = "7";
  items.find((item) => item.id === "preview-row")!.fields.push("heartRate", "rpe");
  return workspace;
}

/** Demo sessions use explicit item IDs, just as the server matches item lineage. */
export function previousDemoWorkoutValues(workout: PlannedWorkout, session?: CompletedSessionDetail) {
  if (!import.meta.env.DEV || !session || session.workoutId !== workout.id) return null;
  return parsePreviousWorkoutValues({
    sessionId: session.id,
    completedAt: `${session.date}T12:00:00Z`,
    items: workout.sections.flatMap((section) => section.items).flatMap((item) => {
      const saved = session.items.find((candidate) => candidate.id === `${session.id}:${item.id}` && candidate.mode === item.mode);
      return saved ? [{ workoutItemId: item.id, mode: item.mode, fields: item.fields.filter((field) => saved.fields.includes(field)),
        entries: saved.entries.map((entry) => ({ ...entry,
          durationSeconds: entry.durationMinutes === undefined ? undefined : entry.durationMinutes * 60,
          distanceMetres: entry.distanceKm === undefined ? undefined : entry.distanceKm * 1000,
        })),
      }] : [];
    }),
  });
}

/** Isolated sample history for the local previous-values preview. */
export function createPreviousValuesDemoSession(schedule: ScheduledWorkout): CompletedSessionDetail {
  const session = createDemoWorkoutSession(schedule);
  for (const [itemId, rows] of Object.entries(session.setLogs)) {
    const item = schedule.workout.sections.flatMap((section) => section.items).find((candidate) => candidate.id === itemId)!;
    rows.forEach((row, index) => {
      if (item.fields.includes("reps")) row.reps = item.title === "Back squat" ? String(index === 2 ? 4 : 5) : row.reps;
      if (item.fields.includes("load")) row.load = item.title === "Back squat" ? "37.5" : "30";
      if (item.fields.includes("duration")) row.duration = String((index === 2 ? 25 : 30) / 60);
      if (item.fields.includes("rpe")) row.rpe = String(index === 2 ? 8 : 7);
    });
  }
  for (const [itemId, result] of Object.entries(session.resultLogs)) {
    const item = schedule.workout.sections.flatMap((section) => section.items).find((candidate) => candidate.id === itemId)!;
    if (item.fields.includes("duration")) result.duration = "2.25";
    if (item.fields.includes("heartRate")) result.heartRate = "142";
    if (item.fields.includes("rpe")) result.rpe = "7";
  }
  const saved = completeDemoWorkout(session, schedule, session);
  const date = new Date();
  date.setDate(date.getDate() - 7);
  saved.date = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return saved;
}
