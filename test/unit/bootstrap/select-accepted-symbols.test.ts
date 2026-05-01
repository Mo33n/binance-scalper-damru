import { describe, it, expect } from "vitest";
import type { BootstrapExchangeContext } from "../../../src/application/services/bootstrap-exchange.js";
import type { SymbolSpec } from "../../../src/infrastructure/binance/types.js";
import { selectAcceptedSymbolSpecs } from "../../../src/bootstrap/select-accepted-symbols.js";

describe("selectAcceptedSymbolSpecs", () => {
  it("filters to symbols that have an accepted decision", () => {
    const btc: SymbolSpec = {
      symbol: "BTCUSDT",
      tickSize: 0.1,
      stepSize: 0.001,
      minNotional: 5,
      contractSize: 1,
      contractType: "PERPETUAL",
      status: "TRADING",
    };
    const ctx: BootstrapExchangeContext = {
      symbols: [btc],
      fees: Object.freeze({
        makerRate: 0.0002,
        takerRate: 0.0005,
        bnbDiscountEnabled: false,
        asOfIso: "",
      }),
      decisions: Object.freeze([
        { symbol: "BTCUSDT", status: "accepted", effectiveMinSpreadTicks: 5 },
      ]),
    };
    expect(selectAcceptedSymbolSpecs(ctx)).toEqual([btc]);
  });

  it("excludes symbols that have no decision row", () => {
    const btc: SymbolSpec = {
      symbol: "BTCUSDT",
      tickSize: 0.1,
      stepSize: 0.001,
      minNotional: 5,
      contractSize: 1,
      contractType: "PERPETUAL",
      status: "TRADING",
    };
    const ctx: BootstrapExchangeContext = {
      symbols: [btc],
      fees: Object.freeze({
        makerRate: 0.0002,
        takerRate: 0.0005,
        bnbDiscountEnabled: false,
        asOfIso: "",
      }),
      decisions: Object.freeze([]),
    };
    expect(selectAcceptedSymbolSpecs(ctx)).toEqual([]);
  });

  it("returns empty when no accepted decisions match", () => {
    const ctx: BootstrapExchangeContext = {
      symbols: [],
      fees: Object.freeze({
        makerRate: 0.0002,
        takerRate: 0.0005,
        bnbDiscountEnabled: false,
        asOfIso: "",
      }),
      decisions: Object.freeze([{ symbol: "ETHUSDT", status: "rejected", reason: "x" }]),
    };
    expect(selectAcceptedSymbolSpecs(ctx)).toEqual([]);
  });
});
