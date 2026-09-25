/**
 * Tiny LRU cache with a TTL. Used to cache LLM responses by prompt hash so an identical prompt
 * (same model, same prompt version) never costs a second call within an instance.
 */
type Entry<V> = { value: V; expires: number };

export class LruTtlCache<V> {
  private readonly map = new Map<string, Entry<V>>();
  constructor(
    private readonly max: number,
    private readonly ttlMs: number,
  ) {}

  /** Returns the cached value (refreshing its LRU position) or undefined if missing/expired. */
  get(key: string, now = Date.now()): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expires <= now) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }

  /** Stores a value, evicting the least recently used entry when full. */
  set(key: string, value: V, ttlMs = this.ttlMs, now = Date.now()): void {
    this.map.delete(key);
    this.map.set(key, { value, expires: now + ttlMs });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  clear(): void {
    this.map.clear();
  }
}
