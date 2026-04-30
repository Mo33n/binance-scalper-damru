import { describe, expect, it } from "vitest";
import { validateBinanceUrlsForEnvironment } from "../../../src/infrastructure/binance/constants.js";

describe("validateBinanceUrlsForEnvironment", () => {
  it("accepts default testnet pair", () => {
    expect(() => {
      validateBinanceUrlsForEnvironment(
        "testnet",
        "https://testnet.binancefuture.com",
        "wss://stream.binancefuture.com/ws",
      );
    }).not.toThrow();
  });

  it("rejects live REST host under testnet", () => {
    expect(() => {
      validateBinanceUrlsForEnvironment(
        "testnet",
        "https://fapi.binance.com",
        "wss://stream.binancefuture.com/ws",
      );
    }).toThrow(/not allowed for testnet/);
  });
});
