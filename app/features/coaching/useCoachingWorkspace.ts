import { useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { CoachAthleteCursor, CoachingWorkspaceData, WorkspaceData } from "../../../lib/domain";
import type { CoachingRepository } from "../../../lib/repository-contracts";

export function useCoachingWorkspace({ repository, workspace, setWorkspace, notify, requestedCoachMode, initialAthleteId }: {
  repository: CoachingRepository | null;
  workspace: WorkspaceData;
  setWorkspace: Dispatch<SetStateAction<WorkspaceData>>;
  notify: (message: string) => void;
  requestedCoachMode: "athlete" | "coach";
  initialAthleteId: string | null;
}) {
  const coachingRefreshRef = useRef(false);
  const [coachingRefreshing, setCoachingRefreshing] = useState(false);
  const [coachAthleteCursor, setCoachAthleteCursor] = useState<
    CoachAthleteCursor | undefined
  >();
  const [coachAthletesLoadingMore, setCoachAthletesLoadingMore] =
    useState(false);
  const [coachAthletesLoadError, setCoachAthletesLoadError] = useState("");
  const coachingDetailRequestsRef = useRef(new Set<string>());
  const [coachingDetailLoadingId, setCoachingDetailLoadingId] = useState<
    string | null
  >(null);
  const [coachingHistoryLoadingId, setCoachingHistoryLoadingId] = useState<
    string | null
  >(null);
  const [coachingProgramRunsLoadingId, setCoachingProgramRunsLoadingId] =
    useState<string | null>(null);
  const [selectedAthleteId, setSelectedAthleteId] = useState<string | null>(
    initialAthleteId,
  );
  const pageRequests = useRef(new Set<string>());
  const requestGeneration = useRef(0);
  const selection = useRef({ athleteId: initialAthleteId, mode: requestedCoachMode });
  useLayoutEffect(() => {
    selection.current = { athleteId: selectedAthleteId, mode: requestedCoachMode };
  }, [selectedAthleteId, requestedCoachMode]);

  function applyCoachingWorkspace(nextCoaching: CoachingWorkspaceData) {
    // A refreshed first page supersedes every detail/page read from the old view.
    // Releasing the old locks also lets its selected athlete load fresh details.
    requestGeneration.current += 1;
    pageRequests.current.clear();
    coachingDetailRequestsRef.current.clear();
    setCoachAthletesLoadingMore(false);
    setCoachingDetailLoadingId(null);
    setCoachingHistoryLoadingId(null);
    setCoachingProgramRunsLoadingId(null);
    const { coachAthleteCursor: nextCursor, ...workspaceData } = nextCoaching;
    setCoachAthleteCursor(nextCursor);
    setCoachAthletesLoadError("");
    setWorkspace((previous) => ({ ...previous, ...workspaceData }));
    const nextSelectedId = nextCoaching.coachedAthletes.find(
      (athlete) => athlete.id === selection.current.athleteId,
    )?.id ?? nextCoaching.coachedAthletes[0]?.id ?? null;
    selection.current.athleteId = nextSelectedId;
    setSelectedAthleteId(nextSelectedId);
    return nextSelectedId;
  }

  async function loadMoreCoachAthletes() {
    if (!repository || !coachAthleteCursor || pageRequests.current.has("athletes")) return;
    const generation = requestGeneration.current;
    pageRequests.current.add("athletes");
    setCoachAthletesLoadingMore(true);
    setCoachAthletesLoadError("");
    try {
      const page = await repository.listCoachAthletes({
        limit: 25,
        cursor: coachAthleteCursor,
      });
      if (generation !== requestGeneration.current) return;
      setWorkspace((previous) => {
        const athletesById = new Map(
          previous.coachedAthletes.map((athlete) => [athlete.id, athlete]),
        );
        for (const athlete of page.items) {
          if (!athletesById.has(athlete.id)) athletesById.set(athlete.id, athlete);
        }
        return { ...previous, coachedAthletes: [...athletesById.values()] };
      });
      setCoachAthleteCursor(page.nextCursor);
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      setCoachAthletesLoadError(
        error instanceof Error
          ? error.message
          : "More athletes could not be loaded.",
      );
    } finally {
      if (generation === requestGeneration.current) {
        pageRequests.current.delete("athletes");
        setCoachAthletesLoadingMore(false);
      }
    }
  }

  async function loadCoachedAthleteDetail(
    athleteId: string,
    force = false,
  ): Promise<boolean> {
    if (!repository) return true;
    const current = workspace.coachedAthletes.find(
      (athlete) => athlete.id === athleteId,
    );
    if (!force && current?.detailsLoaded !== false) return true;
    if (coachingDetailRequestsRef.current.has(athleteId)) return false;
    const generation = requestGeneration.current;
    coachingDetailRequestsRef.current.add(athleteId);
    setCoachingDetailLoadingId(athleteId);
    try {
      const detail = await repository.loadCoachedAthleteDetail(athleteId);
      if (generation !== requestGeneration.current) return false;
      if (!detail) throw new Error("This coaching connection is no longer active.");
      setWorkspace((previous) => ({
        ...previous,
        coachedAthletes: previous.coachedAthletes.map((athlete) =>
          athlete.id === athleteId ? detail : athlete,
        ),
      }));
      return true;
    } catch (error) {
      if (generation !== requestGeneration.current) return false;
      notify(
        error instanceof Error
          ? error.message
          : "The athlete overview could not be loaded",
      );
      return false;
    } finally {
      if (generation === requestGeneration.current) {
        coachingDetailRequestsRef.current.delete(athleteId);
        setCoachingDetailLoadingId((currentId) =>
          currentId === athleteId ? null : currentId,
        );
      }
    }
  }

  async function loadMoreCoachHistory(athleteId: string) {
    if (!repository || pageRequests.current.has("history")) return;
    const athlete = workspace.coachedAthletes.find(
      (candidate) => candidate.id === athleteId,
    );
    if (!athlete?.historyCursor || !athlete.hasMoreHistory) return;
    const generation = requestGeneration.current;
    pageRequests.current.add("history");
    setCoachingHistoryLoadingId(athleteId);
    try {
      const page = await repository.listCoachCompletedHistory(athleteId, {
        limit: 25,
        cursor: athlete.historyCursor,
      });
      if (generation !== requestGeneration.current) return;
      setWorkspace((previous) => ({
        ...previous,
        coachedAthletes: previous.coachedAthletes.map((candidate) => {
          if (candidate.id !== athleteId) return candidate;
          const agendaById = new Map(
            candidate.agenda.map((entry) => [entry.id, entry]),
          );
          for (const entry of page.items) agendaById.set(entry.id, entry);
          const agenda = [...agendaById.values()].sort((left, right) => {
            if (left.kind !== right.kind) return left.kind === "upcoming" ? -1 : 1;
            return left.kind === "upcoming"
              ? left.date.localeCompare(right.date)
              : right.date.localeCompare(left.date);
          });
          return {
            ...candidate,
            agenda,
            historyCursor: page.nextCursor,
            hasMoreHistory: page.hasMore,
          };
        }),
      }));
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      notify(
        error instanceof Error
          ? error.message
          : "More workout results could not be loaded.",
      );
    } finally {
      if (generation === requestGeneration.current) {
        pageRequests.current.delete("history");
        setCoachingHistoryLoadingId(null);
      }
    }
  }

  async function loadMoreCoachProgramRuns(athleteId: string) {
    if (!repository || pageRequests.current.has("runs")) return;
    const athlete = workspace.coachedAthletes.find(
      (candidate) => candidate.id === athleteId,
    );
    if (!athlete?.programRunCursor || !athlete.hasMoreProgramRuns) return;
    const generation = requestGeneration.current;
    pageRequests.current.add("runs");
    setCoachingProgramRunsLoadingId(athleteId);
    try {
      const page = await repository.listProgramRuns(athleteId, {
        limit: 25,
        cursor: athlete.programRunCursor,
      });
      if (generation !== requestGeneration.current) return;
      setWorkspace((previous) => ({
        ...previous,
        coachedAthletes: previous.coachedAthletes.map((candidate) => {
          if (candidate.id !== athleteId) return candidate;
          const runsById = new Map(
            (candidate.programRuns ?? []).map((run) => [run.id, run]),
          );
          for (const run of page.items) runsById.set(run.id, run);
          return {
            ...candidate,
            programRuns: [...runsById.values()],
            programRunCursor: page.nextCursor,
            hasMoreProgramRuns: page.hasMore,
          };
        }),
      }));
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      notify(
        error instanceof Error
          ? error.message
          : "More program history could not be loaded.",
      );
    } finally {
      if (generation === requestGeneration.current) {
        pageRequests.current.delete("runs");
        setCoachingProgramRunsLoadingId(null);
      }
    }
  }

  async function refreshCoachWorkspace(): Promise<boolean> {
    if (!repository) return true;
    if (coachingRefreshRef.current) return false;
    coachingRefreshRef.current = true;
    setCoachingRefreshing(true);
    try {
      const nextCoaching = await repository.loadCoachingWorkspace();
      const nextSelectedId = applyCoachingWorkspace(nextCoaching);
      if (selection.current.mode === "coach" && nextSelectedId) {
        await loadCoachedAthleteDetail(nextSelectedId, true);
      }
      return true;
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "The coach workspace could not be refreshed",
      );
      return false;
    } finally {
      coachingRefreshRef.current = false;
      setCoachingRefreshing(false);
    }
  }

  return { applyCoachingWorkspace, loadMoreCoachAthletes, loadCoachedAthleteDetail, loadMoreCoachHistory, loadMoreCoachProgramRuns, refreshCoachWorkspace, coachingRefreshing, coachAthleteCursor, setCoachAthleteCursor, coachAthletesLoadingMore, coachAthletesLoadError, setCoachAthletesLoadError, coachingDetailLoadingId, coachingHistoryLoadingId, coachingProgramRunsLoadingId, selectedAthleteId, setSelectedAthleteId };
}
