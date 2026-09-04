import type { EntryMode, Exercise, ExerciseDiscipline, LoggingFormat, TrackingField } from "../../../lib/domain";
import { entryModeForLoggingFormat, loggingFormatFor, loggingFormatLabel, requiredTrackingFieldsForLoggingFormat } from "../../../lib/domain";

export type ExerciseLibraryFilters = {
  disciplines: ExerciseDiscipline[];
  categories: string[];
  formats: LoggingFormat[];
  tracking: TrackingField[];
};

export function modeLabel(mode: EntryMode, fields: readonly TrackingField[] = []) {
  return loggingFormatLabel(loggingFormatFor(mode, fields));
}

export function entryModesForFormats(formats: readonly LoggingFormat[]) {
  return [...new Set(formats.map(entryModeForLoggingFormat))];
}

export function trackingFiltersForExerciseSearch(filters: ExerciseLibraryFilters) {
  const required =
    filters.formats.length === 1
      ? requiredTrackingFieldsForLoggingFormat(filters.formats[0])
      : [];
  return [...new Set([...filters.tracking, ...required])];
}

export function inferredExerciseDiscipline(exercise: Exercise): ExerciseDiscipline {
  if (exercise.discipline) return exercise.discipline;
  if (exercise.category === "Weightlifting") return "weightlifting";
  if (
    ["Functional fitness", "Gymnastics", "Conditioning", "Cardio"].includes(
      exercise.category,
    )
  ) {
    return "functional";
  }
  return "gym";
}

export const exerciseTrainingStyles: Array<{
  value: ExerciseDiscipline;
  label: string;
}> = [
  { value: "weightlifting", label: "Weightlifting" },
  { value: "gym", label: "Gym" },
  { value: "functional", label: "Functional" },
];

export const exerciseCategories = [
  "General",
  "Bodybuilding",
  "Bodyweight",
  "Cardio",
  "Conditioning",
  "Core",
  "Functional fitness",
  "Gymnastics",
  "Mobility",
  "Strength",
] as const;

export const exerciseFilterCategories = [
  "Weightlifting",
  ...exerciseCategories,
] as const;
export const exerciseFormatOptions: LoggingFormat[] = [
  "repetitions",
  "duration",
  "distance",
  "intervals",
  "instructions",
];
export const exerciseTrackingOptions: TrackingField[] = [
  "reps",
  "load",
  "duration",
  "distance",
  "rounds",
  "heartRate",
  "rpe",
];

export function emptyExerciseLibraryFilters(): ExerciseLibraryFilters {
  return { disciplines: [], categories: [], formats: [], tracking: [] };
}

export function toggleExerciseFilterValue<T extends string>(
  current: T[],
  value: T,
) {
  return current.includes(value)
    ? current.filter((candidate) => candidate !== value)
    : [...current, value];
}

export function filterCompleteExerciseLibrary(
  exercises: Exercise[],
  query: string,
  filters: ExerciseLibraryFilters,
) {
  const normalizedQuery = query.trim().toLowerCase();
  return exercises.filter(
    (exercise) =>
      (!normalizedQuery ||
        `${exercise.name} ${exercise.category} ${modeLabel(exercise.defaultMode, exercise.defaultFields)} ${exercise.defaultFields.map(trackingFieldLabel).join(" ")}`
          .toLowerCase()
          .includes(normalizedQuery)) &&
      (!filters.disciplines.length ||
        filters.disciplines.includes(inferredExerciseDiscipline(exercise))) &&
      (!filters.categories.length ||
        filters.categories.includes(exercise.category)) &&
      (!filters.formats.length ||
        filters.formats.includes(
          loggingFormatFor(exercise.defaultMode, exercise.defaultFields),
        )) &&
      filters.tracking.every((field) =>
        exercise.defaultFields.includes(field),
      ),
  );
}

export function exerciseTrainingStyleLabel(style: ExerciseDiscipline) {
  return exerciseTrainingStyles.find((item) => item.value === style)?.label ?? "Gym";
}

export function trackingFieldLabel(field: TrackingField) {
  return {
    reps: "Reps",
    load: "Load",
    duration: "Duration",
    distance: "Distance",
    rounds: "Rounds",
    heartRate: "Heart rate",
    rpe: "RPE",
  }[field];
}
