import { describe, it, expect } from "vitest";
import { RepriceLoop } from "../../../src/application/services/reprice-loop.js";
import type { QuoteIntent } from "../../../src/domain/quoting/types.js";

const intent: QuoteIntent = {
  regime: "normal",
  bidPx: 100,
  askPx: 100.5,
  bidQty: 1,
  askQty: 1,
  postOnly: true,
  reduceOnly: false,
  reason: "test",
};

describe("RepriceLoop", () => {
  it("throttles frequent reprices", () => {
    const r = new RepriceLoop({
      minRepriceIntervalMs: 1000,
      moveCancelTicks: 3,
      staleBookThresholdMs: 2000,
      tickSize: 0.1,
    });
    r.onQuoted(intent, 0);
    const d = r.decide(undefined, intent, 100, 10);
    expect(d.action).toBe("skip");
    expect(r.getSuppressedCount()).toBe(1);
  });

  it("cancels all on stale book", () => {
    const r = new RepriceLoop({
      minRepriceIntervalMs: 0,
      moveCancelTicks: 3,
      staleBookThresholdMs: 100,
      tickSize: 0.1,
    });
    const d = r.decide(undefined, intent, 10, 200);
    expect(d.action).toBe("cancel_all");
  });

  it("cancels on large move before ack", () => {
    const r = new RepriceLoop({
      minRepriceIntervalMs: 0,
      moveCancelTicks: 2,
      staleBookThresholdMs: 10_000,
      tickSize: 0.1,
    });
    r.onQuoted(intent, 0);
    const d = r.decide(
      {
        symbol: "BTCUSDT",
        bids: [{ price: 99.7, qty: 1 }],
        asks: [{ price: 100.2, qty: 1 }],
        bestBid: { price: 99.7, qty: 1 },
        bestAsk: { price: 100.2, qty: 1 },
      },
      intent,
      5000,
      1,
    );
    expect(d.action).toBe("cancel_all");
  });
});
