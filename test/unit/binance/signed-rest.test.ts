import { describe, it, expect } from "vitest";
import { buildSignedQuery } from "../../../src/infrastructure/binance/signed-rest.js";

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
