import { describe, it, expect } from "vitest";
import { VpinBuckets } from "../../../src/domain/signals/vpin-buckets.js";

describe("VpinBuckets", () => {
  it("closes buckets deterministically (base basis)", () => {
    const v = new VpinBuckets({
      targetBucketVolume: 10,
      basis: "base",
      ewmaN: 3,
      staleFlushMs: 1000,
    });
    const c1 = v.onTrade(
      { symbol: "BTCUSDT", tradeId: 1, price: 100, quantity: 4, side: "buy", eventTimeMs: 0 },
      1,
    );
    expect(c1).toBeUndefined();
    const c2 = v.onTrade(
      { symbol: "BTCUSDT", tradeId: 2, price: 100, quantity: 6, side: "sell", eventTimeMs: 0 },
      2,
    );
    expect(c2?.index).toBe(1);
    expect(c2?.buyVolume).toBe(4);
    expect(c2?.sellVolume).toBe(6);
  });

  it("quote basis closes faster when price high", () => {
    const base = new VpinBuckets({
      targetBucketVolume: 10,
      basis: "base",
      ewmaN: 3,
      staleFlushMs: 1000,
    });
    const quote = new VpinBuckets({
      targetBucketVolume: 1000,
      basis: "quote",
      ewmaN: 3,
      staleFlushMs: 1000,
    });
    const trade = {
      symbol: "BTCUSDT",
      tradeId: 1,
      price: 50_000,
      quantity: 0.03,
      side: "buy" as const,
      eventTimeMs: 0,
    };
    const closedBase = base.onTrade(trade, 1);
    const closedQuote = quote.onTrade(trade, 1);
    expect(closedBase).toBeUndefined();
    expect(closedQuote?.index).toBe(1);
  });

  it("flushes stale partial bucket", () => {
    const v = new VpinBuckets({
      targetBucketVolume: 100,
      basis: "base",
      ewmaN: 3,
      staleFlushMs: 10,
    });
    v.onTrade(
      { symbol: "BTCUSDT", tradeId: 1, price: 100, quantity: 1, side: "buy", eventTimeMs: 0 },
      0,
    );
    const flushed = v.flushIfStale(20);
    expect(flushed?.index).toBe(1);
    expect(v.getSnapshot().staleFlushCount).toBe(1);
  });

  it("computes bounded imbalance and ewma", () => {
    const v = new VpinBuckets({
      targetBucketVolume: 1,
      basis: "base",
      ewmaN: 2,
      staleFlushMs: 1000,
    });
    v.onTrade(
      { symbol: "BTCUSDT", tradeId: 1, price: 10, quantity: 1, side: "buy", eventTimeMs: 0 },
      0,
    );
    v.onTrade(
      { symbol: "BTCUSDT", tradeId: 2, price: 10, quantity: 1, side: "sell", eventTimeMs: 0 },
      1,
    );
    const s = v.getSnapshot();
    expect(s.lastImbalance).toBeGreaterThanOrEqual(0);
    expect(s.lastImbalance).toBeLessThanOrEqual(1);
    expect(s.toxicityScore).toBeGreaterThanOrEqual(0);
    expect(s.toxicityScore).toBeLessThanOrEqual(1);
  });
});
