import { describe, it, expect, vi, beforeEach } from "vitest";
import { ExecutionService } from "../../../src/application/services/execution-service.js";
import type { QuoteIntent } from "../../../src/domain/quoting/types.js";
import type { SymbolSpec } from "../../../src/infrastructure/binance/types.js";
import type { BinanceRestClient } from "../../../src/infrastructure/binance/rest-client.js";

vi.mock("../../../src/infrastructure/binance/signed-rest-orders.js", async () => {
  const actual = await vi.importActual<typeof import("../../../src/infrastructure/binance/signed-rest-orders.js")>(
    "../../../src/infrastructure/binance/signed-rest-orders.js",
  );
  return {
    ...actual,
    placeOrder: vi.fn(),
    cancelOrder: vi.fn(),
  };
});

import * as signedRest from "../../../src/infrastructure/binance/signed-rest-orders.js";

const spec: SymbolSpec = {
  symbol: "BTCUSDT",
  tickSize: 0.1,
  stepSize: 0.001,
  minNotional: 5,
  contractSize: 1,
  status: "TRADING",
};

describe("ExecutionService two-leg safety", () => {
  beforeEach(() => {
    vi.mocked(signedRest.placeOrder).mockReset();
    vi.mocked(signedRest.cancelOrder).mockReset();
  });

  it("rolls back first leg when second placeOrder fails", async () => {
    vi.mocked(signedRest.placeOrder)
      .mockResolvedValueOnce({
        symbol: "BTCUSDT",
        orderId: 777,
        clientOrderId: "a",
        status: "NEW",
      })
      .mockRejectedValueOnce(new Error("boom"));

    const exec = new ExecutionService({} as BinanceRestClient, { apiKey: "k", apiSecret: "s" }, undefined, {
      twoLegSafetyEnabled: true,
    });

    const intent: QuoteIntent = {
      regime: "normal",
      bidPx: 50_000,
      askPx: 50_001,
      bidQty: 0.002,
      askQty: 0.001,
      postOnly: true,
      reduceOnly: false,
      reason: "test",
    };

    await exec.placeFromIntent(spec, intent);

    expect(signedRest.placeOrder).toHaveBeenCalledTimes(2);
    expect(signedRest.cancelOrder).toHaveBeenCalledTimes(1);
    expect(signedRest.cancelOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "BTCUSDT",
      777,
    );
  });
});
