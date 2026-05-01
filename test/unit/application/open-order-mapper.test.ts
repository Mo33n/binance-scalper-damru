import { describe, it, expect } from "vitest";
import { mapBinanceOpenOrdersResponse } from "../../../src/application/services/open-order-mapper.js";

describe("mapBinanceOpenOrdersResponse", () => {
  it("maps LIMIT NEW rows with remaining qty", () => {
    const raw = [
      {
        orderId: 10,
        symbol: "BTCUSDT",
        price: "50000.0",
        origQty: "0.010",
        executedQty: "0.002",
        side: "BUY",
        status: "PARTIALLY_FILLED",
        type: "LIMIT",
      },
    ];
    const got = mapBinanceOpenOrdersResponse(raw);
    expect(got).toEqual([{ orderId: 10, side: "BUY", price: 50000, quantity: 0.008 }]);
  });

  it("ignores non-LIMIT and filled", () => {
    const raw = [
      { orderId: 1, side: "BUY", status: "FILLED", type: "LIMIT", price: "1", origQty: "1", executedQty: "1" },
      { orderId: 2, side: "SELL", status: "NEW", type: "MARKET", price: "1", origQty: "1", executedQty: "0" },
    ];
    expect(mapBinanceOpenOrdersResponse(raw)).toEqual([]);
  });

  it("non-array yields empty", () => {
    expect(mapBinanceOpenOrdersResponse({})).toEqual([]);
  });
});
