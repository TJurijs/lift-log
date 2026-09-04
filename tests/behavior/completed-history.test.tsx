import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useCompletedHistory } from "../../app/features/next-workouts/useCompletedHistory";
import type { CompletedSession, HistoryCursor } from "../../lib/domain";
import type { LiftLogRepository } from "../../lib/repository";

type HistoryPage = Awaited<ReturnType<LiftLogRepository["listCompletedSessionSummaries"]>>;
const initialSessions: CompletedSession[] = [];
const cursor: HistoryCursor = { id: "second", startedAt: "2026-09-03T10:00:00Z" };

function session(id: string): CompletedSession {
  return { id, workoutTitle: id, workoutId: "workout", programVersionId: "version", date: "2026-09-03", durationMinutes: 30, rpe: 7 };
}

function page(ids: string[], nextCursor?: HistoryCursor): HistoryPage {
  return { items: ids.map(session), hasMore: Boolean(nextCursor), nextCursor };
}

function deferred() {
  let resolve!: (value: HistoryPage) => void;
  const promise = new Promise<HistoryPage>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("completed history paging", () => {
  it("loads lazily, coalesces requests, and reaches older pages without duplicates", async () => {
    const list = vi.fn<LiftLogRepository["listCompletedSessionSummaries"]>()
      .mockResolvedValueOnce(page(["first", "second"], cursor))
      .mockResolvedValueOnce(page(["second", "third"]));
    const repository = { listCompletedSessionSummaries: list };
    const { result } = renderHook(() => useCompletedHistory(repository, initialSessions));
    expect(list).not.toHaveBeenCalled();
    await act(async () => { await Promise.all([result.current.load(), result.current.load()]); });
    expect(list).toHaveBeenCalledTimes(1);
    await act(async () => { await result.current.load(true); });
    expect(list).toHaveBeenLastCalledWith({ limit: 20, cursor });
    expect(result.current.sessions.map((entry) => entry.id)).toEqual(["first", "second", "third"]);
    expect(result.current.cursor).toBeUndefined();
    await act(async () => { await result.current.load(true); });
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("keeps loaded rows after a page error and retries the failed cursor", async () => {
    const list = vi.fn<LiftLogRepository["listCompletedSessionSummaries"]>()
      .mockResolvedValueOnce(page(["first", "second"], cursor))
      .mockRejectedValueOnce(new Error("Network unavailable"))
      .mockResolvedValueOnce(page(["third"]));
    const repository = { listCompletedSessionSummaries: list };
    const { result } = renderHook(() => useCompletedHistory(repository, initialSessions));
    await act(async () => { await result.current.load(); });
    await act(async () => { await result.current.load(true); });
    expect(result.current.error).toBe("Network unavailable");
    expect(result.current.sessions).toHaveLength(2);
    expect(result.current.cursor).toEqual(cursor);
    await act(async () => { await result.current.load(true); });
    expect(list).toHaveBeenLastCalledWith({ limit: 20, cursor });
    expect(result.current.error).toBe("");
    expect(result.current.sessions).toHaveLength(3);
  });

  it("retries a failed refresh from the first page after completion invalidates history", async () => {
    const list = vi.fn<LiftLogRepository["listCompletedSessionSummaries"]>()
      .mockResolvedValueOnce(page(["old"], cursor))
      .mockRejectedValueOnce(new Error("Refresh failed"))
      .mockResolvedValueOnce(page(["new", "old"], cursor));
    const repository = { listCompletedSessionSummaries: list };
    const { result } = renderHook(() => useCompletedHistory(repository, initialSessions));
    await act(async () => { await result.current.load(); });
    act(() => result.current.invalidate());
    expect(result.current.cursor).toBeUndefined();
    await act(async () => { await result.current.load(); });
    expect(result.current.sessions.map((entry) => entry.id)).toEqual(["old"]);
    expect(result.current.error).toBe("Refresh failed");
    // Even a stale load-more handler must retry the first page here.
    await act(async () => { await result.current.load(true); });
    expect(list).toHaveBeenLastCalledWith({ limit: 20 });
    expect(result.current.sessions.map((entry) => entry.id)).toEqual(["new", "old"]);
  });

  it("ignores an invalidated in-flight page and refreshes once after it settles", async () => {
    const stale = deferred();
    const list = vi.fn<LiftLogRepository["listCompletedSessionSummaries"]>()
      .mockResolvedValueOnce(page(["old"], cursor))
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(page(["new", "old"]));
    const repository = { listCompletedSessionSummaries: list };
    const { result } = renderHook(() => useCompletedHistory(repository, initialSessions));
    await act(async () => { await result.current.load(); });
    let pending!: Promise<void>;
    act(() => { pending = result.current.load(true); });
    act(() => { result.current.invalidate(); result.current.invalidate(); });
    await act(async () => {
      stale.resolve(page(["stale"], cursor));
      await pending;
    });
    expect(list).toHaveBeenCalledTimes(3);
    expect(list).toHaveBeenLastCalledWith({ limit: 20 });
    expect(result.current.sessions.map((entry) => entry.id)).toEqual(["new", "old"]);
    expect(result.current.loading).toBe(false);
  });

  it("never applies a previous account's response after the repository changes", async () => {
    const stale = deferred();
    const first = { listCompletedSessionSummaries: vi.fn().mockReturnValue(stale.promise) };
    const next = { listCompletedSessionSummaries: vi.fn().mockResolvedValue(page(["next-account"])) };
    const { result, rerender } = renderHook(({ repository }) => useCompletedHistory(repository, initialSessions), { initialProps: { repository: first } });
    let pending!: Promise<void>;
    act(() => { pending = result.current.load(); });
    rerender({ repository: next });
    await act(async () => { await result.current.load(); });
    await act(async () => { stale.resolve(page(["previous-account"])); await pending; });
    expect(result.current.sessions.map((entry) => entry.id)).toEqual(["next-account"]);
  });
});
