export interface TokenBucketConfig {
  readonly capacity: number;
  readonly refillPerSecond: number;
}

export class TokenBucket {
  private readonly cfg: TokenBucketConfig;
  private tokens: number;
  private lastRefillMs: number;
  private backoffUntilMs = 0;

  constructor(cfg: TokenBucketConfig, nowMs: number) {
    this.cfg = cfg;
    this.tokens = cfg.capacity;
    this.lastRefillMs = nowMs;
  }

  tryAcquire(weight: number, nowMs: number): boolean {
    this.refill(nowMs);
    if (nowMs < this.backoffUntilMs) return false;
    if (this.tokens < weight) return false;
    this.tokens -= weight;
    return true;
  }

  on429(nowMs: number, attempt: number): void {
    const delayMs = Math.min(60_000, 250 * 2 ** Math.max(0, attempt));
    this.backoffUntilMs = nowMs + delayMs;
  }

  getTokens(nowMs: number): number {
    this.refill(nowMs);
    return this.tokens;
  }

  getBackoffUntilMs(): number {
    return this.backoffUntilMs;
  }

  private refill(nowMs: number): void {
    const elapsedSec = Math.max(0, nowMs - this.lastRefillMs) / 1000;
    if (elapsedSec <= 0) return;
    this.tokens = Math.min(this.cfg.capacity, this.tokens + elapsedSec * this.cfg.refillPerSecond);
    this.lastRefillMs = nowMs;
  }
}
