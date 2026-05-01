import { describe, expect, it } from "vitest";
import {
  binanceCombinedDepthStreamPath,
  binanceFuturesWsStreamOrigin,
  validateBinanceUrlsForEnvironment,
} from "../../../src/infrastructure/binance/constants.js";

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

  it("strips /ws for combined-stream origin", () => {
    expect(binanceFuturesWsStreamOrigin("wss://fstream.binance.com/ws")).toBe("wss://fstream.binance.com");
  });

  it("builds stable combined depth path", () => {
    expect(
      binanceCombinedDepthStreamPath([{ symbol: "ETHUSDT" }, { symbol: "BTCUSDT" }]),
    ).toBe("/stream?streams=btcusdt@depth/ethusdt@depth");
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
