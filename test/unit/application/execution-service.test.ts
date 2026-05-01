import { describe, it, expect } from "vitest";
import {
  ClientOrderIdGenerator,
  buildDeRiskOrderRequest,
  buildOrderRequests,
} from "../../../src/application/services/execution-service.js";
import type { DeRiskExitPlan } from "../../../src/domain/quoting/execution-directive.js";
import type { QuoteIntent } from "../../../src/domain/quoting/types.js";
import type { SymbolSpec } from "../../../src/infrastructure/binance/types.js";

const spec: SymbolSpec = {
  symbol: "BTCUSDT",
  status: "TRADING",
  tickSize: 0.1,
  stepSize: 0.001,
  minNotional: 5,
  contractSize: 1,
};

describe("ExecutionService helpers", () => {
  it("clientOrderId generator does not reuse ids in burst", () => {
    const g = new ClientOrderIdGenerator();
    const s = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) s.add(g.next("BTCUSDT"));
    expect(s.size).toBe(10_000);
  });

  it("builds and normalizes order requests from quote intent", () => {
    const g = new ClientOrderIdGenerator();
    const intent: QuoteIntent = {
      regime: "normal",
      bidPx: 100.11,
      bidQty: 0.1019,
      askPx: 100.67,
      askQty: 0.2077,
      postOnly: true,
      reduceOnly: false,
      reason: "test",
    };
    const reqs = buildOrderRequests(spec, intent, g);
    expect(reqs.length).toBe(2);
    expect(reqs[0]?.price).toBe(100.1);
    expect(reqs[0]?.quantity).toBe(0.101);
  });

  it("buildDeRiskOrderRequest sets IOC for ioc_touch mode", () => {
    const g = new ClientOrderIdGenerator();
    const exit: DeRiskExitPlan = {
      side: "SELL",
      quantity: 0.1,
      limitPrice: 100,
      mode: "ioc_touch",
      postOnly: false,
      reduceOnly: true,
      reason: "test",
    };
    const req = buildDeRiskOrderRequest(spec, exit, g);
    expect(req.limitTimeInForce).toBe("IOC");
    expect(req.postOnly).toBe(false);
  });
});
