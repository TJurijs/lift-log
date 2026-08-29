import { describe, expect, it } from "vitest";

import type { PlannedWorkout, Program, WorkoutItem } from "../../lib/domain";
import {
  implicitProgramWeek,
  programWeekCount,
  programWorkoutCount,
  programWorkoutIds,
  programWorkouts,
  reorderProgramWorkoutItems,
  reorderProgramWorkoutSequence,
  reorderProgramWorkouts,
} from "../../lib/program-tree";

function item(id: string): WorkoutItem {
  return {
    id,
    title: id,
    cue: "",
    mode: "sets",
    fields: ["reps"],
    prescription: { sets: 1, reps: "5" },
  };
}

function workout(id: string, sectionIds: string[] = []): PlannedWorkout {
  return {
    id,
    title: id,
    dayLabel: id,
    durationMinutes: 30,
    sections: sectionIds.map((sectionId) => ({
      id: sectionId,
      title: sectionId,
      items: [],
    })),
  };
}

function program(): Program {
  return {
    id: "program-1",
    athleteId: "athlete-1",
    versionId: "version-1",
    versionStatus: "draft",
    title: "Strength",
    description: "",
    phase: "Build",
    activeWeek: 1,
    weeks: [
      {
        id: "week-1",
        index: 1,
        label: "Week 1",
        workouts: [workout("workout-1", ["section-a", "section-b"]), workout("workout-2")],
      },
      {
        id: "week-2",
        index: 2,
        label: "Week 2",
        workouts: [workout("workout-3")],
      },
    ],
    ownerName: "Athlete",
    createdById: "athlete-1",
    createdByName: "Athlete",
    sourceType: "self",
    sourceLabel: "Your program",
  };
}

describe("program catalog selectors", () => {
  it("derives counts and workout ids from a loaded program tree", () => {
    const source = program();

    expect(programWeekCount(source)).toBe(2);
    expect(programWorkoutCount(source)).toBe(3);
    expect(programWorkoutIds(source)).toEqual([
      "workout-1",
      "workout-2",
      "workout-3",
    ]);
    expect(programWorkouts(source).map(({ id }) => id)).toEqual([
      "workout-1",
      "workout-2",
      "workout-3",
    ]);
    expect(implicitProgramWeek(source)?.id).toBe("week-1");
  });

  it("uses lightweight catalog metadata without requiring a loaded tree", () => {
    const source: Program = {
      ...program(),
      detailsLoaded: false,
      weeks: [],
      weekCount: 6,
      workoutCount: 18,
      workoutIds: ["catalog-workout-1", "catalog-workout-2"],
    };

    expect(programWeekCount(source)).toBe(6);
    expect(programWorkoutCount(source)).toBe(18);
    expect(programWorkoutIds(source)).toEqual([
      "catalog-workout-1",
      "catalog-workout-2",
    ]);
  });

  it("defaults missing lightweight metadata to empty values", () => {
    const source: Program = {
      ...program(),
      detailsLoaded: false,
      weeks: [],
    };

    expect(programWeekCount(source)).toBe(0);
    expect(programWorkoutCount(source)).toBe(0);
    expect(programWorkoutIds(source)).toEqual([]);
  });
});

describe("program tree ordering", () => {
  it("reorders the single implicit workout sequence without mutation", () => {
    const source: Program = {
      ...program(),
      weeks: [program().weeks[0]],
    };
    const originalOrder = source.weeks[0].workouts.map(({ id }) => id);

    const result = reorderProgramWorkoutSequence(source, [
      "workout-2",
      "workout-1",
    ]);

    expect(result.weeks[0].workouts.map(({ id }) => id)).toEqual([
      "workout-2",
      "workout-1",
    ]);
    expect(source.weeks[0].workouts.map(({ id }) => id)).toEqual(originalOrder);
  });

  it("does not collapse an unnormalized legacy tree in memory", () => {
    const source = program();
    expect(
      reorderProgramWorkoutSequence(source, [
        "workout-3",
        "workout-2",
        "workout-1",
      ]),
    ).toBe(source);
  });

  it("reorders only the requested week's workouts without mutating the source", () => {
    const source = program();
    const originalOrder = source.weeks[0].workouts.map(({ id }) => id);

    const result = reorderProgramWorkouts(source, "week-1", [
      "workout-2",
      "workout-1",
    ]);

    expect(result.weeks[0].workouts.map(({ id }) => id)).toEqual([
      "workout-2",
      "workout-1",
    ]);
    expect(result.weeks[1].workouts).toBe(source.weeks[1].workouts);
    expect(source.weeks[0].workouts.map(({ id }) => id)).toEqual(originalOrder);
  });

  it("reorders the requested workout's complete exercise list", () => {
    const source = program();
    source.weeks[0].workouts[0].sections[0].items = [item("item-a"), item("item-b")];

    const result = reorderProgramWorkoutItems(source, "workout-1", ["item-b", "item-a"]);

    expect(result.weeks[0].workouts[0].sections[0].items.map(({ id }) => id)).toEqual([
      "item-b",
      "item-a",
    ]);
    expect(result.weeks[0].workouts[1]).toBe(source.weeks[0].workouts[1]);
  });

});
