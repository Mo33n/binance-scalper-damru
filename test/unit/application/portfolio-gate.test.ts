import { describe, it, expect } from "vitest";
import { PositionLedger } from "../../../src/application/services/position-ledger.js";
import {
  evaluateGlobalPortfolioGate,
  resolveBetaToRef,
} from "../../../src/application/services/portfolio-gate.js";
import type { SymbolSpec } from "../../../src/infrastructure/binance/types.js";

const lc = {
  maxAbsQty: 10,
  maxAbsNotional: 1_000_000,
  globalMaxAbsNotional: 1_000_000,
  inventoryEpsilon: 0,
  maxTimeAboveEpsilonMs: 60_000,
  riskLimitBreachLogCooldownMs: 60_000,
};

function spec(sym: string, cs = 1): SymbolSpec {
  return {
    symbol: sym,
    tickSize: 0.1,
    stepSize: 0.001,
    minNotional: 5,
    contractSize: cs,
    status: "TRADING",
  };
}

describe("evaluateGlobalPortfolioGate", () => {
  it("blocks when projected gross exceeds global cap (3 symbols)", () => {
    const ledger = new PositionLedger(lc);
    ledger.applyFill(
      { symbol: "A", orderId: 1, tradeId: 1, side: "BUY", quantity: 1, price: 100 },
      0,
    );
    ledger.applyFill(
      { symbol: "B", orderId: 2, tradeId: 2, side: "BUY", quantity: 1, price: 50 },
      0,
    );
    ledger.applyFill(
      { symbol: "C", orderId: 3, tradeId: 3, side: "SELL", quantity: 2, price: 25 },
      0,
    );

    const specs = new Map<string, SymbolSpec>([
      ["A", spec("A")],
      ["B", spec("B")],
      ["C", spec("C")],
    ]);

    const r = evaluateGlobalPortfolioGate({
      symbols: ["A", "B", "C"],
      ledger,
      marks: { A: 100, B: 50, C: 25 },
      specs,
      globalMaxAbsNotional: 240,
      quoteSymbol: "A",
      intentBid: { qty: 0.5, px: 100 },
      intentAsk: { qty: 0.5, px: 100 },
    });

    expect(r.currentGross).toBe(100 + 50 + 50);
    expect(r.projectedGross).toBeGreaterThan(r.cap);
    expect(r.ok).toBe(false);
  });

  it("allows when under cap", () => {
    const ledger = new PositionLedger(lc);
    const specs = new Map<string, SymbolSpec>([["BTCUSDT", spec("BTCUSDT")]]);
    const r = evaluateGlobalPortfolioGate({
      symbols: ["BTCUSDT"],
      ledger,
      marks: { BTCUSDT: 50_000 },
      specs,
      globalMaxAbsNotional: 1_000_000,
      quoteSymbol: "BTCUSDT",
      intentBid: { qty: 0.001, px: 50_000 },
      intentAsk: { qty: 0.001, px: 50_000 },
    });
    expect(r.ok).toBe(true);
  });

  it("betaPortfolio doubles exposure for β=2 vs raw gross", () => {
    const ledger = new PositionLedger(lc);
    ledger.applyFill(
      { symbol: "A", orderId: 1, tradeId: 1, side: "BUY", quantity: 1, price: 100 },
      0,
    );
    const specs = new Map<string, SymbolSpec>([["A", spec("A")]]);
    const raw = evaluateGlobalPortfolioGate({
      symbols: ["A"],
      ledger,
      marks: { A: 100 },
      specs,
      globalMaxAbsNotional: 500,
      quoteSymbol: "A",
    });
    const weighted = evaluateGlobalPortfolioGate({
      symbols: ["A"],
      ledger,
      marks: { A: 100 },
      specs,
      globalMaxAbsNotional: 500,
      quoteSymbol: "A",
      betaPortfolio: { enabled: true, betaToRef: { A: 2 } },
    });
    expect(raw.currentGross).toBe(100);
    expect(weighted.currentGross).toBe(200);
  });
});

describe("resolveBetaToRef", () => {
  it("defaults missing symbols to 1", () => {
    expect(resolveBetaToRef("X", { Y: 1.5 })).toBe(1);
    expect(resolveBetaToRef("Y", { Y: 1.5 })).toBe(1.5);
  });
});
