import { describe, expect, it, vi } from "vitest";
import type { Exercise, Program, WorkoutSection } from "../../lib/domain";
import { LiftLogRepository } from "../../lib/repository";

function makeRepository(data: unknown, error: { message: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  const from = vi.fn(() => { throw new Error("authoring must use one atomic RPC"); });
  return {
    repository: new LiftLogRepository({ rpc, from } as never, "owner-1", "Owner"),
    rpc,
    from,
  };
}

describe("atomic workout authoring", () => {
  it("uses the persisted workout order and returns its complete section", async () => {
    const { repository, rpc, from } = makeRepository({
      id: "workout-2",
      title: "Workout",
      position: 4,
      scheduleLabel: "Workout 5",
      estimatedMinutes: 45,
      sections: [{ id: "section-2", title: "Exercises", kind: "main", position: 0, items: [] }],
    });
    const staleProgram = {
      id: "program-1", versionId: "version-1",
      weeks: [{ id: "week-1", index: 1, workouts: [] }],
    } as unknown as Program;

    const result = await repository.addWorkout(staleProgram, "Workout");

    expect(rpc).toHaveBeenCalledExactlyOnceWith("append_program_workout", {
      target_week_id: "week-1", target_title: "Workout",
    });
    expect(from).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      id: "workout-2", programVersionId: "version-1", dayLabel: "Workout 5",
      sections: [{ id: "section-2", title: "Exercises", kind: "main", items: [] }],
    });
  });

  it("returns server-resolved exercise defaults instead of a stale catalogue snapshot", async () => {
    const { repository, rpc, from } = makeRepository({
      id: "item-1", sourceExerciseId: "exercise-1", name: "Updated name", cue: "Updated cue",
      exerciseCategory: "Strength", entryMode: "sets", trackingFields: ["reps", "load"],
      position: 7,
      prescribedEntries: [0, 1, 2].map((position) => ({
        id: `entry-${position}`, position, repsMin: 8, repsMax: 8, targetRpeMin: 7, targetRpeMax: 8,
      })),
    });
    const section = { id: "section-1", items: [] } as unknown as WorkoutSection;
    const staleExercise = {
      id: "exercise-1", name: "Old name", defaultMode: "none", defaultFields: [],
    } as unknown as Exercise;

    const result = await repository.addWorkoutItem(section, staleExercise);

    expect(rpc).toHaveBeenCalledExactlyOnceWith("append_workout_exercise", {
      target_section_id: "section-1", target_exercise_id: "exercise-1",
    });
    expect(from).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      id: "item-1", title: "Updated name", cue: "Updated cue", mode: "sets",
      fields: ["reps", "load"], position: 7,
      prescription: { sets: 3, reps: "8", targetRpe: "7–8" },
    });
  });

  it("surfaces an atomic insert failure without a fallback partial write", async () => {
    const { repository, rpc, from } = makeRepository(null, { message: "child insert rejected" });
    await expect(repository.addWorkoutItem(
      { id: "section-1", items: [] } as unknown as WorkoutSection,
      { id: "exercise-1" } as Exercise,
    )).rejects.toThrow("Could not add the exercise to the workout: child insert rejected");
    expect(rpc).toHaveBeenCalledOnce();
    expect(from).not.toHaveBeenCalled();
  });
});
