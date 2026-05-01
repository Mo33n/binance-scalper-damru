import { describe, expect, it } from "vitest";
import type { AppConfig } from "../../../src/config/schema.js";
import type { SymbolSpec } from "../../../src/infrastructure/binance/types.js";
import {
  buildWorkerBootstrapPayload,
  parseWorkerBootstrapPayload,
  WORKER_BOOTSTRAP_V,
} from "../../../src/runtime/messaging/worker-bootstrap.js";

const spec: SymbolSpec = {
  symbol: "BTCUSDT",
  tickSize: 0.1,
  stepSize: 0.001,
  minNotional: 5,
  contractSize: 1,
  contractType: "PERPETUAL",
  status: "TRADING",
};

const minimalRisk = {
  sessionLossCapQuote: 100,
  maxOpenNotionalQuote: 1000,
  defaultMinSpreadTicks: 5,
  maxDesiredLeverage: 50,
  riskMaxLeverage: 20,
  vpinBucketVolume: 1,
  vpinBucketBasis: "base" as const,
  vpinEwmaN: 5,
  vpinStaleFlushMs: 60_000,
  vpinTau: 0.6,
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
};

describe("worker-bootstrap (SPEC-08)", () => {
  it("build + parse round-trip", () => {
    const sessionConfig = {
      binance: {
        restBaseUrl: "https://testnet.binancefuture.com",
        wsBaseUrl: "wss://stream.binancefuture.com/ws",
        feeRefreshIntervalMs: 86_400_000,
        feeSafetyBufferBps: 1,
      },
      risk: minimalRisk,
      quoting: { repriceMinIntervalMs: 250, maxBookStalenessMs: 3000 },
      features: {
        liveQuotingEnabled: false,
        markoutFeedbackEnabled: false,
        reconciliationIntervalOverrideEnabled: false,
        preFundingFlattenEnabled: false,
        regimeFlagsEnabled: false,
        inventoryDeRiskEnabled: false,
        useWorkerThreads: true,
      },
      heartbeatIntervalMs: 5000,
      logLevel: "info",
      environment: "testnet",
    } as unknown as AppConfig;

    const fees = {
      makerRate: 0.0002,
      takerRate: 0.0005,
      bnbDiscountEnabled: false,
      asOfIso: "2026-01-01T00:00:00.000Z",
    };
    const decisions = [{ symbol: "BTCUSDT", status: "accepted" as const, effectiveMinSpreadTicks: 5 }];

    const built = buildWorkerBootstrapPayload({
      workerId: "w-BTCUSDT",
      symbol: "BTCUSDT",
      spec,
      sessionConfig,
      fees,
      decisions,
    });

    expect(built.v).toBe(WORKER_BOOTSTRAP_V);

    const cloned = JSON.parse(JSON.stringify(built)) as unknown;
    const parsed = parseWorkerBootstrapPayload(cloned);
    expect(parsed.symbol).toBe("BTCUSDT");
    expect(parsed.spec.tickSize).toBe(0.1);
    expect(parsed.configSubset.features.useWorkerThreads).toBe(true);
  });

  it("rejects wrong version", () => {
    expect(() =>
      parseWorkerBootstrapPayload({
        v: 2,
        workerId: "x",
        symbol: "BTCUSDT",
        spec,
        configSubset: {
          binance: {
            restBaseUrl: "https://testnet.binancefuture.com",
            wsBaseUrl: "wss://stream.binancefuture.com/ws",
            feeRefreshIntervalMs: 86_400_000,
            feeSafetyBufferBps: 1,
          },
          risk: minimalRisk,
          quoting: { repriceMinIntervalMs: 250, maxBookStalenessMs: 3000 },
          features: {
            liveQuotingEnabled: false,
            markoutFeedbackEnabled: false,
            reconciliationIntervalOverrideEnabled: false,
            preFundingFlattenEnabled: false,
            regimeFlagsEnabled: false,
            inventoryDeRiskEnabled: false,
            useWorkerThreads: false,
          },
          heartbeatIntervalMs: 5000,
          logLevel: "info",
          environment: "testnet",
        },
        fees: {
          makerRate: 0,
          takerRate: 0,
          bnbDiscountEnabled: false,
          asOfIso: "",
        },
        decisions: [],
      }),
    ).toThrow(/worker_bootstrap_invalid/i);
  });
});
