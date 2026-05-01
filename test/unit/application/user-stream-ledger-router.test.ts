import { describe, expect, it } from "vitest";
import { PositionLedger } from "../../../src/application/services/position-ledger.js";
import { routeUserStreamJsonToLedgers } from "../../../src/application/services/user-stream-ledger-router.js";

describe("routeUserStreamJsonToLedgers (SPEC-06 T01)", () => {
  it("duplicate ORDER_TRADE_UPDATE fill leaves net unchanged", () => {
    const ledger = new PositionLedger({
      maxAbsQty: 10,
      maxAbsNotional: 1e9,
      globalMaxAbsNotional: 1e9,
      inventoryEpsilon: 0,
      maxTimeAboveEpsilonMs: 60_000,
    });
    const map = new Map([["BTCUSDT", ledger]]);
    const raw = {
      e: "ORDER_TRADE_UPDATE",
      o: {
        s: "BTCUSDT",
        i: 9,
        t: 42,
        S: "BUY",
        l: "0.1",
        L: "50000",
        X: "FILLED",
      },
    } as Record<string, unknown>;

    routeUserStreamJsonToLedgers(raw, map, 1000);
    routeUserStreamJsonToLedgers(raw, map, 1001);

    expect(ledger.getPosition("BTCUSDT").netQty).toBe(0.1);
  });
});
