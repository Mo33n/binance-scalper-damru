import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chooseLeverage } from "../../../src/infrastructure/binance/leverage.js";
import { evaluateSpreadFloor, tickValueQuoteAtPrice } from "../../../src/infrastructure/binance/spread-gate.js";
import type { EffectiveFees, SymbolSpec } from "../../../src/infrastructure/binance/types.js";

const symbol: SymbolSpec = {
  symbol: "BTCUSDT",
  status: "TRADING",
  tickSize: 0.1,
  stepSize: 0.001,
  minNotional: 5,
  contractSize: 1,
};

describe("leverage and spread gate", () => {
  it("chooses risk-capped leverage", () => {
    const fixtureBrackets = JSON.parse(
      readFileSync(resolve("test/fixtures/binance/leverage-brackets.sample.json"), "utf8"),
    ) as { brackets: { initialLeverage: number; notionalCap: number }[] }[];
    const brackets = fixtureBrackets[0]?.brackets ?? [];
    const chosen = chooseLeverage(50, 20, brackets, 10_000);
    expect(chosen).toBe(20);
  });

  it("computes tick value in quote", () => {
    expect(tickValueQuoteAtPrice(symbol, 50_000, 1)).toBe(0.1);
  });

  it("returns pass/adjust/exclude decisions", () => {
    const lowFees: EffectiveFees = {
      makerRate: 0.00001,
      takerRate: 0.00002,
      bnbDiscountEnabled: false,
      asOfIso: new Date().toISOString(),
    };
    const highFees: EffectiveFees = {
      makerRate: 0.002,
      takerRate: 0.003,
      bnbDiscountEnabled: false,
      asOfIso: new Date().toISOString(),
    };

    const pass = evaluateSpreadFloor(symbol, lowFees, 100, 5, 0);
    const adjust = evaluateSpreadFloor(symbol, highFees, 50_000, 5, 5);
    const exclude = evaluateSpreadFloor(symbol, highFees, 50_000, 1, 100);

    expect(pass.outcome).toBe("pass");
    expect(adjust.outcome === "adjustTicks" || adjust.outcome === "exclude").toBe(true);
    expect(exclude.outcome).toBe("exclude");
  });
});
