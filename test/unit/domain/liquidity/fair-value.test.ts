import { describe, it, expect } from "vitest";
import {
  buildFairValueQuote,
  computeMicroprice,
  computeTouchMid,
} from "../../../../src/domain/liquidity/fair-value.js";

describe("fair-value", () => {
  it("computeTouchMid is mid of touch", () => {
    expect(computeTouchMid({ bestBid: 100, bestAsk: 100.2 })).toBeCloseTo(100.1, 10);
  });

  it("computeMicroprice equals touch mid when symmetric size", () => {
    const m = computeMicroprice(
      { price: 100, qty: 5 },
      { price: 100.2, qty: 5 },
    );
    expect(m).toBeCloseTo(computeTouchMid({ bestBid: 100, bestAsk: 100.2 }), 10);
  });

  it("microprice with asymmetric sizes differs from touch mid", () => {
    const m = computeMicroprice(
      { price: 100, qty: 10 },
      { price: 102, qty: 1 },
    );
    const touch = computeTouchMid({ bestBid: 100, bestAsk: 102 });
    expect(m).not.toBeCloseTo(touch, 4);
  });

  it("buildFairValueQuote falls back when qty invalid", () => {
    const q = buildFairValueQuote({
      mode: "microprice",
      touch: { bestBid: 50_000, bestAsk: 50_002 },
    });
    expect(q.anchorMid).toBeCloseTo(50_001, 5);
  });
});
