import { describe, expect, it, vi } from "vitest";
import type { LoggerPort } from "../../../src/application/ports/logger-port.js";
import { PositionLedger } from "../../../src/application/services/position-ledger.js";
import type { FillEvent } from "../../../src/infrastructure/binance/user-stream.js";

function noopLog(): LoggerPort {
  const log: LoggerPort = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child(): LoggerPort {
      return log;
    },
  };
  return log;
}

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
  it("X3: seedPosition + applySeedMarks, then applyFill extends net", () => {
    const ledger = new PositionLedger({
      maxAbsQty: 10,
      maxAbsNotional: 1_000_000,
      globalMaxAbsNotional: 2_000_000,
      inventoryEpsilon: 0.2,
      maxTimeAboveEpsilonMs: 10_000,
      riskLimitBreachLogCooldownMs: 60_000,
    });
    ledger.seedPosition("BTCUSDT", 0.1, 1000);
    ledger.applySeedMarksForGlobalNotional(new Map([["BTCUSDT", 100_000]]));
    expect(ledger.getPosition("BTCUSDT").netQty).toBe(0.1);
    ledger.applyFill(fill({ quantity: 0.05, tradeId: 2 }), 2000);
    expect(ledger.getPosition("BTCUSDT").netQty).toBeCloseTo(0.15, 12);
  });

  it("dedupes fills and updates net quantity once", () => {
    const ledger = new PositionLedger({
      maxAbsQty: 10,
      maxAbsNotional: 1_000_000,
      globalMaxAbsNotional: 2_000_000,
      inventoryEpsilon: 0.2,
      maxTimeAboveEpsilonMs: 10_000,
      riskLimitBreachLogCooldownMs: 60_000,
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
      riskLimitBreachLogCooldownMs: 60_000,
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
      riskLimitBreachLogCooldownMs: 60_000,
    });
    ledger.applyFill(fill({ quantity: 0.1 }), 1000);
    expect(ledger.getStressLevel("BTCUSDT", 100_000, 1050)).toBe("none");
    expect(ledger.getStressLevel("BTCUSDT", 100_000, 1200)).toBe("breach");
  });

  it("rate-limits risk.limit_breach warns per metric key when cooldown > 0", () => {
    const warn = vi.fn();
    const log = noopLog();
    log.warn = warn;
    const ledger = new PositionLedger(
      {
        maxAbsQty: 10,
        maxAbsNotional: 2_000_000,
        globalMaxAbsNotional: 2_000_000,
        inventoryEpsilon: 0.05,
        maxTimeAboveEpsilonMs: 100,
        riskLimitBreachLogCooldownMs: 1000,
      },
      log,
    );
    ledger.applyFill(fill({ quantity: 0.1 }), 1000);
    ledger.getStressLevel("BTCUSDT", 100_000, 1200);
    ledger.getStressLevel("BTCUSDT", 100_000, 1500);
    expect(warn).toHaveBeenCalledTimes(1);
    ledger.getStressLevel("BTCUSDT", 100_000, 2300);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("with cooldown 0, emits risk.limit_breach on every stressed evaluation", () => {
    const warn = vi.fn();
    const log = noopLog();
    log.warn = warn;
    const ledger = new PositionLedger(
      {
        maxAbsQty: 10,
        maxAbsNotional: 2_000_000,
        globalMaxAbsNotional: 2_000_000,
        inventoryEpsilon: 0.05,
        maxTimeAboveEpsilonMs: 100,
        riskLimitBreachLogCooldownMs: 0,
      },
      log,
    );
    ledger.applyFill(fill({ quantity: 0.1 }), 1000);
    ledger.getStressLevel("BTCUSDT", 100_000, 1200);
    ledger.getStressLevel("BTCUSDT", 100_000, 1201);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
