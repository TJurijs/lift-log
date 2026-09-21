import type { Program } from "./domain";

/** Local preview equivalent of the database's independent content copy. */
export function copyTrainingForViewer(source: Program, viewerId: string, viewerName: string): Program {
  const copy = structuredClone(source);
  const id = () => crypto.randomUUID();
  const versionId = id();
  return {
    ...copy,
    id: id(), versionId, versionStatus: "draft", athleteId: viewerId,
    createdById: viewerId, createdByName: viewerName, ownerName: viewerName,
    sourceType: "self", sourceLabel: "Created by you", detailsLoaded: true,
    assignmentId: undefined, programRunId: undefined, customizedProgramId: undefined,
    editableRunId: undefined, editableRunWorkoutId: undefined, effectiveFrom: undefined,
    workoutIds: undefined, hasOwnRuns: false,
    weeks: copy.weeks.map(week => ({
      ...week, id: id(), workouts: week.workouts.map(workout => ({
        ...workout, id: id(), programVersionId: versionId, scheduledWorkoutId: undefined,
        plannedDate: undefined, runWorkoutId: undefined, originalWorkoutId: undefined,
        sections: workout.sections.map(section => ({
          ...section, id: id(), items: section.items.map(item => ({ ...item, id: id() })),
        })),
      })),
    })),
  };
}
