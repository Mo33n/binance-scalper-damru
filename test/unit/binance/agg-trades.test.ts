import { describe, it, expect } from "vitest";
import { parseAggTrade } from "../../../src/infrastructure/binance/agg-trades.js";

describe("parseAggTrade", () => {
  it("maps m=false to aggressive buy", () => {
    const t = parseAggTrade({
      E: 1,
      s: "BTCUSDT",
      a: 1,
      p: "50000",
      q: "0.1",
      m: false,
    });
    expect(t.side).toBe("buy");
  });

  it("maps m=true to aggressive sell", () => {
    const t = parseAggTrade({
      E: 2,
      s: "BTCUSDT",
      a: 2,
      p: "50000",
      q: "0.1",
      m: true,
    });
    expect(t.side).toBe("sell");
  });
});
