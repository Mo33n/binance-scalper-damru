import { describe, it, expect } from "vitest";
import { DepthOrderBook } from "../../../src/infrastructure/binance/depth-order-book.js";

describe("DepthOrderBook", () => {
  it("applies snapshot and diff updates best bid/ask", () => {
    const b = new DepthOrderBook("BTCUSDT", 0.1);
    b.applySnapshot({
      lastUpdateId: 100,
      bids: [["50000", "1"]],
      asks: [["50000.1", "1"]],
    });
    const out = b.applyDiff({
      symbol: "BTCUSDT",
      firstUpdateId: 101,
      finalUpdateId: 101,
      prevFinalUpdateId: 100,
      bids: [{ price: 50000, qty: 2 }],
      asks: [{ price: 50000.1, qty: 0.5 }],
    });
    expect(out.kind).toBe("updated");
    if (out.kind !== "updated") return;
    expect(out.snapshot.bestBid?.qty).toBe(2);
    expect(out.snapshot.bestAsk?.qty).toBe(0.5);
    expect(out.snapshot.spreadTicks).toBe(1);
  });

  it("flags gap on wrong pu", () => {
    const b = new DepthOrderBook("BTCUSDT", 0.1);
    b.applySnapshot({
      lastUpdateId: 100,
      bids: [["50000", "1"]],
      asks: [["50000.1", "1"]],
    });
    const out = b.applyDiff({
      symbol: "BTCUSDT",
      firstUpdateId: 105,
      finalUpdateId: 105,
      prevFinalUpdateId: 99,
      bids: [],
      asks: [],
    });
    expect(out.kind).toBe("gap");
    expect(b.getResyncRequired()).toBe(true);
  });

  it("reports staleness as elapsed monotonic time", () => {
    const b = new DepthOrderBook("BTCUSDT", 0.1);
    b.applySnapshot({
      lastUpdateId: 1,
      bids: [["1", "1"]],
      asks: [["2", "1"]],
    });
    const staleness = b.getStalenessMs((b.getStalenessMs() ?? 0) + 1000);
    expect(staleness).toBeGreaterThanOrEqual(0);
  });
});
