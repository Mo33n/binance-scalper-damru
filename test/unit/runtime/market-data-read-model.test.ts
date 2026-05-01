import { describe, it, expect } from "vitest";
import { MarketDataReadModelStore } from "../../../src/runtime/worker/market-data-read-model.js";

describe("MarketDataReadModelStore", () => {
  it("clears quotingPaused after onBookApplied", () => {
    const s = new MarketDataReadModelStore();
    s.setQuotingPaused(true);
    expect(s.getReadModel().quotingPausedForBookResync).toBe(true);
    s.onBookApplied(
      {
        symbol: "BTCUSDT",
        bids: [],
        asks: [],
        bestBid: { price: 100, qty: 1 },
        bestAsk: { price: 100.1, qty: 1 },
        spreadTicks: 1,
      },
      5000,
    );
    const m = s.getReadModel();
    expect(m.quotingPausedForBookResync).toBe(false);
    expect(m.lastBookApplyMonotonicMs).toBe(5000);
    expect(m.lastMid).toBeCloseTo(100.05);
    expect(m.touchSpreadTicks).toBe(1);
    expect(m.bestBidPx).toBe(100);
    expect(m.bestAskPx).toBe(100.1);
    expect(m.bestBidQty).toBe(1);
    expect(m.bestAskQty).toBe(1);
  });
});
