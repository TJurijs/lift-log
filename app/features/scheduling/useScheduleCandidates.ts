import { useRef, useState } from "react";
import type { FrequentSchedulableWorkoutCandidate, Program, ScheduledWorkout, SchedulableWorkoutCandidate, SchedulableWorkoutCursor } from "../../../lib/domain";
import type { SchedulingRepository } from "../../../lib/repository-contracts";

type Options = {
  repository: Pick<SchedulingRepository, "listSchedulableWorkouts" | "listFrequentSchedulableWorkouts"> | null;
  schedulablePrograms: Program[];
  schedules: ScheduledWorkout[];
};

/** Owns pagination, refreshes and local demo candidates for the scheduling picker. */
export function useScheduleCandidates({ repository, schedulablePrograms, schedules }: Options) {
  const loadingRef = useRef(false);
  const requestRef = useRef(0);
  const [scheduleCandidates, setScheduleCandidates] = useState<
    SchedulableWorkoutCandidate[]
  >([]);
  const [frequentScheduleCandidates, setFrequentScheduleCandidates] = useState<
    FrequentSchedulableWorkoutCandidate[]
  >([]);
  const [scheduleCandidateCursor, setScheduleCandidateCursor] =
    useState<SchedulableWorkoutCursor>();
  const [scheduleCandidatesLoading, setScheduleCandidatesLoading] =
    useState(false);
  const [scheduleCandidatesError, setScheduleCandidatesError] = useState("");

  async function loadScheduleCandidates(reset = false) {
    if (loadingRef.current && !reset) return;
    const request = ++requestRef.current;
    loadingRef.current = true;
    setScheduleCandidatesLoading(true);
    setScheduleCandidatesError("");
    try {
      if (repository) {
        const [page, frequent] = await Promise.all([
          repository.listSchedulableWorkouts({
            limit: 50,
            ...(reset || !scheduleCandidateCursor
              ? {}
              : { cursor: scheduleCandidateCursor }),
          }),
          reset
            ? repository.listFrequentSchedulableWorkouts(6).catch(() => [])
            : Promise.resolve(null),
        ]);
        if (request !== requestRef.current) return;
        if (frequent) setFrequentScheduleCandidates(frequent);
        const quickWorkoutItems = page.items.filter(
          (candidate) => candidate.isQuickWorkout,
        );
        setScheduleCandidates((current) =>
          reset
            ? quickWorkoutItems
            : [
                ...current,
                ...quickWorkoutItems.filter(
                  (item) =>
                    !current.some(
                      (existing) =>
                        existing.programVersionId === item.programVersionId &&
                        existing.workoutId === item.workoutId &&
                        existing.assignmentId === item.assignmentId,
                    ),
                ),
              ],
        );
        setScheduleCandidateCursor(page.nextCursor);
        return;
      }

      if (!import.meta.env.DEV) return;
      const demoCandidates = schedulablePrograms
        .filter((candidate) => candidate.contentType === "quick_workout")
        .flatMap((candidate) =>
        candidate.weeks.flatMap((week) =>
          week.workouts.map((workout, position) => {
            const occurrences = schedules.filter(
              (occurrence) =>
                occurrence.programVersionId === candidate.versionId &&
                occurrence.workoutId === workout.id,
            );
            const latest = occurrences.sort(
              (left, right) => right.sequenceNumber - left.sequenceNumber,
            )[0];
            return {
              kind: "program" as const,
              programId: candidate.id,
              programVersionId: candidate.versionId,
              workoutId: workout.id,
              programTitle: candidate.title,
              workoutTitle: workout.title,
              contentType: candidate.contentType ?? "program",
              isQuickWorkout: candidate.contentType === "quick_workout",
              weekIndex: week.index,
              weekLabel: week.label,
              workoutPosition: position,
              scheduleLabel: workout.dayLabel,
              estimatedMinutes: workout.durationMinutes,
              ...(latest
                ? {
                    latestOccurrence: {
                      id: latest.id,
                      plannedDate: latest.plannedDate,
                      status: latest.status,
                      sequenceNumber: latest.sequenceNumber,
                    },
                  }
                : {}),
            } satisfies SchedulableWorkoutCandidate;
          }),
        ),
        );
      setScheduleCandidates(demoCandidates);
      setFrequentScheduleCandidates(
        demoCandidates
          .filter(
            (candidate) =>
              candidate.isQuickWorkout &&
              (candidate.latestOccurrence?.sequenceNumber ?? 0) > 0,
          )
          .sort(
            (left, right) =>
              (right.latestOccurrence?.sequenceNumber ?? 0) -
                (left.latestOccurrence?.sequenceNumber ?? 0) ||
              left.workoutTitle.localeCompare(right.workoutTitle),
          )
          .slice(0, 6)
          .map((candidate) => ({
            ...candidate,
            usageCount: candidate.latestOccurrence?.sequenceNumber ?? 1,
            lastUsedAt: candidate.latestOccurrence?.plannedDate ?? "1970-01-01",
          })),
      );
      setScheduleCandidateCursor(undefined);
    } catch (error) {
      if (request !== requestRef.current) return;
      setScheduleCandidatesError(
        error instanceof Error
          ? error.message
          : "Workouts available to schedule could not be loaded.",
      );
    } finally {
      if (request === requestRef.current) {
        loadingRef.current = false;
        setScheduleCandidatesLoading(false);
      }
    }
  }

  function replaceScheduleCandidates(candidates: SchedulableWorkoutCandidate[]) {
    // Selecting a specific program supersedes any older picker request.
    requestRef.current += 1;
    loadingRef.current = false;
    setScheduleCandidatesLoading(false);
    setScheduleCandidates(candidates);
    setFrequentScheduleCandidates([]);
    setScheduleCandidateCursor(undefined);
    setScheduleCandidatesError("");
  }

  return { scheduleCandidates, frequentScheduleCandidates, scheduleCandidateCursor,
    scheduleCandidatesLoading, scheduleCandidatesError, loadScheduleCandidates,
    replaceScheduleCandidates };
}
