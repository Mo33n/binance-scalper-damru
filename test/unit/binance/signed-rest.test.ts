import { describe, it, expect } from "vitest";
import { BinanceRestError } from "../../../src/infrastructure/binance/rest-client.js";
import { buildSignedQuery } from "../../../src/infrastructure/binance/signed-rest.js";
import { mapBinanceOrderError, normalizeOrderRequest } from "../../../src/infrastructure/binance/signed-rest-orders.js";
import type { SymbolSpec } from "../../../src/infrastructure/binance/types.js";

describe("buildSignedQuery", () => {
  it("adds signature and keeps payload fields", () => {
    const out = buildSignedQuery(
      { symbol: "BTCUSDT", timestamp: 1 },
      { apiKey: "k", apiSecret: "s" },
    );
    expect(out).toContain("symbol=BTCUSDT");
    expect(out).toContain("timestamp=1");
    expect(out).toMatch(/signature=[0-9a-f]{64}$/);
  });
});

describe("mapBinanceOrderError", () => {
  it("includes Binance code, msg, http status, and body snippet", () => {
    const body = JSON.stringify({ code: -2019, msg: "Margin is insufficient." });
    const err = new BinanceRestError("fail", 400, body);
    const m = mapBinanceOrderError(err);
    expect(m.action).toBe("Fatal");
    expect(m.code).toBe(-2019);
    expect(m.httpStatus).toBe(400);
    expect(m.binanceMsg).toBe("Margin is insufficient.");
    expect(m.bodySnippet).toBe(body);
  });

  it("maps unknown Binance code to ReconcileRequired with fields", () => {
    const body = JSON.stringify({ code: -5022, msg: "Post Only order will be rejected." });
    const err = new BinanceRestError("fail", 400, body);
    const m = mapBinanceOrderError(err);
    expect(m.action).toBe("ReconcileRequired");
    expect(m.code).toBe(-5022);
    expect(m.binanceMsg).toContain("Post Only");
  });

  it("maps generic Error to detail", () => {
    const m = mapBinanceOrderError(new Error("notional too low"));
    expect(m.action).toBe("ReconcileRequired");
    expect(m.detail).toBe("notional too low");
  });
});

describe("normalizeOrderRequest", () => {
  const trxLike: SymbolSpec = {
    symbol: "TRXUSDT",
    status: "TRADING",
    tickSize: 0.00001,
    stepSize: 1,
    minNotional: 5,
    contractSize: 1,
    contractType: "PERPETUAL",
  };

  it("bumps non-reduce qty to step-aligned minimum that clears MIN_NOTIONAL", () => {
    const out = normalizeOrderRequest(
      {
        symbol: "TRXUSDT",
        side: "BUY",
        price: 0.32581,
        quantity: 5,
        postOnly: true,
        reduceOnly: false,
        clientOrderId: "t",
      },
      trxLike,
    );
    expect(out.quantity).toBeGreaterThanOrEqual(16);
    expect(out.price * out.quantity).toBeGreaterThanOrEqual(5 - 1e-9);
  });

  it("does not bump reduce-only dust (caller must avoid tiny exits)", () => {
    expect(() =>
      normalizeOrderRequest(
        {
          symbol: "TRXUSDT",
          side: "BUY",
          price: 0.32581,
          quantity: 5,
          postOnly: false,
          reduceOnly: true,
          clientOrderId: "t",
        },
        trxLike,
      ),
    ).toThrow(/below minNotional/);
  });
});
