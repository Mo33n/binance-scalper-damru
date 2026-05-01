import type { MarkoutTracker } from "./markout-tracker.js";

/** SPEC-09 — optional widening from rolling markout EWMA (`features.markoutFeedbackEnabled`). */
export interface MarkoutPolicy {
  widenSpreadTicks(): number;
}

export interface EwmaMarkoutPolicyConfig {
  readonly tickSize: number;
  /** Adverse EWMA threshold as multiples of `tickSize` (negative move vs fills). */
  readonly adverseEwmaTicks: number;
  readonly maxExtraTicks: number;
}

export class EwmaMarkoutPolicy implements MarkoutPolicy {
  constructor(
    private readonly tracker: MarkoutTracker,
    private readonly cfg: EwmaMarkoutPolicyConfig,
  ) {}

  widenSpreadTicks(): number {
    const ewma = this.tracker.getEwma();
    const threshold = -Math.abs(this.cfg.adverseEwmaTicks) * this.cfg.tickSize;
    if (ewma >= threshold) return 0;
    return Math.max(0, Math.floor(this.cfg.maxExtraTicks));
  }
}
