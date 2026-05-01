import { describe, it, expect } from "vitest";
import {
  diffTargetVsWorking,
  quoteIntentToTargetBook,
  type OpenOrderView,
  type TargetBook,
} from "../../../src/domain/liquidity/target-book.js";
import type { QuoteIntent } from "../../../src/domain/quoting/types.js";

describe("target-book", () => {
  const leg = { postOnly: true, reduceOnly: false };

  it("quoteIntentToTargetBook maps bid/ask legs", () => {
    const intent: QuoteIntent = {
      regime: "normal",
      bidPx: 100,
      askPx: 101,
      bidQty: 0.1,
      askQty: 0.2,
      postOnly: true,
      reduceOnly: false,
      reason: "t",
    };
    const t = quoteIntentToTargetBook(intent);
    expect(t.bid).toEqual({ price: 100, quantity: 0.1, ...leg });
    expect(t.ask).toEqual({ price: 101, quantity: 0.2, ...leg });
  });

  it("diffTargetVsWorking — empty working places both legs", () => {
    const target: TargetBook = {
      bid: { price: 100, quantity: 0.1, ...leg },
      ask: { price: 101, quantity: 0.2, ...leg },
    };
    const plan = diffTargetVsWorking(target, []);
    expect(plan.cancelOrderIds).toEqual([]);
    expect(plan.placeLegs).toHaveLength(2);
    expect(plan.placeLegs[0]?.side).toBe("BUY");
    expect(plan.placeLegs[1]?.side).toBe("SELL");
  });

  it("diffTargetVsWorking — identical primary bid/ask yields no ops", () => {
    const target: TargetBook = {
      bid: { price: 100, quantity: 0.1, ...leg },
      ask: { price: 101, quantity: 0.2, ...leg },
    };
    const working: OpenOrderView[] = [
      { orderId: 1, side: "BUY", price: 100, quantity: 0.1 },
      { orderId: 2, side: "SELL", price: 101, quantity: 0.2 },
    ];
    const plan = diffTargetVsWorking(target, working);
    expect(plan.cancelOrderIds).toEqual([]);
    expect(plan.placeLegs).toHaveLength(0);
  });

  it("diffTargetVsWorking — price change cancels and replaces", () => {
    const target: TargetBook = {
      bid: { price: 99, quantity: 0.1, ...leg },
      ask: { price: 101, quantity: 0.2, ...leg },
    };
    const working: OpenOrderView[] = [
      { orderId: 1, side: "BUY", price: 100, quantity: 0.1 },
      { orderId: 2, side: "SELL", price: 101, quantity: 0.2 },
    ];
    const plan = diffTargetVsWorking(target, working);
    expect(plan.cancelOrderIds).toContain(1);
    expect(plan.placeLegs.some((p) => p.side === "BUY" && p.price === 99)).toBe(true);
    expect(plan.placeLegs.some((p) => p.side === "SELL")).toBe(false);
  });

  it("diffTargetVsWorking — extra same-side orders are cancelled", () => {
    const target: TargetBook = {
      bid: { price: 100, quantity: 0.1, ...leg },
    };
    const working: OpenOrderView[] = [
      { orderId: 1, side: "BUY", price: 100, quantity: 0.1 },
      { orderId: 9, side: "BUY", price: 99, quantity: 0.05 },
    ];
    const plan = diffTargetVsWorking(target, working);
    expect(plan.cancelOrderIds).toContain(9);
  });
});
