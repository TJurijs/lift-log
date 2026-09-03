import { localDateOnly } from "./date-only";

export interface GeneratedProgramRunDate {
  workoutId: string;
  plannedDate: string;
}

export interface OrderedProgramRunDate {
  title: string;
  plannedDate?: string;
}

const commonTrainingDays: Record<number, number[]> = {
  1: [1],
  2: [1, 4],
  3: [1, 3, 5],
  4: [1, 2, 4, 5],
  5: [1, 2, 3, 4, 5],
  6: [1, 2, 3, 4, 5, 6],
  7: [0, 1, 2, 3, 4, 5, 6],
};

function parseDateOnly(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) throw new Error("Choose a valid start date");
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw new Error("Choose a valid start date");
  }
  return date;
}

export function suggestProgramTrainingDays(
  startDate: string,
  sessionsPerWeek: number,
) {
  const count = Math.min(7, Math.max(1, Math.trunc(sessionsPerWeek)));
  const common = commonTrainingDays[count];
  const startDay = parseDateOnly(startDate).getDay();
  if (common.includes(startDay)) return common;

  // Keep familiar spacing, but rotate the pattern so the first workout can
  // happen on the date the user chose.
  const offset = (startDay - common[0] + 7) % 7;
  return common.map((day) => (day + offset) % 7).sort((a, b) => a - b);
}

export function generateProgramRunDates(
  workoutIds: readonly string[],
  startDate: string,
  trainingDays: readonly number[],
): GeneratedProgramRunDate[] {
  if (!workoutIds.length) return [];
  const normalizedDays = new Set(
    trainingDays
      .map((day) => Math.trunc(day))
      .filter((day) => day >= 0 && day <= 6),
  );
  if (!normalizedDays.size) throw new Error("Choose at least one training day");

  const cursor = parseDateOnly(startDate);
  const dates: GeneratedProgramRunDate[] = [];
  // A seven-day pattern always yields a date. This guard prevents accidental
  // infinite loops if this helper is changed later.
  const maximumDays = workoutIds.length * 7 + 7;
  for (let offset = 0; offset < maximumDays && dates.length < workoutIds.length; offset += 1) {
    if (normalizedDays.has(cursor.getDay())) {
      dates.push({
        workoutId: workoutIds[dates.length],
        plannedDate: localDateOnly(cursor),
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  if (dates.length !== workoutIds.length) {
    throw new Error("The workout schedule could not be generated");
  }
  return dates;
}

/**
 * Returns a user-facing error when dated workouts no longer follow the
 * program sequence. Undated workouts are ignored so a partial schedule can
 * still be saved and completed later.
 */
export function programRunDateOrderError(
  workouts: readonly OrderedProgramRunDate[],
) {
  let previous: OrderedProgramRunDate | null = null;
  for (const workout of workouts) {
    if (!workout.plannedDate) continue;
    if (
      previous?.plannedDate &&
      workout.plannedDate < previous.plannedDate
    ) {
      return `${workout.title} is dated before ${previous.title}. Workout dates must follow the program order.`;
    }
    previous = workout;
  }
  return "";
}
