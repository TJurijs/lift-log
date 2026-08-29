import type { Program } from "./domain";

function orderByIds<T extends { id: string }>(items: T[], ids: string[]) {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  return ids
    .map((id) => itemsById.get(id))
    .filter((item): item is T => Boolean(item));
}

export function programWeekCount(program: Program) {
  return program.detailsLoaded === false
    ? program.weekCount ?? 0
    : program.weeks.length;
}

/**
 * Returns the ordered workout sequence exposed by the product. Program weeks
 * remain in the wire model only as an internal persistence container.
 */
export function programWorkouts(program: Program) {
  return program.weeks.flatMap((week) => week.workouts);
}

/**
 * Returns the single internal workout container for a hydrated program.
 * Catalog summaries intentionally have no tree and therefore no container.
 */
export function implicitProgramWeek(program: Program) {
  return program.detailsLoaded === false ? undefined : program.weeks[0];
}

export function programWorkoutCount(program: Program) {
  return program.detailsLoaded === false
    ? program.workoutCount ?? 0
    : programWorkouts(program).length;
}

export function programWorkoutIds(program: Program) {
  return program.detailsLoaded === false
    ? program.workoutIds ?? []
    : programWorkouts(program).map((workout) => workout.id);
}

export function reorderProgramWorkoutSequence(
  source: Program,
  workoutIds: string[],
) {
  const container = implicitProgramWeek(source);
  if (!container || source.weeks.length !== 1) return source;
  return {
    ...source,
    weeks: [
      {
        ...container,
        workouts: orderByIds(container.workouts, workoutIds),
      },
    ],
  };
}

export function reorderProgramWorkouts(
  source: Program,
  weekId: string,
  workoutIds: string[],
) {
  return {
    ...source,
    weeks: source.weeks.map((week) =>
      week.id === weekId
        ? { ...week, workouts: orderByIds(week.workouts, workoutIds) }
        : week,
    ),
  };
}

export function reorderProgramWorkoutItems(
  source: Program,
  workoutId: string,
  itemIds: string[],
) {
  return {
    ...source,
    weeks: source.weeks.map((week) => ({
      ...week,
      workouts: week.workouts.map((workout) => {
        if (workout.id !== workoutId) return workout;
        const items = workout.sections.flatMap((section) => section.items);
        const orderedItems = orderByIds(items, itemIds);
        const section = workout.sections[0];
        if (!section) return workout;
        return {
          ...workout,
          sections: [{ ...section, items: orderedItems }],
        };
      }),
    })),
  };
}
