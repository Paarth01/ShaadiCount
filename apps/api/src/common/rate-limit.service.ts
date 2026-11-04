import { Injectable } from '@nestjs/common';
import { tooMany } from './errors';

/**
 * In-memory sliding-window limiter. Sufficient for a single API instance; a multi-instance deployment must swap in a
 * shared store (documented in docs/architecture/scalability-and-reliability.md).
 */
@Injectable()
export class RateLimitService {
  private hits = new Map<string, number[]>();
  private sweeper: NodeJS.Timeout;
  constructor() {
    this.sweeper = setInterval(() => this.sweep(), 60_000);
    this.sweeper.unref();
  }
  /** Records a hit and throws 429 once `limit` is exceeded within `windowMs`. */
  hit(key: string, limit: number, windowMs = 60_000): void {
    const now = Date.now();
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (arr.length >= limit) {
      this.hits.set(key, arr);
      throw tooMany(Math.max(1, Math.ceil((windowMs - (now - arr[0])) / 1000)));
    }
    arr.push(now);
    this.hits.set(key, arr);
  }
  /** Count without recording (used for invalid-token budgets). */
  count(key: string, windowMs = 60_000): number {
    const now = Date.now();
    return (this.hits.get(key) ?? []).filter((t) => now - t < windowMs).length;
  }
  reset() {
    this.hits.clear();
  }
  private sweep() {
    const now = Date.now();
    for (const [k, v] of this.hits) {
      const f = v.filter((t) => now - t < 120_000);
      if (f.length) this.hits.set(k, f);
      else this.hits.delete(k);
    }
  }
}
