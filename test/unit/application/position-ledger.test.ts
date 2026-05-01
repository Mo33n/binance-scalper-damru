import { describe, expect, it } from "vitest";
import { PositionLedger } from "../../../src/application/services/position-ledger.js";
import type { FillEvent } from "../../../src/infrastructure/binance/user-stream.js";

function fill(input: Partial<FillEvent> = {}): FillEvent {
  return {
    symbol: "BTCUSDT",
    orderId: 1,
    tradeId: 1,
    side: "BUY",
    quantity: 0.1,
    price: 100_000,
    ...input,
  };
}

describe("PositionLedger", () => {
  it("dedupes fills and updates net quantity once", () => {
    const ledger = new PositionLedger({
      maxAbsQty: 10,
      maxAbsNotional: 1_000_000,
      globalMaxAbsNotional: 2_000_000,
      inventoryEpsilon: 0.2,
      maxTimeAboveEpsilonMs: 10_000,
    });
    const f = fill();
    ledger.applyFill(f, 1000);
    ledger.applyFill(f, 1001);
    expect(ledger.getPosition("BTCUSDT").netQty).toBe(0.1);
  });

  it("returns breach on symbol notional/qty limits", () => {
    const ledger = new PositionLedger({
      maxAbsQty: 0.2,
      maxAbsNotional: 20_000,
      globalMaxAbsNotional: 2_000_000,
      inventoryEpsilon: 0.2,
      maxTimeAboveEpsilonMs: 10_000,
    });
    ledger.applyFill(fill({ quantity: 0.3 }), 1000);
    expect(ledger.getStressLevel("BTCUSDT", 100_000, 1001)).toBe("breach");
  });

  it("returns breach when time above epsilon exceeds threshold", () => {
    const ledger = new PositionLedger({
      maxAbsQty: 10,
      maxAbsNotional: 2_000_000,
      globalMaxAbsNotional: 2_000_000,
      inventoryEpsilon: 0.05,
      maxTimeAboveEpsilonMs: 100,
    });
    ledger.applyFill(fill({ quantity: 0.1 }), 1000);
    expect(ledger.getStressLevel("BTCUSDT", 100_000, 1050)).toBe("none");
    expect(ledger.getStressLevel("BTCUSDT", 100_000, 1200)).toBe("breach");
  });
});
