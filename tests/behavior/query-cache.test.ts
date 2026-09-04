import { describe, expect, it, vi } from "vitest";
import { BoundedQueryCache } from "../../lib/query-cache";

describe("BoundedQueryCache", () => {
  it("coalesces identical in-flight reads", async () => {
    const cache = new BoundedQueryCache();
    let resolve!: (value: string) => void;
    const loader = vi.fn(
      () => new Promise<string>((next) => { resolve = next; }),
    );

    const first = cache.getOrLoad("program:1", loader);
    const second = cache.getOrLoad("program:1", loader);
    resolve("loaded");

    await expect(Promise.all([first, second])).resolves.toEqual([
      "loaded",
      "loaded",
    ]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("invalidates an in-flight read without letting its stale result replace a refresh", async () => {
    const cache = new BoundedQueryCache();
    let resolveStale!: (value: string) => void;
    let resolveFresh!: (value: string) => void;
    const stale = cache.getOrLoad(
      "program-runs:self",
      () => new Promise<string>((resolve) => { resolveStale = resolve; }),
    );

    cache.invalidate("program-runs:");
    const fresh = cache.getOrLoad(
      "program-runs:self",
      () => new Promise<string>((resolve) => { resolveFresh = resolve; }),
    );

    resolveFresh("fresh");
    await expect(fresh).resolves.toBe("fresh");
    resolveStale("stale");
    await expect(stale).resolves.toBe("fresh");
    expect(cache.peek("program-runs:self")).toBe("fresh");
  });

  it("retries an invalidated in-flight read when no refresh has started yet", async () => {
    const cache = new BoundedQueryCache();
    let resolveStale!: (value: string) => void;
    const loader = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(
        () => new Promise<string>((resolve) => { resolveStale = resolve; }),
      )
      .mockResolvedValueOnce("fresh");

    const result = cache.getOrLoad("coach-summary:athlete", loader);
    cache.invalidate("coach-summary:");
    resolveStale("stale");

    await expect(result).resolves.toBe("fresh");
    expect(loader).toHaveBeenCalledTimes(2);
    expect(cache.peek("coach-summary:athlete")).toBe("fresh");
  });

  it.each(["resolve", "reject"])(
    "refreshes every coalesced caller when the invalidated loader later %ss",
    async (settlement) => {
      const cache = new BoundedQueryCache();
      let resolveStale!: (value: string) => void;
      let rejectStale!: (reason: Error) => void;
      const loader = vi.fn(() => new Promise<string>((resolve, reject) => {
        resolveStale = resolve;
        rejectStale = reject;
      }));
      const first = cache.getOrLoad("program:1", loader);
      const follower = cache.getOrLoad("program:1", loader);
      const allCallers = Promise.all([first, follower]);

      cache.invalidate("program:");
      await cache.getOrLoad("program:1", async () => "fresh");
      if (settlement === "resolve") resolveStale("stale");
      else rejectStale(new Error("stale failure"));

      await expect(allCallers).resolves.toEqual(["fresh", "fresh"]);
      expect(loader).toHaveBeenCalledTimes(1);
    },
  );

  it("shares one retry among coalesced callers after invalidation", async () => {
    const cache = new BoundedQueryCache();
    let resolveStale!: (value: string) => void;
    const loader = vi.fn<() => Promise<string>>()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveStale = resolve; }))
      .mockResolvedValueOnce("fresh");
    const first = cache.getOrLoad("program:1", loader);
    const follower = cache.getOrLoad("program:1", loader);

    cache.delete("program:1");
    resolveStale("stale");

    await expect(Promise.all([first, follower])).resolves.toEqual(["fresh", "fresh"]);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("does not surface an invalidated in-flight failure over a fresh result", async () => {
    const cache = new BoundedQueryCache();
    let rejectStale!: (reason: Error) => void;
    const stale = cache.getOrLoad(
      "program-runs:self",
      () => new Promise<string>((_resolve, reject) => { rejectStale = reject; }),
    );

    cache.invalidate("program-runs:");
    const fresh = cache.getOrLoad("program-runs:self", async () => "fresh");
    await expect(fresh).resolves.toBe("fresh");
    rejectStale(new Error("stale failure"));

    await expect(stale).resolves.toBe("fresh");
  });

  it("does not retain rejected or explicitly non-cacheable values", async () => {
    const cache = new BoundedQueryCache();
    const failure = vi.fn().mockRejectedValueOnce(new Error("offline"));
    await expect(cache.getOrLoad("retry", failure)).rejects.toThrow("offline");

    const retry = vi.fn().mockResolvedValue("online");
    await expect(cache.getOrLoad("retry", retry)).resolves.toBe("online");
    expect(retry).toHaveBeenCalledOnce();

    const missing = vi.fn().mockResolvedValue(null);
    await cache.getOrLoad("program:missing", missing, {
      shouldCache: (value) => value !== null,
    });
    await cache.getOrLoad("program:missing", missing, {
      shouldCache: (value) => value !== null,
    });
    expect(missing).toHaveBeenCalledTimes(2);
  });

  it("expires mutable data and retains immutable data", async () => {
    let time = 100;
    const cache = new BoundedQueryCache(4, 10, () => time);
    const mutable = vi.fn().mockResolvedValue("first");
    await cache.getOrLoad("calendar:month", mutable);
    time = 111;
    mutable.mockResolvedValue("second");
    await expect(cache.getOrLoad("calendar:month", mutable)).resolves.toBe(
      "second",
    );

    const immutable = vi.fn().mockResolvedValue("snapshot");
    await cache.getOrLoad("version:1", immutable, { ttlMs: Infinity });
    time = Number.MAX_SAFE_INTEGER;
    await expect(
      cache.getOrLoad("version:1", immutable, { ttlMs: Infinity }),
    ).resolves.toBe("snapshot");
    expect(immutable).toHaveBeenCalledOnce();
  });

  it("evicts least-recently-used entries and supports prefix invalidation", async () => {
    const cache = new BoundedQueryCache(2, Infinity);
    cache.set("program:1", 1);
    cache.set("program:2", 2);
    await cache.getOrLoad("program:1", async () => 10);
    cache.set("calendar:august", 3);

    expect(cache.peek("program:1")).toBe(1);
    expect(cache.peek("program:2")).toBeUndefined();
    cache.invalidate("program:");
    expect(cache.peek("program:1")).toBeUndefined();
    expect(cache.peek("calendar:august")).toBe(3);
  });

  it("evicts least-recently-used values when serialized byte weight overflows", async () => {
    const cache = new BoundedQueryCache(10, Infinity, Date.now, {
      maximumWeight: 12,
    });
    cache.set("oldest", "aaaa");
    cache.set("newer", "bbbb");
    expect(cache.totalWeight).toBe(12);

    await cache.getOrLoad("oldest", async () => "not loaded");
    cache.set("newest", "cccc");

    expect(cache.peek("oldest")).toBe("aaaa");
    expect(cache.peek("newer")).toBeUndefined();
    expect(cache.peek("newest")).toBe("cccc");
    expect(cache.totalWeight).toBe(12);
  });

  it("keeps weight accounting exact across replacement, deletion, invalidation, and clear", () => {
    const cache = new BoundedQueryCache(10, Infinity, Date.now, {
      maximumWeight: 100,
      measureWeight: (value) => String(value).length,
    });
    cache.set("program:1", "12345678");
    expect(cache.totalWeight).toBe(8);

    cache.set("program:1", "12");
    cache.set("program:2", "123");
    cache.set("calendar:august", "12345");
    expect(cache.size).toBe(3);
    expect(cache.totalWeight).toBe(10);

    cache.delete("program:2");
    expect(cache.totalWeight).toBe(7);
    cache.invalidate("program:");
    expect(cache.totalWeight).toBe(5);
    expect(cache.size).toBe(1);

    cache.clear();
    expect(cache.totalWeight).toBe(0);
    expect(cache.size).toBe(0);
  });

  it("does not evict useful entries for a value larger than the whole weight budget", () => {
    const cache = new BoundedQueryCache(10, Infinity, Date.now, {
      maximumWeight: 10,
      measureWeight: (value) => String(value).length,
    });
    cache.set("program:1", "1234");
    cache.set("program:2", "5678");
    cache.set("oversize", "12345678901");

    expect(cache.peek("program:1")).toBe("1234");
    expect(cache.peek("program:2")).toBe("5678");
    expect(cache.peek("oversize")).toBeUndefined();
    expect(cache.totalWeight).toBe(8);
  });
});
