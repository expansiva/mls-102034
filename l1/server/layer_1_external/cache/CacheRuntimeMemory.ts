/// <mls fileReference="_102034_/l1/server/layer_1_external/cache/CacheRuntimeMemory.ts" enhancement="_blank" />
export interface ICacheRuntime {
  get<TValue>(key: string): Promise<TValue | null>;
  set<TValue>(key: string, value: TValue): Promise<void>;
}

export class CacheRuntimeMemory implements ICacheRuntime {
  private readonly values = new Map<string, unknown>();

  public async get<TValue>(key: string): Promise<TValue | null> {
    return (this.values.get(key) as TValue | undefined) ?? null;
  }

  public async set<TValue>(key: string, value: TValue): Promise<void> {
    this.values.set(key, value);
  }
}
