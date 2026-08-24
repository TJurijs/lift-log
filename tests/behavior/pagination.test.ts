import { describe, expect, it } from "vitest";

import { collectAllBatches, collectAllPages } from "../../lib/pagination";

function sourceWithRows(rowCount: number, pageSize = 500) {
  const rows = Array.from({ length: rowCount }, (_, id) => ({ id }));
  const ranges: Array<[number, number]> = [];
  return {
    ranges,
    load: async (from: number, to: number) => {
      ranges.push([from, to]);
      return { data: rows.slice(from, to + 1), error: null };
    },
    pageSize,
  };
}

describe("collectAllPages", () => {
  it.each([
    [0, 1],
    [499, 1],
    [500, 2],
    [999, 2],
    [1_000, 3],
    [1_001, 3],
    [5_000, 11],
  ])("returns all %s rows using %s bounded requests", async (rowCount, calls) => {
    const source = sourceWithRows(rowCount);

    const rows = await collectAllPages("Could not load rows", source.load, {
      pageSize: source.pageSize,
      maxPages: 20,
    });

    expect(rows).toHaveLength(rowCount);
    expect(source.ranges).toHaveLength(calls);
    expect(source.ranges.every(([from, to]) => to - from + 1 === 500)).toBe(true);
  });

  it("adds context to a page failure and returns no partial success", async () => {
    await expect(
      collectAllPages("Could not load history", async () => ({
        data: null,
        error: { message: "network unavailable" },
      })),
    ).rejects.toThrow("Could not load history: network unavailable");
  });

  it("rejects an oversized response instead of hiding a server contract change", async () => {
    await expect(
      collectAllPages(
        "Could not load rows",
        async () => ({ data: [{ id: 1 }, { id: 2 }], error: null }),
        { pageSize: 1 },
      ),
    ).rejects.toThrow("exceeded the requested page size");
  });

  it("fails explicitly at the configured safety ceiling", async () => {
    await expect(
      collectAllPages(
        "Could not load rows",
        async (from) => ({ data: [{ id: from }], error: null }),
        { pageSize: 1, maxPages: 2 },
      ),
    ).rejects.toThrow("exceeded 2 pages");
  });
});

describe("collectAllBatches", () => {
  it("bounds large identifier filters and paginates every batch", async () => {
    const ids = Array.from({ length: 250 }, (_, id) => id);
    const calls: Array<{ ids: readonly number[]; from: number; to: number }> = [];

    const rows = await collectAllBatches(
      "Could not load related rows",
      ids,
      async (batch, from, to) => {
        calls.push({ ids: batch, from, to });
        const batchRows = batch.flatMap((id) =>
          Array.from({ length: 6 }, (_, row) => ({ id, row })),
        );
        return { data: batchRows.slice(from, to + 1), error: null };
      },
      { batchSize: 100, pageSize: 500 },
    );

    expect(rows).toHaveLength(1_500);
    expect(calls).toHaveLength(5);
    expect(calls.every((call) => call.ids.length <= 100)).toBe(true);
  });

  it("does not call the data source for an empty identifier list", async () => {
    let called = false;
    const rows = await collectAllBatches(
      "Could not load related rows",
      [] as string[],
      async () => {
        called = true;
        return { data: [], error: null };
      },
    );

    expect(rows).toEqual([]);
    expect(called).toBe(false);
  });
});
