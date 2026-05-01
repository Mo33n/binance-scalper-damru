import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../../../src/config/load.js";
import { appConfigSchema } from "../../../src/config/schema.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

describe("loadConfig", () => {
  const prev = { ...process.env };

  beforeEach(() => {
    process.env = { ...prev };
  });

  afterEach(() => {
    process.env = { ...prev };
  });

  it("loads minimal config via CONFIG_PATH", () => {
    process.env["TRADING_ENV"] = "testnet";
    process.env["CONFIG_PATH"] = resolve(
      __dirname,
      "../../../config/examples/minimal.json",
    );
    const cfg = loadConfig();
    expect(cfg.environment).toBe("testnet");
    expect(cfg.symbols).toContain("BTCUSDT");
    expect(cfg.configSchemaVersion).toBe("1");
    expect(cfg.quoting.repriceMinIntervalMs).toBe(250);
    expect(cfg.quoting.maxBookStalenessMs).toBe(3000);
    expect(cfg.reconciliationIntervalMs).toBe(60_000);
    expect(cfg.features.liveQuotingEnabled).toBe(false);
    expect(cfg.features.markoutFeedbackEnabled).toBe(false);
    expect(cfg.binance.restBaseUrl).toMatch(/^https:\/\//);
  });

  it("fails for invalid environment with clear key path", () => {
    process.env["CONFIG_PATH"] = resolve(
      __dirname,
      "../../../config/examples/invalid-environment.json",
    );
    expect(() => loadConfig()).toThrow(/environment/i);
  });

  it("fails for missing required risk field with clear key path", () => {
    process.env["CONFIG_PATH"] = resolve(
      __dirname,
      "../../../config/examples/invalid-missing-field.json",
    );
    expect(() => loadConfig()).toThrow(/risk/i);
  });

  it("applies env overrides over file", () => {
    process.env["CONFIG_PATH"] = resolve(
      __dirname,
      "../../../config/examples/minimal.json",
    );
    process.env["BINANCE_REST_BASE_URL"] = "https://testnet.binancefuture.com";
    const cfg = loadConfig();
    expect(cfg.binance.restBaseUrl).toBe("https://testnet.binancefuture.com");
  });

  it("rejects REST host that does not match environment", () => {
    process.env["TRADING_ENV"] = "testnet";
    process.env["CONFIG_PATH"] = resolve(
      __dirname,
      "../../../config/examples/minimal.json",
    );
    process.env["BINANCE_REST_BASE_URL"] = "https://fapi.binance.com";
    expect(() => loadConfig()).toThrow(/binance:/);
  });

  it("rejects credentialProfile mismatch", () => {
    process.env["CONFIG_PATH"] = resolve(
      __dirname,
      "../../../config/examples/invalid-credential-profile.json",
    );
    expect(() => loadConfig()).toThrow(/credentialProfile/i);
  });

  it("loads small-live example with strict hosts", () => {
    process.env["CONFIG_PATH"] = resolve(
      __dirname,
      "../../../config/examples/small-live.json",
    );
    const cfg = loadConfig();
    expect(cfg.environment).toBe("live");
    expect(cfg.risk.maxOpenNotionalQuote).toBe(150);
    expect(cfg.rollout.markoutPromotionWindowMs).toBe(86_400_000);
  });

  it("returns immutable config object", () => {
    process.env["CONFIG_PATH"] = resolve(
      __dirname,
      "../../../config/examples/minimal.json",
    );
    const cfg = loadConfig();
    expect(Object.isFrozen(cfg)).toBe(true);
    expect(() => {
      (cfg as { environment: string }).environment = "live";
    }).toThrow();
  });
});

describe("appConfigSchema", () => {
  it("rejects combinedDepthStream with useWorkerThreads", () => {
    const r = appConfigSchema.safeParse({
      configSchemaVersion: "1",
      environment: "testnet",
      binance: {
        restBaseUrl: "https://testnet.binancefuture.com",
        wsBaseUrl: "wss://stream.binancefuture.com/ws",
      },
      symbols: ["BTCUSDT"],
      risk: {
        sessionLossCapQuote: 100,
        maxOpenNotionalQuote: 1000,
        defaultMinSpreadTicks: 5,
        maxDesiredLeverage: 50,
        riskMaxLeverage: 20,
        vpinBucketVolume: 1,
        vpinBucketBasis: "base",
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
        deRiskMode: "passive_touch",
      },
      features: {
        liveQuotingEnabled: false,
        markoutFeedbackEnabled: false,
        reconciliationIntervalOverrideEnabled: false,
        preFundingFlattenEnabled: false,
        regimeFlagsEnabled: false,
        inventoryDeRiskEnabled: false,
        useWorkerThreads: true,
        combinedDepthStream: true,
      },
      quoting: { repriceMinIntervalMs: 250, maxBookStalenessMs: 3000 },
      credentials: {},
      perSymbolOverrides: [],
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown root configSchemaVersion", () => {
    const r = appConfigSchema.safeParse({
      configSchemaVersion: "2",
      environment: "testnet",
      binance: {
        restBaseUrl: "https://testnet.binancefuture.com",
        wsBaseUrl: "wss://stream.binancefuture.com/ws",
      },
      symbols: ["BTCUSDT"],
      risk: {
        sessionLossCapQuote: 100,
        maxOpenNotionalQuote: 1000,
        vpinBucketVolume: 1,
        vpinBucketBasis: "base",
        vpinEwmaN: 5,
        vpinStaleFlushMs: 60_000,
        vpinTau: 0.6,
        rvEnabled: false,
        rvTau: 0.0005,
      },
      features: {},
      credentials: {},
      perSymbolOverrides: [],
    });
    expect(r.success).toBe(false);
  });
});
