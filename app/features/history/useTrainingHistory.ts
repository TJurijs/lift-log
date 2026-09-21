import type { ProgramRunSummary, ProgramRunCursor } from "../../../lib/domain";
import type { LiftLogRepository } from "../../../lib/repository";
import { useLazyHistory } from "./useLazyHistory";

type HistoryRepository = Pick<LiftLogRepository, "listProgramRuns">;
const fetchPage = (repository: HistoryRepository, cursor?: ProgramRunCursor) =>
  repository.listProgramRuns(undefined, { statusScope: "history", limit: 25, ...(cursor ? { cursor } : {}) });

export function useTrainingHistory(
  repository: HistoryRepository | null,
  initialSessions: ProgramRunSummary[],
) {
  const { items, ...state } = useLazyHistory(repository, initialSessions, fetchPage, "Training history could not be loaded.");
  return { ...state, sessions: items };
}
