import { describe, it, expect } from "vitest";
import { buildHybridQuoteIntent, classifyRegime, ticksBetween } from "../../../src/domain/quoting/hybrid-quoting.js";

describe("hybrid quoting", () => {
  it("normal regime keeps spread floor", () => {
    const intent = buildHybridQuoteIntent({
      touch: { bestBid: 100, bestAsk: 100.6 },
      toxicityScore: 0.1,
      toxicityTau: 0.6,
      rvRegime: "normal",
      minSpreadTicks: 5,
      tickSize: 0.1,
      inventoryMode: "normal",
      baseOrderQty: 1,
    });
    expect(intent.regime).toBe("normal");
    expect(intent.bidPx).toBeDefined();
    expect(intent.askPx).toBeDefined();
    if (intent.bidPx !== undefined && intent.askPx !== undefined) {
      expect(ticksBetween(intent.bidPx, intent.askPx, 0.1)).toBeGreaterThanOrEqual(5);
    }
  });

  it("toxic regime goes off-touch", () => {
    const intent = buildHybridQuoteIntent({
      touch: { bestBid: 100, bestAsk: 100.5 },
      toxicityScore: 0.9,
      toxicityTau: 0.6,
      rvRegime: "normal",
      minSpreadTicks: 5,
      tickSize: 0.1,
      inventoryMode: "normal",
      baseOrderQty: 1,
    });
    expect(intent.regime).toBe("toxic");
    expect(intent.bidPx).toBe(99.9);
    expect(intent.askPx).toBe(100.6);
  });

  it("inventory stress emits flatten-style quote intent", () => {
    const regime = classifyRegime({
      touch: { bestBid: 100, bestAsk: 100.5 },
      toxicityScore: 0.1,
      toxicityTau: 0.6,
      rvRegime: "normal",
      minSpreadTicks: 5,
      tickSize: 0.1,
      inventoryMode: "stress",
      baseOrderQty: 1,
    });
    expect(regime).toBe("inventory_stress");
  });
});
