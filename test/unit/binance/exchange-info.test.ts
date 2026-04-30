import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSymbolBootstrap, parseSymbolSpec } from "../../../src/infrastructure/binance/exchange-info.js";

describe("exchange-info parser", () => {
  const fixture = JSON.parse(
    readFileSync(resolve("test/fixtures/binance/exchange-info.sample.json"), "utf8"),
  ) as {
    symbols: {
      symbol: string;
      status: string;
      contractType?: string;
      contractSize?: string;
      filters: { filterType: string; tickSize?: string; stepSize?: string; minNotional?: string }[];
    }[];
  };

  it("parses BTCUSDT SymbolSpec", () => {
    const raw = fixture.symbols.find((s) => s.symbol === "BTCUSDT");
    if (raw === undefined) throw new Error("fixture missing BTCUSDT");
    const spec = parseSymbolSpec(raw);
    expect(spec).toBeDefined();
    expect(spec?.tickSize).toBe(0.1);
    expect(spec?.stepSize).toBe(0.001);
    expect(spec?.minNotional).toBe(5);
  });

  it("builds accept/reject decisions", () => {
    const res = buildSymbolBootstrap(fixture, ["BTCUSDT", "ETHUSDT", "UNKNOWN"]);
    expect(res.accepted.map((s) => s.symbol)).toEqual(["BTCUSDT"]);
    expect(res.rejected.map((r) => r.reason)).toEqual(["NOT_TRADING", "NOT_LISTED"]);
  });
});
