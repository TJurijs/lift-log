import type { CompletedSession, HistoryCursor } from "../../../lib/domain";
import type { LiftLogRepository } from "../../../lib/repository";
import { useLazyHistory } from "./useLazyHistory";

type HistoryRepository = Pick<LiftLogRepository, "listCompletedSessionSummaries">;
const fetchPage = (repository: HistoryRepository, cursor?: HistoryCursor) =>
  repository.listCompletedSessionSummaries({ limit: 20, ...(cursor ? { cursor } : {}) });

export function useCompletedHistory(
  repository: HistoryRepository | null,
  initialSessions: CompletedSession[],
) {
  const { items, ...state } = useLazyHistory(repository, initialSessions, fetchPage, "Completed workouts could not be loaded.");
  return { ...state, sessions: items };
}
