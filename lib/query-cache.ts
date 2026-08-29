export interface QueryCacheOptions<Value> {
  /** Cache lifetime after a successful load. Use Infinity for immutable data. */
  ttlMs?: number;
  /** Return false for values such as null authorization misses that must be retried. */
  shouldCache?: (value: Value) => boolean;
}

export interface QueryCacheCapacityOptions {
  /** Maximum combined value weight. Defaults to unbounded. */
  maximumWeight?: number;
  /** Values are measured as UTF-8 JSON bytes unless a custom measure is supplied. */
  measureWeight?: (value: unknown, key: string) => number;
}

interface QueryCacheEntry<Value> {
  value: Value;
  expiresAt: number;
  accessedAt: number;
  weight: number;
}

const utf8Encoder = new TextEncoder();

function serializedValueWeight(value: unknown) {
  try {
    const serialized = JSON.stringify(value);
    return utf8Encoder.encode(serialized ?? String(value)).byteLength;
  } catch {
    // Preserve the generic cache behavior for non-serializable values. A caller
    // that needs to bound them can provide a domain-specific weight measure.
    return 0;
  }
}

/**
 * A deliberately small cache for repository reads.
 *
 * It coalesces identical in-flight requests, keeps immutable program snapshots
 * bounded, and makes invalidation explicit. It is not a second application
 * state store; React remains responsible for currently displayed data.
 */
export class BoundedQueryCache {
  private readonly values = new Map<string, QueryCacheEntry<unknown>>();
  private readonly pending = new Map<string, Promise<unknown>>();
  private readonly maximumWeight: number;
  private readonly measureWeight: (value: unknown, key: string) => number;
  private currentWeight = 0;

  constructor(
    private readonly maximumEntries = 64,
    private readonly defaultTtlMs = 60_000,
    private readonly now: () => number = Date.now,
    capacity: QueryCacheCapacityOptions = {},
  ) {
    if (!Number.isInteger(maximumEntries) || maximumEntries < 1) {
      throw new Error("Query cache capacity must be a positive integer");
    }
    const maximumWeight = capacity.maximumWeight ?? Infinity;
    if (
      maximumWeight !== Infinity &&
      (!Number.isFinite(maximumWeight) || maximumWeight < 1)
    ) {
      throw new Error("Query cache weight must be a positive number");
    }
    this.maximumWeight = maximumWeight;
    this.measureWeight = capacity.measureWeight ?? serializedValueWeight;
  }

  get size() {
    return this.values.size;
  }

  get totalWeight() {
    return this.currentWeight;
  }

  async getOrLoad<Value>(
    key: string,
    load: () => Promise<Value>,
    options: QueryCacheOptions<Value> = {},
  ): Promise<Value> {
    const currentTime = this.now();
    const cached = this.values.get(key) as QueryCacheEntry<Value> | undefined;
    if (cached) {
      if (cached.expiresAt > currentTime) {
        cached.accessedAt = currentTime;
        // Refresh insertion order so eviction is true least-recently-used.
        this.values.delete(key);
        this.values.set(key, cached as QueryCacheEntry<unknown>);
        return cached.value;
      }
      this.removeValue(key);
    }

    const existing = this.pending.get(key) as Promise<Value> | undefined;
    if (existing) return existing;

    const pending = load();
    this.pending.set(key, pending as Promise<unknown>);
    try {
      const value = await pending;
      if (options.shouldCache?.(value) !== false) {
        const ttlMs = options.ttlMs ?? this.defaultTtlMs;
        this.storeValue(key, value, ttlMs);
      }
      return value;
    } finally {
      if (this.pending.get(key) === pending) this.pending.delete(key);
    }
  }

  peek<Value>(key: string): Value | undefined {
    const cached = this.values.get(key) as QueryCacheEntry<Value> | undefined;
    if (!cached) return undefined;
    if (cached.expiresAt <= this.now()) {
      this.removeValue(key);
      return undefined;
    }
    return cached.value;
  }

  set<Value>(
    key: string,
    value: Value,
    options: QueryCacheOptions<Value> = {},
  ) {
    if (options.shouldCache?.(value) === false) return;
    const ttlMs = options.ttlMs ?? this.defaultTtlMs;
    this.storeValue(key, value, ttlMs);
  }

  delete(key: string) {
    this.removeValue(key);
  }

  invalidate(prefix: string) {
    for (const key of this.values.keys()) {
      if (key.startsWith(prefix)) this.removeValue(key);
    }
  }

  clear() {
    this.values.clear();
    this.pending.clear();
    this.currentWeight = 0;
  }

  private evictOverflow() {
    while (
      this.values.size > this.maximumEntries ||
      this.currentWeight > this.maximumWeight
    ) {
      const oldestKey = this.values.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this.removeValue(oldestKey);
    }
  }

  private storeValue<Value>(key: string, value: Value, ttlMs: number) {
    const measuredWeight = this.measureWeight(value, key);
    const weight = Number.isFinite(measuredWeight)
      ? Math.max(0, measuredWeight)
      : Infinity;
    this.removeValue(key);
    // A single oversize response should not flush otherwise useful entries.
    if (weight > this.maximumWeight) return;

    this.values.set(key, {
      value,
      expiresAt:
        ttlMs === Infinity ? Infinity : this.now() + Math.max(0, ttlMs),
      accessedAt: this.now(),
      weight,
    });
    this.currentWeight += weight;
    this.evictOverflow();
  }

  private removeValue(key: string) {
    const cached = this.values.get(key);
    if (!cached) return;
    this.values.delete(key);
    this.currentWeight = Math.max(0, this.currentWeight - cached.weight);
  }
}
