export interface LossGuardConfig {
  readonly sessionLossCapQuote: number;
  readonly dailyLossCapQuote: number;
  readonly cooldownMs: number;
  readonly allowTradingAfterKill: boolean;
}

export type LossGuardState = "active" | "halted" | "cooling_down";

export class LossGuard {
  private readonly cfg: LossGuardConfig;
  private state: LossGuardState = "active";
  private cooldownUntilMs = 0;

  constructor(cfg: LossGuardConfig) {
    this.cfg = cfg;
  }

  evaluate(input: { sessionPnlQuote: number; dailyPnlQuote: number; nowMs: number }): LossGuardState {
    if (this.state === "halted" && this.cfg.allowTradingAfterKill) {
      this.state = "active";
    }
    if (this.state === "cooling_down" && input.nowMs >= this.cooldownUntilMs) {
      this.state = "active";
    }
    if (input.sessionPnlQuote <= -Math.abs(this.cfg.sessionLossCapQuote)) {
      this.state = "halted";
      return this.state;
    }
    if (input.dailyPnlQuote <= -Math.abs(this.cfg.dailyLossCapQuote)) {
      this.state = "halted";
      return this.state;
    }
    return this.state;
  }

  triggerCooldown(nowMs: number): LossGuardState {
    this.cooldownUntilMs = nowMs + this.cfg.cooldownMs;
    this.state = "cooling_down";
    return this.state;
  }
}
