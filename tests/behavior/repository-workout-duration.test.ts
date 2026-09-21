import { describe, expect, it, vi } from "vitest";

import type { Program } from "../../lib/domain";
import { LiftLogRepository } from "../../lib/repository";

const estimates = [null, undefined, 55];
const source = {
  id: "program-1", versionId: "version-1",
  weeks: [{ id: "week-1", index: 1, workouts: [] }],
} as unknown as Program;

function repositoryWithPayload(data: unknown) {
  const rpc = vi.fn().mockResolvedValue({ data, error: null });
  return new LiftLogRepository({ rpc } as never, "owner-1", "Owner");
}

describe("optional workout estimates", () => {
  it.each(estimates)("preserves an appended workout estimate of %s without a default", async (estimate) => {
    const repository = repositoryWithPayload({
      id: "workout-1", title: "Workout", position: 0, estimatedMinutes: estimate,
      sections: [{ id: "section-1", title: "Exercises", kind: "main", position: 0, items: [] }],
    });
    const workout = await repository.addWorkout(source, "Workout");
    expect(workout.durationMinutes).toBe(estimate ?? undefined);
  });

  it.each(estimates)("preserves a calendar workout estimate of %s", async (estimate) => {
    const repository = repositoryWithPayload([{
      id: "schedule-1", program_id: "program-1", program_version_id: "version-1",
      program_title: "Program", workout_id: "workout-1", workout_title: "Workout",
      planned_date: "2026-09-21", status: "planned", estimated_minutes: estimate,
    }]);
    const page = await repository.listCalendarOccurrences("2026-09-21", "2026-09-21");
    expect(page.items).toHaveLength(1);
    expect(page.items[0].workout.durationMinutes).toBe(estimate ?? undefined);
  });

  it.each(estimates)("preserves a bootstrap workout estimate of %s", async (estimate) => {
    const repository = repositoryWithPayload({
      profile: {
        id: "owner-1", firstName: "Own", lastName: "Er", displayName: "Owner",
        liftlogId: "owner", weekStartsOnSunday: false, weightUnit: "kg", distanceUnit: "km",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      activeSession: null, activeWorkout: null,
      nextWorkouts: [{
        id: "schedule-1", programVersionId: "version-1", workoutId: "workout-1",
        workoutTitle: "Workout", programTitle: "Program", status: "planned",
        plannedDate: "2026-09-21", estimatedMinutes: estimate,
      }],
    });
    const workspace = await repository.loadBootstrap();
    expect(workspace.scheduledWorkouts).toHaveLength(1);
    expect(workspace.scheduledWorkouts[0].workout.durationMinutes).toBe(estimate ?? undefined);
  });

  it.each(estimates)("preserves a concrete program workout estimate of %s", async (estimate) => {
    const repository = repositoryWithPayload({
      id: "run-1", athleteId: "owner-1", createdById: "owner-1", programId: "program-1",
      programVersionId: "version-1", title: "Program", status: "not_started",
      createdAt: "2026-09-21T09:00:00Z", totalWorkouts: 1,
      workouts: [{
        id: "slot-1", runId: "run-1", workoutId: "workout-1", title: "Workout",
        position: 0, status: "unscheduled", estimatedMinutes: estimate,
      }],
    });
    const detail = await repository.loadProgramRunDetail("run-1");
    expect(detail?.workouts).toHaveLength(1);
    expect(detail?.workouts[0].estimatedMinutes).toBe(estimate ?? undefined);
  });

  it.each(estimates)("persists a changed or cleared estimate of %s", async (estimate) => {
    const single = vi.fn().mockResolvedValue({ data: { id: "workout-1" }, error: null });
    const select = vi.fn(() => ({ single }));
    const eq = vi.fn(() => ({ select }));
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));
    const repository = new LiftLogRepository({ from } as never, "owner-1", "Owner");
    await repository.updateWorkout("workout-1", "Updated workout", estimate);
    expect(from).toHaveBeenCalledWith("workouts");
    expect(update).toHaveBeenCalledExactlyOnceWith({
      title: "Updated workout", estimated_minutes: estimate ?? null,
    });
  });
});
