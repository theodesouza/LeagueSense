export interface CacheEntry<T> {
  value: T
  fetchedAt: number
}

export interface CacheStore {
  get<T>(key: string): Promise<CacheEntry<T> | null>
  set<T>(key: string, value: T, fetchedAt: number): Promise<void>
  clear(prefix?: string): Promise<void>
}

/** Cache em memória (testes, modo demonstração). */
export class MemoryCache implements CacheStore {
  private readonly m = new Map<string, CacheEntry<unknown>>()
  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    return (this.m.get(key) as CacheEntry<T> | undefined) ?? null
  }
  async set<T>(key: string, value: T, fetchedAt: number): Promise<void> {
    this.m.set(key, { value, fetchedAt })
  }
  async clear(prefix = ''): Promise<void> {
    for (const k of [...this.m.keys()]) if (k.startsWith(prefix)) this.m.delete(k)
  }
}
