/**
 * Sliding-window limiter keyed by an identifier (e.g. admin user id). In-memory and therefore
 * per server instance - good enough to stop accidental hammering of expensive admin actions;
 * a shared store (Redis/Postgres) would be needed for a hard global limit (see README).
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Records a hit and returns true if the key is still within its budget. */
  allow(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}
