import { describe, it, expect } from "vitest";
import type { DepthDiffEvent } from "../../../src/domain/market-data/types.js";
import { DepthOrderBook, orderDepthDiffsForBridge } from "../../../src/infrastructure/binance/depth-order-book.js";

describe("orderDepthDiffsForBridge", () => {
  const sym = "BTCUSDT";

  it("returns empty when pending is empty", () => {
    expect(orderDepthDiffsForBridge(100, [])).toEqual({ ok: true, events: [] });
  });

  it("finds bridge even when an invalid-ahead diff (U>L) was queued before the overlap diff", () => {
    const pending: DepthDiffEvent[] = [
      { symbol: sym, firstUpdateId: 110, finalUpdateId: 110, prevFinalUpdateId: 109, bids: [], asks: [] },
      { symbol: sym, firstUpdateId: 98, finalUpdateId: 102, prevFinalUpdateId: 97, bids: [], asks: [] },
    ];
    const r = orderDepthDiffsForBridge(100, pending);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Per Binance sync: discard buffered events before the first overlapping diff; the high-U packet is stale noise here.
    expect(r.events).toHaveLength(1);
    expect(r.events[0]?.finalUpdateId).toBe(102);
  });

  it("returns ok:false when no diff overlaps L", () => {
    const pending: DepthDiffEvent[] = [
      { symbol: sym, firstUpdateId: 110, finalUpdateId: 110, prevFinalUpdateId: 109, bids: [], asks: [] },
    ];
    expect(orderDepthDiffsForBridge(100, pending)).toEqual({ ok: false });
  });
});

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
      firstUpdateId: 100,
      finalUpdateId: 101,
      prevFinalUpdateId: 99,
      bids: [{ price: 50000, qty: 2 }],
      asks: [{ price: 50000.1, qty: 0.5 }],
    });
    expect(out.kind).toBe("updated");
    if (out.kind !== "updated") return;
    expect(out.snapshot.bestBid?.qty).toBe(2);
    expect(out.snapshot.bestAsk?.qty).toBe(0.5);
    expect(out.snapshot.spreadTicks).toBe(1);
  });

  it("accepts first diff overlapping snapshot even when pu !== snapshot id", () => {
    const b = new DepthOrderBook("BTCUSDT", 0.1);
    b.applySnapshot({
      lastUpdateId: 100,
      bids: [["50000", "1"]],
      asks: [["50000.1", "1"]],
    });
    const out = b.applyDiff({
      symbol: "BTCUSDT",
      firstUpdateId: 98,
      finalUpdateId: 102,
      prevFinalUpdateId: 97,
      bids: [{ price: 50000, qty: 3 }],
      asks: [],
    });
    expect(out.kind).toBe("updated");
    if (out.kind !== "updated") return;
    expect(out.snapshot.bestBid?.qty).toBe(3);
  });

  it("flags gap on wrong pu after bridge", () => {
    const b = new DepthOrderBook("BTCUSDT", 0.1);
    b.applySnapshot({
      lastUpdateId: 100,
      bids: [["50000", "1"]],
      asks: [["50000.1", "1"]],
    });
    b.applyDiff({
      symbol: "BTCUSDT",
      firstUpdateId: 99,
      finalUpdateId: 101,
      prevFinalUpdateId: 98,
      bids: [],
      asks: [],
    });
    const out = b.applyDiff({
      symbol: "BTCUSDT",
      firstUpdateId: 102,
      finalUpdateId: 102,
      prevFinalUpdateId: 99,
      bids: [],
      asks: [],
    });
    expect(out.kind).toBe("gap");
    if (out.kind === "gap") expect(out.reason).toBe("gap_sequence_break");
    expect(b.getResyncRequired()).toBe(true);
  });

  it("flags gap when first stream event does not overlap snapshot id", () => {
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
      prevFinalUpdateId: 104,
      bids: [],
      asks: [],
    });
    expect(out.kind).toBe("gap");
    if (out.kind === "gap") expect(out.reason).toBe("gap_first_stream_after_snapshot");
    expect(b.getResyncRequired()).toBe(true);
  });

  it("ignores duplicate final update id (stale u)", () => {
    const b = new DepthOrderBook("BTCUSDT", 0.1);
    b.applySnapshot({
      lastUpdateId: 100,
      bids: [["50000", "1"]],
      asks: [["50000.1", "1"]],
    });
    b.applyDiff({
      symbol: "BTCUSDT",
      firstUpdateId: 100,
      finalUpdateId: 101,
      prevFinalUpdateId: 99,
      bids: [],
      asks: [],
    });
    const out = b.applyDiff({
      symbol: "BTCUSDT",
      firstUpdateId: 101,
      finalUpdateId: 101,
      prevFinalUpdateId: 100,
      bids: [],
      asks: [],
    });
    expect(out.kind).toBe("ignored");
    if (out.kind === "ignored") expect(out.reason).toBe("ignored_stale_final_id");
  });

  it("ignores pre-bridge packets with final id below snapshot L", () => {
    const b = new DepthOrderBook("BTCUSDT", 0.1);
    b.applySnapshot({
      lastUpdateId: 100,
      bids: [["50000", "1"]],
      asks: [["50000.1", "1"]],
    });
    const out = b.applyDiff({
      symbol: "BTCUSDT",
      firstUpdateId: 95,
      finalUpdateId: 99,
      prevFinalUpdateId: 94,
      bids: [],
      asks: [],
    });
    expect(out.kind).toBe("ignored");
    if (out.kind === "ignored") expect(out.reason).toBe("ignored_pre_bridge");
  });

  it("uses injected clock for staleness (deterministic)", () => {
    let now = 10_000;
    const b = new DepthOrderBook("BTCUSDT", 0.1, { nowMs: () => now });
    b.applySnapshot({
      lastUpdateId: 1,
      bids: [["1", "1"]],
      asks: [["2", "1"]],
    });
    now = 11_500;
    expect(b.getStalenessMs()).toBe(1500);
  });
});
