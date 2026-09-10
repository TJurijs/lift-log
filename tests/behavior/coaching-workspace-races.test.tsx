import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { useCoachingWorkspace } from "../../app/features/coaching/useCoachingWorkspace";
import { demoWorkspace } from "../../lib/demo-data";
import type { AthleteSummary, CoachAthleteCursor, CoachingWorkspaceData, CursorPage } from "../../lib/domain";
import type { CoachingRepository } from "../../lib/repository-contracts";

const athlete: AthleteSummary = {
  id: "athlete-a", name: "Athlete A", initials: "AA", detailsLoaded: false,
  assignedPrograms: [], agenda: [],
};
const cursor: CoachAthleteCursor = { displayName: "Athlete A", id: athlete.id };
const coaching = (athletes = [athlete]): CoachingWorkspaceData => ({
  coachedAthletes: athletes, coachConnections: [], pendingCoachInvites: [], outgoingCoachInvites: [],
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function setup(repository: CoachingRepository, athletes = [athlete], mode: "athlete" | "coach" = "coach") {
  return renderHook(() => {
    const [workspace, setWorkspace] = useState({ ...demoWorkspace, ...coaching(athletes) });
    const controller = useCoachingWorkspace({ repository, workspace, setWorkspace,
      notify: vi.fn(), requestedCoachMode: mode, initialAthleteId: athlete.id });
    return { ...controller, workspace };
  });
}

describe("coaching refresh request boundaries", () => {
  it("does not restore removed athletes or an obsolete cursor from pagination started before refresh", async () => {
    const oldPage = deferred<CursorPage<AthleteSummary, CoachAthleteCursor>>();
    const repository = {
      listCoachAthletes: vi.fn(() => oldPage.promise),
      loadCoachingWorkspace: vi.fn().mockResolvedValue(coaching()),
    } as unknown as CoachingRepository;
    const { result } = setup(repository, [athlete], "athlete");
    act(() => result.current.setCoachAthleteCursor(cursor));
    let pageRequest!: Promise<void>;
    act(() => { pageRequest = result.current.loadMoreCoachAthletes(); });
    await act(() => result.current.refreshCoachWorkspace());
    await act(async () => {
      oldPage.resolve({ items: [{ ...athlete, id: "removed-athlete" }], nextCursor: cursor, hasMore: true });
      await pageRequest;
    });
    expect(result.current.workspace.coachedAthletes.map((item) => item.id)).toEqual([athlete.id]);
    expect(result.current.coachAthleteCursor).toBeUndefined();
    expect(result.current.coachAthletesLoadingMore).toBe(false);
  });

  it("fetches fresh details after a refresh instead of accepting an older pending overview", async () => {
    const oldDetail = deferred<AthleteSummary>();
    const newDetail = { ...athlete, detailsLoaded: true, assignedProgramCount: 2 };
    const repository = {
      loadCoachedAthleteDetail: vi.fn().mockReturnValueOnce(oldDetail.promise).mockResolvedValueOnce(newDetail),
      loadCoachingWorkspace: vi.fn().mockResolvedValue(coaching()),
    } as unknown as CoachingRepository;
    const { result } = setup(repository);
    let detailRequest!: Promise<boolean>;
    act(() => { detailRequest = result.current.loadCoachedAthleteDetail(athlete.id); });
    await act(() => result.current.refreshCoachWorkspace());
    await act(async () => {
      oldDetail.resolve({ ...athlete, detailsLoaded: true, assignedProgramCount: 1 });
      await detailRequest;
    });
    expect(repository.loadCoachedAthleteDetail).toHaveBeenCalledTimes(2);
    expect(result.current.workspace.coachedAthletes[0]).toEqual(newDetail);
  });

  it("refreshes the athlete selected while the workspace request was pending", async () => {
    const other = { ...athlete, id: "athlete-b", name: "Athlete B" };
    const pending = deferred<CoachingWorkspaceData>();
    const repository = {
      loadCoachingWorkspace: vi.fn(() => pending.promise),
      loadCoachedAthleteDetail: vi.fn(async (id: string) => ({ ...(id === other.id ? other : athlete), detailsLoaded: true })),
    } as unknown as CoachingRepository;
    const { result } = setup(repository, [athlete, other]);
    let refresh!: Promise<boolean>;
    act(() => { refresh = result.current.refreshCoachWorkspace(); });
    act(() => result.current.setSelectedAthleteId(other.id));
    await act(async () => { pending.resolve(coaching([athlete, other])); await refresh; });
    expect(result.current.selectedAthleteId).toBe(other.id);
    expect(repository.loadCoachedAthleteDetail).toHaveBeenCalledWith(other.id);
    expect(result.current.workspace.coachedAthletes.find((item) => item.id === other.id)?.detailsLoaded).toBe(true);
  });
});
