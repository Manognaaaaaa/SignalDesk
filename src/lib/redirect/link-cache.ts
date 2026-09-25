/**
 * Tiny LRU cache with TTL for link lookups on the redirect hot path. Most redirects are served
 * without touching the database. Unknown slugs are cached briefly too, so random-slug scanning
 * cannot hammer the database.
 */
export type CachedLink = {
  id: string;
  slug: string;
  destination_url: string;
  purpose: "campaign" | "replay" | "loadtest";
};

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

const LINK_TTL_MS = 60_000;
const MISS_TTL_MS = 10_000;
export const linkCache = new LruTtlCache<CachedLink | null>(1000, LINK_TTL_MS);

/**
 * Looks up an ACTIVE link by slug via the cache, falling back to `fetcher` (the DB).
 * Returns null for unknown/inactive links. A DB error is not cached and is rethrown.
 */
export async function lookupLink(slug: string, fetcher: (slug: string) => Promise<CachedLink | null>): Promise<CachedLink | null> {
  const hit = linkCache.get(slug);
  if (hit !== undefined) return hit;
  const link = await fetcher(slug);
  linkCache.set(slug, link, link ? LINK_TTL_MS : MISS_TTL_MS);
  return link;
}
