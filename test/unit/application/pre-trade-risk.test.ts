import { describe, it, expect } from "vitest";
import type { AppConfig } from "../../../src/config/schema.js";
import { canPlaceQuoteIntent } from "../../../src/application/services/pre-trade-risk.js";
import { PositionLedger } from "../../../src/application/services/position-ledger.js";
import type { SymbolSpec } from "../../../src/infrastructure/binance/types.js";
import type { QuoteIntent } from "../../../src/domain/quoting/types.js";

const testRisk: AppConfig["risk"] = {
  sessionLossCapQuote: 100,
  maxOpenNotionalQuote: 1000,
  defaultMinSpreadTicks: 5,
  maxDesiredLeverage: 50,
  riskMaxLeverage: 20,
  vpinBucketVolume: 1,
  vpinBucketBasis: "base",
  vpinEwmaN: 5,
  vpinStaleFlushMs: 60_000,
  vpinTau: 0.99,
  rvEnabled: false,
  rvTau: 0.0005,
  maxAbsQty: 10,
  maxAbsNotional: 1000,
  globalMaxAbsNotional: 25_000,
  inventoryEpsilon: 0,
  maxTimeAboveEpsilonMs: 60_000,
  riskLimitBreachLogCooldownMs: 60_000,
  warnUtilization: 0.7,
  criticalUtilization: 0.85,
  haltUtilization: 0.95,
  preFundingFlattenMinutes: 0,
  deRiskMode: "passive_touch",
  deRiskProfitOnly: false,
  deRiskMinProfitTicks: 0,
};

const spec: SymbolSpec = {
  symbol: "BTCUSDT",
  tickSize: 0.1,
  stepSize: 0.001,
  minNotional: 5,
  contractSize: 1,
  status: "TRADING",
};

describe("canPlaceQuoteIntent", () => {
  it("uses effectiveMaxAbsNotional when provided (beta-scaled cap)", () => {
    const ledger = new PositionLedger({
      maxAbsQty: testRisk.maxAbsQty,
      maxAbsNotional: testRisk.maxAbsNotional,
      globalMaxAbsNotional: testRisk.globalMaxAbsNotional,
      inventoryEpsilon: testRisk.inventoryEpsilon,
      maxTimeAboveEpsilonMs: testRisk.maxTimeAboveEpsilonMs,
      riskLimitBreachLogCooldownMs: testRisk.riskLimitBreachLogCooldownMs,
    });
    const intent: QuoteIntent = {
      regime: "normal",
      bidPx: 50_000,
      bidQty: 0.02,
      postOnly: true,
      reduceOnly: false,
      reason: "t",
    };
    expect(canPlaceQuoteIntent({ intent, ledger, cfg: testRisk, spec }).ok).toBe(true);

    const blocked = canPlaceQuoteIntent({
      intent,
      ledger,
      cfg: testRisk,
      spec,
      effectiveMaxAbsNotional: 500,
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toBe("bid_exceeds_max_abs_notional");
  });
});
