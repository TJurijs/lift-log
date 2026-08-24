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

export function programWorkoutCount(program: Program) {
  return program.detailsLoaded === false
    ? program.workoutCount ?? 0
    : program.weeks.reduce(
        (total, week) => total + week.workouts.length,
        0,
      );
}

export function programWorkoutIds(program: Program) {
  return program.detailsLoaded === false
    ? program.workoutIds ?? []
    : program.weeks.flatMap((week) =>
        week.workouts.map((workout) => workout.id),
      );
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

export function reorderProgramSections(
  source: Program,
  workoutId: string,
  sectionIds: string[],
) {
  return {
    ...source,
    weeks: source.weeks.map((week) => ({
      ...week,
      workouts: week.workouts.map((workout) =>
        workout.id === workoutId
          ? { ...workout, sections: orderByIds(workout.sections, sectionIds) }
          : workout,
      ),
    })),
  };
}

export function moveProgramExercise(
  source: Program,
  workoutId: string,
  itemId: string,
  destinationSectionId: string,
  destinationPosition: number,
) {
  const workout = source.weeks
    .flatMap((week) => week.workouts)
    .find((candidate) => candidate.id === workoutId);
  const movingItem = workout?.sections
    .flatMap((section) => section.items)
    .find((item) => item.id === itemId);
  if (!movingItem) return source;

  return {
    ...source,
    weeks: source.weeks.map((week) => ({
      ...week,
      workouts: week.workouts.map((candidate) => {
        if (candidate.id !== workoutId) return candidate;
        const withoutMovingItem = candidate.sections.map((section) => ({
          ...section,
          items: section.items.filter((item) => item.id !== itemId),
        }));
        return {
          ...candidate,
          sections: withoutMovingItem.map((section) => {
            if (section.id !== destinationSectionId) return section;
            const nextItems = [...section.items];
            const insertionIndex = Math.max(
              0,
              Math.min(destinationPosition, nextItems.length),
            );
            nextItems.splice(insertionIndex, 0, movingItem);
            return { ...section, items: nextItems };
          }),
        };
      }),
    })),
  };
}
