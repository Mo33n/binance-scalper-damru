import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AppConfig } from "../../../src/config/schema.js";
import type { LoggerPort } from "../../../src/application/ports/logger-port.js";
import type { QuotingSnapshot } from "../../../src/application/ports/quoting.js";
import type { ExecutionService } from "../../../src/application/services/execution-service.js";
import { createInventoryReaderForMark } from "../../../src/application/services/inventory-reader-factory.js";
import { PositionLedger } from "../../../src/application/services/position-ledger.js";
import { QuotingOrchestrator } from "../../../src/application/services/quoting-orchestrator.js";
import type { EffectiveFees, SymbolSpec } from "../../../src/infrastructure/binance/types.js";

function buildLogger(
  debugFn: LoggerPort["debug"],
  infoFn: LoggerPort["info"],
  warnFn: LoggerPort["warn"],
): LoggerPort {
  const log: LoggerPort = {
    debug: debugFn,
    info: infoFn,
    warn: warnFn,
    error: vi.fn(),
    child(): LoggerPort {
      return log;
    },
  };
  return log;
}

const fees: EffectiveFees = Object.freeze({
  makerRate: 0.0002,
  takerRate: 0.0005,
  bnbDiscountEnabled: false,
  asOfIso: "2026-01-01T00:00:00.000Z",
});

const spec: SymbolSpec = {
  symbol: "BTCUSDT",
  tickSize: 0.1,
  stepSize: 0.001,
  minNotional: 5,
  contractSize: 1,
  contractType: "PERPETUAL",
  status: "TRADING",
};

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
  maxAbsQty: 1,
  maxAbsNotional: 10_000,
  globalMaxAbsNotional: 25_000,
  inventoryEpsilon: 0,
  maxTimeAboveEpsilonMs: 60_000,
  warnUtilization: 0.7,
  criticalUtilization: 0.85,
  haltUtilization: 0.95,
  preFundingFlattenMinutes: 0,
  deRiskMode: "passive_touch",
};

const testFeaturesLive: AppConfig["features"] = {
  liveQuotingEnabled: true,
  markoutFeedbackEnabled: false,
  reconciliationIntervalOverrideEnabled: false,
  preFundingFlattenEnabled: false,
  regimeFlagsEnabled: false,
  inventoryDeRiskEnabled: false,
  useWorkerThreads: false,
};

const testFeaturesOff: AppConfig["features"] = {
  ...testFeaturesLive,
  liveQuotingEnabled: false,
};

function toxicity(score: number) {
  return {
    bucketIndex: 0,
    lastImbalance: 0,
    toxicityScore: score,
    totalBuyVolume: 0,
    totalSellVolume: 0,
    staleFlushCount: 0,
  };
}

function makeTestLedger(): PositionLedger {
  return new PositionLedger({
    maxAbsQty: testRisk.maxAbsQty,
    maxAbsNotional: testRisk.maxAbsNotional,
    globalMaxAbsNotional: testRisk.globalMaxAbsNotional,
    inventoryEpsilon: testRisk.inventoryEpsilon,
    maxTimeAboveEpsilonMs: testRisk.maxTimeAboveEpsilonMs,
  });
}

describe("QuotingOrchestrator (SPEC-05)", () => {
  let log: LoggerPort;
  let debugMock: ReturnType<typeof vi.fn>;
  let infoMock: ReturnType<typeof vi.fn>;
  let warnMock: ReturnType<typeof vi.fn>;
  let getSnapshot: () => QuotingSnapshot;
  let positionLedger: PositionLedger;

  beforeEach(() => {
    positionLedger = makeTestLedger();
    debugMock = vi.fn();
    infoMock = vi.fn();
    warnMock = vi.fn();
    log = buildLogger(
      debugMock as unknown as LoggerPort["debug"],
      infoMock as unknown as LoggerPort["info"],
      warnMock as unknown as LoggerPort["warn"],
    );
    getSnapshot = () => ({
      readModel: {
        quotingPausedForBookResync: false,
        bestBidPx: 50_000,
        bestAskPx: 50_001,
      },
      stalenessMs: 0,
      toxicity: toxicity(0),
      rvRegime: "normal",
    });
  });

  function makeOrchestrator(
    overrides: Partial<{
      execution: ExecutionService | undefined;
      cfg: Pick<AppConfig, "risk" | "quoting" | "features">;
      getSnapshot: () => QuotingSnapshot;
      isHalted: () => boolean;
      positionLedger: PositionLedger;
    }> = {},
  ): QuotingOrchestrator {
    const cfg = overrides.cfg ?? {
      risk: testRisk,
      quoting: { repriceMinIntervalMs: 250, maxBookStalenessMs: 3000 },
      features: testFeaturesLive,
    };
    const ledger = overrides.positionLedger ?? positionLedger;
    return new QuotingOrchestrator({
      log,
      execution: overrides.execution,
      spec,
      fees,
      cfg,
      getSnapshot: overrides.getSnapshot ?? getSnapshot,
      isHalted: overrides.isHalted ?? (() => false),
      monotonicNowMs: () => 10_000,
      effectiveMinSpreadTicks: 5,
      positionLedger: ledger,
      createInventoryReader: (markPx, nowMs) =>
        createInventoryReaderForMark(ledger, spec.symbol, markPx, nowMs),
    });
  }

  it("T01: read_only — no trading REST", async () => {
    const orch = makeOrchestrator({ execution: undefined });
    await orch.tick();
    const skip = debugMock.mock.calls.find(
      (c) => (c[0] as { event?: string }).event === "quoting.skip",
    );
    expect(skip?.[0]).toMatchObject({ reason: "read_only" });
  });

  it("T02: stale book skips orders", async () => {
    const cancelAll = vi.fn(async () => {});
    const placeFromIntent = vi.fn(async () => {});
    const execution = { cancelAll, placeFromIntent } as unknown as ExecutionService;
    const orch = makeOrchestrator({
      execution,
      getSnapshot: () => ({
        readModel: {
          quotingPausedForBookResync: false,
          bestBidPx: 50_000,
          bestAskPx: 50_001,
        },
        stalenessMs: 999_999,
        toxicity: toxicity(0),
        rvRegime: "normal",
      }),
    });
    await orch.tick();
    expect(cancelAll).not.toHaveBeenCalled();
    expect(placeFromIntent).not.toHaveBeenCalled();
    const attention = infoMock.mock.calls.find(
      (c) => (c[0] as { event?: string }).event === "quoting.book_unavailable",
    );
    expect(attention?.[0]).toMatchObject({
      event: "quoting.book_unavailable",
      subReason: "staleness_exceeded",
      stalenessMs: 999_999,
    });
  });

  it("T03: unchanged intent — second tick does not hit REST", async () => {
    const cancelAll = vi.fn(async () => {});
    const placeFromIntent = vi.fn(async () => {});
    const execution = { cancelAll, placeFromIntent } as unknown as ExecutionService;
    const orch = makeOrchestrator({ execution });
    await orch.tick();
    await orch.tick();
    expect(cancelAll).toHaveBeenCalledTimes(1);
    expect(placeFromIntent).toHaveBeenCalledTimes(1);
  });

  it("T04: intent changes — cancelAll before placeFromIntent", async () => {
    const cancelAll = vi.fn(async () => {});
    const placeFromIntent = vi.fn(async () => {});
    const execution = {
      cancelAll,
      placeFromIntent,
    } as unknown as ExecutionService;
    let bid = 50_000;
    const orch = makeOrchestrator({
      execution,
      getSnapshot: () => ({
        readModel: {
          quotingPausedForBookResync: false,
          bestBidPx: bid,
          bestAskPx: 50_001,
        },
        stalenessMs: 0,
        toxicity: toxicity(0),
        rvRegime: "normal",
      }),
    });
    await orch.tick();
    bid = 49_900;
    await orch.tick();
    expect(cancelAll).toHaveBeenCalledTimes(2);
    expect(placeFromIntent).toHaveBeenCalledTimes(2);
    const c0 = cancelAll.mock.invocationCallOrder[1];
    const p1 = placeFromIntent.mock.invocationCallOrder[1];
    expect(c0).toBeDefined();
    expect(p1).toBeDefined();
    expect(c0 as number).toBeLessThan(p1 as number);
  });

  it("liveQuotingEnabled false skips trading path", async () => {
    const cancelAll = vi.fn(async () => {});
    const placeFromIntent = vi.fn(async () => {});
    const execution = { cancelAll, placeFromIntent } as unknown as ExecutionService;
    const orch = makeOrchestrator({
      execution,
      cfg: {
        risk: testRisk,
        quoting: { repriceMinIntervalMs: 250, maxBookStalenessMs: 3000 },
        features: testFeaturesOff,
      },
    });
    await orch.tick();
    expect(cancelAll).not.toHaveBeenCalled();
  });

  it("SPEC-06: pre-trade risk blocks place when bid would exceed maxAbsQty", async () => {
    const cancelAll = vi.fn(async () => {});
    const placeFromIntent = vi.fn(async () => {});
    const execution = { cancelAll, placeFromIntent } as unknown as ExecutionService;
    const ledger = new PositionLedger({
      maxAbsQty: 1,
      maxAbsNotional: 1_000_000,
      globalMaxAbsNotional: 1_000_000,
      inventoryEpsilon: testRisk.inventoryEpsilon,
      maxTimeAboveEpsilonMs: testRisk.maxTimeAboveEpsilonMs,
    });
    ledger.applyFill(
      {
        symbol: spec.symbol,
        orderId: 1,
        tradeId: 1,
        side: "BUY",
        quantity: 0.96,
        price: 50_000,
      },
      10_000,
    );
    const orch = makeOrchestrator({
      execution,
      positionLedger: ledger,
      cfg: {
        risk: { ...testRisk, maxAbsQty: 1, maxAbsNotional: 1_000_000, globalMaxAbsNotional: 1_000_000 },
        quoting: { repriceMinIntervalMs: 250, maxBookStalenessMs: 3000 },
        features: testFeaturesLive,
      },
    });
    await orch.tick();
    expect(placeFromIntent).not.toHaveBeenCalled();
    const skip = debugMock.mock.calls.find(
      (c) =>
        (c[0] as { event?: string; reason?: string }).event === "quoting.skip" &&
        (c[0] as { reason?: string }).reason === "pre_trade_risk",
    );
    expect(skip?.[0]).toMatchObject({ reason: "pre_trade_risk", detail: "bid_would_exceed_max_abs_qty" });
  });

  it("logs book_restored when book returns after stale skip", async () => {
    const cancelAll = vi.fn(async () => {});
    const placeFromIntent = vi.fn(async () => {});
    const execution = { cancelAll, placeFromIntent } as unknown as ExecutionService;
    let stale = true;
    const orch = makeOrchestrator({
      execution,
      getSnapshot: () => ({
        readModel: {
          quotingPausedForBookResync: false,
          bestBidPx: 50_000,
          bestAskPx: 50_001,
        },
        stalenessMs: stale ? 999_999 : 0,
        toxicity: toxicity(0),
        rvRegime: "normal",
      }),
    });
    await orch.tick();
    stale = false;
    await orch.tick();
    const restored = infoMock.mock.calls.find(
      (c) => (c[0] as { event?: string }).event === "quoting.book_restored",
    );
    expect(restored?.[0]).toMatchObject({ event: "quoting.book_restored" });
    expect(typeof (restored?.[0] as { unavailableDurationMs?: number }).unavailableDurationMs).toBe(
      "number",
    );
  });

  it("inventory de-risk: stressed long places reduce-only exit when feature enabled", async () => {
    const cancelAll = vi.fn(async () => {});
    const placeFromIntent = vi.fn(async () => {});
    const executeDeRisk = vi.fn(async () => {});
    const execution = { cancelAll, placeFromIntent, executeDeRisk } as unknown as ExecutionService;
    const ledger = new PositionLedger({
      maxAbsQty: 1,
      maxAbsNotional: 1_000_000,
      globalMaxAbsNotional: 1_000_000,
      inventoryEpsilon: testRisk.inventoryEpsilon,
      maxTimeAboveEpsilonMs: testRisk.maxTimeAboveEpsilonMs,
    });
    ledger.applyFill(
      {
        symbol: spec.symbol,
        orderId: 1,
        tradeId: 1,
        side: "BUY",
        quantity: 1.05,
        price: 50_000,
      },
      10_000,
    );
    const orch = makeOrchestrator({
      execution,
      positionLedger: ledger,
      cfg: {
        risk: { ...testRisk, maxAbsQty: 1, maxAbsNotional: 1_000_000, globalMaxAbsNotional: 1_000_000 },
        quoting: { repriceMinIntervalMs: 250, maxBookStalenessMs: 3000 },
        features: { ...testFeaturesLive, inventoryDeRiskEnabled: true },
      },
    });
    await orch.tick();
    expect(executeDeRisk).toHaveBeenCalledTimes(1);
    const deRiskCalls = executeDeRisk.mock.calls as unknown as Array<
      [unknown, { side: string; reduceOnly: boolean; mode: string }]
    >;
    expect(deRiskCalls[0]?.[1]).toMatchObject({
      side: "SELL",
      reduceOnly: true,
      mode: "passive_touch",
    });
    expect(placeFromIntent).not.toHaveBeenCalled();
    expect(cancelAll).toHaveBeenCalledTimes(1);
  });

  it("de_risk_mode off: suppressed warn and no cancel when feature enabled", async () => {
    const cancelAll = vi.fn(async () => {});
    const placeFromIntent = vi.fn(async () => {});
    const executeDeRisk = vi.fn(async () => {});
    const execution = { cancelAll, placeFromIntent, executeDeRisk } as unknown as ExecutionService;
    const ledger = new PositionLedger({
      maxAbsQty: 1,
      maxAbsNotional: 1_000_000,
      globalMaxAbsNotional: 1_000_000,
      inventoryEpsilon: testRisk.inventoryEpsilon,
      maxTimeAboveEpsilonMs: testRisk.maxTimeAboveEpsilonMs,
    });
    ledger.applyFill(
      {
        symbol: spec.symbol,
        orderId: 1,
        tradeId: 1,
        side: "BUY",
        quantity: 1.05,
        price: 50_000,
      },
      10_000,
    );
    const orch = makeOrchestrator({
      execution,
      positionLedger: ledger,
      cfg: {
        risk: { ...testRisk, maxAbsQty: 1, deRiskMode: "off" },
        quoting: { repriceMinIntervalMs: 250, maxBookStalenessMs: 3000 },
        features: { ...testFeaturesLive, inventoryDeRiskEnabled: true },
      },
    });
    await orch.tick();
    expect(cancelAll).not.toHaveBeenCalled();
    expect(executeDeRisk).not.toHaveBeenCalled();
    const w = warnMock.mock.calls.find(
      (c) => (c[0] as { event?: string }).event === "quoting.de_risk_suppressed",
    );
    expect(w?.[0]).toMatchObject({ event: "quoting.de_risk_suppressed" });
  });

  it("legacy: inventory stress with de-risk disabled logs empty intent and cancelAll", async () => {
    const cancelAll = vi.fn(async () => {});
    const placeFromIntent = vi.fn(async () => {});
    const executeDeRisk = vi.fn(async () => {});
    const execution = { cancelAll, placeFromIntent, executeDeRisk } as unknown as ExecutionService;
    const ledger = new PositionLedger({
      maxAbsQty: 1,
      maxAbsNotional: 1_000_000,
      globalMaxAbsNotional: 1_000_000,
      inventoryEpsilon: testRisk.inventoryEpsilon,
      maxTimeAboveEpsilonMs: testRisk.maxTimeAboveEpsilonMs,
    });
    ledger.applyFill(
      {
        symbol: spec.symbol,
        orderId: 1,
        tradeId: 1,
        side: "BUY",
        quantity: 1.05,
        price: 50_000,
      },
      10_000,
    );
    const orch = makeOrchestrator({
      execution,
      positionLedger: ledger,
      cfg: {
        risk: { ...testRisk, maxAbsQty: 1 },
        quoting: { repriceMinIntervalMs: 250, maxBookStalenessMs: 3000 },
        features: { ...testFeaturesLive, inventoryDeRiskEnabled: false },
      },
    });
    await orch.tick();
    expect(executeDeRisk).not.toHaveBeenCalled();
    expect(cancelAll).toHaveBeenCalledTimes(1);
    const w = warnMock.mock.calls.find(
      (c) => (c[0] as { event?: string }).event === "quoting.de_risk_intent_empty",
    );
    expect(w?.[0]).toMatchObject({ event: "quoting.de_risk_intent_empty", regime: "inventory_stress" });
  });
});
