import { describe, it, expect } from "vitest";
import { parseUserStreamEvent, UserStreamDeduper } from "../../../src/infrastructure/binance/user-stream.js";

describe("user-stream parser and dedupe", () => {
  it("parses fill from ORDER_TRADE_UPDATE", () => {
    const out = parseUserStreamEvent({
      e: "ORDER_TRADE_UPDATE",
      o: {
        s: "BTCUSDT",
        i: 1,
        t: 2,
        S: "BUY",
        X: "FILLED",
        l: "0.01",
        L: "50000",
        c: "cid-1",
      },
    });
    expect(out?.kind).toBe("fill");
  });

  it("deduper rejects duplicate fill", () => {
    const d = new UserStreamDeduper();
    const fill = { symbol: "BTCUSDT", orderId: 1, tradeId: 2, side: "BUY" as const, quantity: 1, price: 1 };
    expect(d.acceptFill(fill)).toBe(true);
    expect(d.acceptFill(fill)).toBe(false);
  });

  it("parses account update event", () => {
    const out = parseUserStreamEvent({
      e: "ACCOUNT_UPDATE",
      a: { wb: "100.1", up: "-1.2" },
    });
    expect(out?.kind).toBe("account");
  });
});
