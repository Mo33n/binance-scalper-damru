import { describe, expect, it } from "vitest";
import { MarkoutTracker } from "../../../src/application/services/markout-tracker.js";

describe("MarkoutTracker", () => {
  it("fires horizons in order and computes signed markout", () => {
    const m = new MarkoutTracker([250, 1000], 10);
    m.onFill({
      fillId: "f1",
      symbol: "BTCUSDT",
      side: "BUY",
      fillPrice: 100,
      midAtFill: 100,
      fillAtMs: 0,
    });
    m.onMid("BTCUSDT", 101, 300);
    const s1 = m.collectDueSamples(300);
    expect(s1).toHaveLength(1);
    expect(s1[0]?.horizonMs).toBe(250);
    expect(s1[0]?.value).toBe(1);

    m.onMid("BTCUSDT", 102, 1200);
    const s2 = m.collectDueSamples(1200);
    expect(s2).toHaveLength(1);
    expect(s2[0]?.horizonMs).toBe(1000);
    expect(m.getPendingCount()).toBe(0);
  });

  it("tags samples with last liquidity regime state when set before fill", () => {
    const m = new MarkoutTracker([250], 10);
    m.noteLiquidityRegimeState("DEFENSIVE");
    m.onFill({
      fillId: "f-reg",
      symbol: "BTCUSDT",
      side: "SELL",
      fillPrice: 100,
      midAtFill: 100,
      fillAtMs: 0,
    });
    m.onMid("BTCUSDT", 99, 300);
    const samples = m.collectDueSamples(300);
    expect(samples).toHaveLength(1);
    expect(samples[0]?.liquidityRegimeState).toBe("DEFENSIVE");
  });
});
