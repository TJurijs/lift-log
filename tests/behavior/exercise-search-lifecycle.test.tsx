import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useExerciseSearch } from "../../app/features/exercises/useExerciseSearch";
import { emptyExerciseLibraryFilters } from "../../app/features/exercises/exercise-library";
import type { LiftLogRepository } from "../../lib/repository";

type Page = Awaited<ReturnType<LiftLogRepository["searchExercises"]>>;
const filters = emptyExerciseLibraryFilters();
const cursor = { id: "last-id", name: "Last exercise" };
const page: Page = { items: [], hasMore: true, nextCursor: cursor };
function deferred() {
  let resolve!: (page: Page) => void;
  const promise = new Promise<Page>((done) => { resolve = done; });
  return { resolve, promise };
}
async function debounce() {
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
}
afterEach(() => vi.useRealTimers());

describe("exercise search lifecycle", () => {
  it("cannot append an old cursor while a new search is debouncing", async () => {
    vi.useFakeTimers();
    const repository = { searchExercises: vi.fn().mockResolvedValue(page) };
    const onPage = vi.fn();
    const { result, rerender } = renderHook(({ query }) => useExerciseSearch({ repository, onPage, query, enabled: true, scope: "global", filters }), { initialProps: { query: "" } });
    await debounce();
    expect(result.current.cursor).toEqual(cursor);
    const staleLoadMore = result.current.loadMore;
    rerender({ query: "squat" });
    expect(result.current.cursor).toBeUndefined();
    expect(result.current.loading).toBe(true);
    await act(async () => { await staleLoadMore(); await result.current.loadMore(); });
    expect(repository.searchExercises).toHaveBeenCalledTimes(1);
    await debounce();
    expect(repository.searchExercises).toHaveBeenCalledTimes(2);
    expect(repository.searchExercises).toHaveBeenLastCalledWith(expect.objectContaining({ query: "squat" }));
    expect(repository.searchExercises.mock.lastCall?.[0]).not.toHaveProperty("cursor");
    expect(result.current.loading).toBe(false);
    expect(onPage.mock.calls.every((call) => call[2] === false)).toBe(true);
  });

  it("discards results after leaving the library or changing account", async () => {
    vi.useFakeTimers();
    const stale = deferred();
    const first = { searchExercises: vi.fn().mockReturnValue(stale.promise) };
    const next = { searchExercises: vi.fn().mockResolvedValue(page) };
    const onPage = vi.fn();
    const { result, rerender, unmount } = renderHook(({ repository, enabled }) => useExerciseSearch({ repository, enabled, onPage, query: "", scope: "global", filters }), { initialProps: { repository: first, enabled: true } });
    await debounce();
    rerender({ repository: first, enabled: false });
    await act(async () => { stale.resolve(page); });
    expect(onPage).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    rerender({ repository: next, enabled: true });
    await debounce();
    expect(onPage).toHaveBeenCalledOnce();
    unmount();
    await act(async () => { await result.current.loadMore(); });
    expect(next.searchExercises).toHaveBeenCalledOnce();
  });

  it("coalesces repeated pagination clicks and preserves the cursor after a failure", async () => {
    vi.useFakeTimers();
    const more = deferred();
    const repository = { searchExercises: vi.fn().mockResolvedValueOnce(page).mockReturnValueOnce(more.promise).mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce({ items: [], hasMore: false }) };
    const onPage = vi.fn();
    const { result } = renderHook(() => useExerciseSearch({ repository, onPage, query: "", enabled: true, scope: "personal", filters }));
    await debounce();
    let pending!: Promise<void>;
    act(() => { pending = result.current.loadMore(); void result.current.loadMore(); });
    expect(repository.searchExercises).toHaveBeenCalledTimes(2);
    await act(async () => { more.resolve(page); await pending; });
    await act(async () => { await result.current.loadMore(); });
    expect(result.current.error).toBe("Offline");
    expect(result.current.cursor).toEqual(cursor);
    expect(onPage).toHaveBeenCalledTimes(2);
    await act(async () => { await result.current.loadMore(); });
    expect(result.current.error).toBe("");
    expect(result.current.cursor).toBeUndefined();
    expect(result.current.loading).toBe(false);
  });

  it("retries an initial failure and ignores an older response after a filter change", async () => {
    vi.useFakeTimers();
    const stale = deferred();
    const repository = { searchExercises: vi.fn().mockRejectedValueOnce(new Error("Offline")).mockReturnValueOnce(stale.promise).mockResolvedValueOnce(page) };
    const onPage = vi.fn();
    const { result, rerender } = renderHook(({ scope }: { scope: "global" | "personal" }) => useExerciseSearch({ repository, onPage, query: "", enabled: true, scope, filters }), { initialProps: { scope: "global" } });
    await debounce();
    expect(result.current.error).toBe("Offline");
    act(() => result.current.retry());
    await debounce();
    rerender({ scope: "personal" });
    await debounce();
    await act(async () => { stale.resolve(page); });
    expect(onPage).toHaveBeenCalledExactlyOnceWith([], "personal", false);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe("");
  });
});
