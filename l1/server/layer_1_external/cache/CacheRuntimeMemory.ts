/// <mls fileReference="_102034_/l1/server/layer_1_external/cache/CacheRuntimeMemory.ts" enhancement="_blank" />
export interface ICacheRuntime {
  get<TValue>(key: string): Promise<TValue | null>;
  set<TValue>(key: string, value: TValue, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
}

interface CacheEntry {
  value: unknown;
  expiresAtMs?: number;
}

export class CacheRuntimeMemory implements ICacheRuntime {
  private readonly values = new Map<string, CacheEntry>();

  public constructor(private readonly defaultTtlSeconds?: number) {}

  public async get<TValue>(key: string): Promise<TValue | null> {
    const entry = this.values.get(key);
    if (!entry) return null;
    if (entry.expiresAtMs !== undefined && entry.expiresAtMs <= Date.now()) {
      this.values.delete(key);
      return null;
    }
    return entry.value as TValue;
  }

  public async set<TValue>(key: string, value: TValue, ttlSeconds?: number): Promise<void> {
    const ttl = ttlSeconds ?? this.defaultTtlSeconds;
    const entry: CacheEntry = { value };
    if (ttl !== undefined && ttl > 0) {
      entry.expiresAtMs = Date.now() + ttl * 1000;
    }
    this.values.set(key, entry);
  }

  public async del(key: string): Promise<void> {
    this.values.delete(key);
  }
}
