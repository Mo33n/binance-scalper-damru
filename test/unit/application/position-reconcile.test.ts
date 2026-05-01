import { describe, expect, it, vi } from "vitest";
import type { LoggerPort } from "../../../src/application/ports/logger-port.js";
import { PositionLedger } from "../../../src/application/services/position-ledger.js";
import { reconcileLedgerPositionsVsExchange } from "../../../src/application/services/position-reconcile.js";

function silentLog(): LoggerPort {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child(): LoggerPort {
      return silentLog();
    },
  };
}

describe("reconcileLedgerPositionsVsExchange (SPEC-06 T03)", () => {
  it("invokes quoting halt when exchange qty differs from ledger", async () => {
    const ledger = new PositionLedger({
      maxAbsQty: 10,
      maxAbsNotional: 1e9,
      globalMaxAbsNotional: 1e9,
      inventoryEpsilon: 0,
      maxTimeAboveEpsilonMs: 60_000,
      riskLimitBreachLogCooldownMs: 60_000,
    });
    ledger.applyFill(
      {
        symbol: "BTCUSDT",
        orderId: 1,
        tradeId: 1,
        side: "BUY",
        quantity: 0.2,
        price: 50_000,
      },
      1,
    );
    const requestQuotingHalt = vi.fn();
    await reconcileLedgerPositionsVsExchange({
      symbols: ["BTCUSDT"],
      ledger,
      fetchNetQty: () => Promise.resolve(0.5),
      log: silentLog(),
      requestQuotingHalt,
    });
    expect(requestQuotingHalt).toHaveBeenCalledWith("BTCUSDT");
  });

  it("X3: no halt when exchange matches REST-seeded ledger", async () => {
    const ledger = new PositionLedger({
      maxAbsQty: 10,
      maxAbsNotional: 1e9,
      globalMaxAbsNotional: 1e9,
      inventoryEpsilon: 0,
      maxTimeAboveEpsilonMs: 60_000,
      riskLimitBreachLogCooldownMs: 60_000,
    });
    ledger.seedPosition("BTCUSDT", 0.5, 1);
    const requestQuotingHalt = vi.fn();
    await reconcileLedgerPositionsVsExchange({
      symbols: ["BTCUSDT"],
      ledger,
      fetchNetQty: () => Promise.resolve(0.5),
      log: silentLog(),
      requestQuotingHalt,
    });
    expect(requestQuotingHalt).not.toHaveBeenCalled();
  });

  it("does not halt when quantities match", async () => {
    const ledger = new PositionLedger({
      maxAbsQty: 10,
      maxAbsNotional: 1e9,
      globalMaxAbsNotional: 1e9,
      inventoryEpsilon: 0,
      maxTimeAboveEpsilonMs: 60_000,
      riskLimitBreachLogCooldownMs: 60_000,
    });
    const requestQuotingHalt = vi.fn();
    await reconcileLedgerPositionsVsExchange({
      symbols: ["BTCUSDT"],
      ledger,
      fetchNetQty: () => Promise.resolve(0),
      log: silentLog(),
      requestQuotingHalt,
    });
    expect(requestQuotingHalt).not.toHaveBeenCalled();
  });
});
