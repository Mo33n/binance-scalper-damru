import { describe, expect, it } from "vitest";
import { LossGuard } from "../../../src/application/services/loss-guard.js";

describe("LossGuard", () => {
  it("halts on session loss cap breach", () => {
    const g = new LossGuard({
      sessionLossCapQuote: 100,
      dailyLossCapQuote: 500,
      cooldownMs: 60_000,
      allowTradingAfterKill: false,
    });
    const state = g.evaluate({ sessionPnlQuote: -120, dailyPnlQuote: -120, nowMs: 0 });
    expect(state).toBe("halted");
  });

  it("enters and exits cooldown", () => {
    const g = new LossGuard({
      sessionLossCapQuote: 1000,
      dailyLossCapQuote: 1000,
      cooldownMs: 100,
      allowTradingAfterKill: false,
    });
    expect(g.triggerCooldown(0)).toBe("cooling_down");
    expect(g.evaluate({ sessionPnlQuote: 0, dailyPnlQuote: 0, nowMs: 50 })).toBe("cooling_down");
    expect(g.evaluate({ sessionPnlQuote: 0, dailyPnlQuote: 0, nowMs: 100 })).toBe("active");
  });
});
