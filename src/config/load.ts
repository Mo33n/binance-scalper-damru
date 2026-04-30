import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { appConfigSchema, CONFIG_SCHEMA_VERSION, type AppConfig } from "./schema.js";
import {
  DEFAULT_LIVE_REST_BASE_URL,
  DEFAULT_LIVE_WS_BASE_URL,
  DEFAULT_TESTNET_REST_BASE_URL,
  DEFAULT_TESTNET_WS_BASE_URL,
  validateBinanceUrlsForEnvironment,
} from "../infrastructure/binance/constants.js";

const DEFAULTS_TESTNET = {
  restBaseUrl: DEFAULT_TESTNET_REST_BASE_URL,
  wsBaseUrl: DEFAULT_TESTNET_WS_BASE_URL,
} as const;

const DEFAULTS_LIVE = {
  restBaseUrl: DEFAULT_LIVE_REST_BASE_URL,
  wsBaseUrl: DEFAULT_LIVE_WS_BASE_URL,
} as const;

function tradingEnvFromProcess(): "testnet" | "live" {
  const v = process.env["TRADING_ENV"] ?? process.env["APP_ENV"] ?? "testnet";
  return v === "live" ? "live" : "testnet";
}

function parseJsonFile(path: string): unknown {
  const abs = resolve(path);
  const raw = readFileSync(abs, "utf8");
  return JSON.parse(raw) as unknown;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, val] of Object.entries(patch)) {
    if (val === undefined) continue;
    const existing = out[key];
    if (isRecord(existing) && isRecord(val) && key !== "symbols" && key !== "perSymbolOverrides") {
      out[key] = deepMerge(existing, val);
    } else {
      out[key] = val;
    }
  }
  return out;
}

function deepFreeze<T>(obj: T): T {
  if (obj !== null && typeof obj === "object") {
    for (const val of Object.values(obj as Record<string, unknown>)) {
      deepFreeze(val);
    }
    Object.freeze(obj);
  }
  return obj;
}

/** Merge order: defaults -> CONFIG_PATH file -> env overrides. */
export function loadConfig(): AppConfig {
  const envName = tradingEnvFromProcess();
  const defaults =
    envName === "live"
      ? { environment: "live" as const, binance: { ...DEFAULTS_LIVE } }
      : { environment: "testnet" as const, binance: { ...DEFAULTS_TESTNET } };

  let merged: Record<string, unknown> = {
    configSchemaVersion: CONFIG_SCHEMA_VERSION,
    environment: defaults.environment,
    logLevel: "info",
    binance: { ...defaults.binance },
    symbols: [],
    features: {},
    credentials: {},
    perSymbolOverrides: [],
  };

  const path = process.env["CONFIG_PATH"];
  if (path !== undefined && path.length > 0) {
    const fileJson = parseJsonFile(path);
    if (!isRecord(fileJson)) throw new Error(`CONFIG_PATH must point to JSON object: ${path}`);
    merged = deepMerge(merged, fileJson);
  }

  if (process.env["BINANCE_REST_BASE_URL"] !== undefined) {
    merged = deepMerge(merged, { binance: { restBaseUrl: process.env["BINANCE_REST_BASE_URL"] } });
  }
  if (process.env["BINANCE_WS_BASE_URL"] !== undefined) {
    merged = deepMerge(merged, { binance: { wsBaseUrl: process.env["BINANCE_WS_BASE_URL"] } });
  }
  if (process.env["BINANCE_API_KEY"] !== undefined) {
    merged = deepMerge(merged, { credentials: { apiKey: process.env["BINANCE_API_KEY"] } });
  }
  if (process.env["BINANCE_API_SECRET"] !== undefined) {
    merged = deepMerge(merged, { credentials: { apiSecret: process.env["BINANCE_API_SECRET"] } });
  }
  if (process.env["LOG_LEVEL"] !== undefined) {
    merged = deepMerge(merged, { logLevel: process.env["LOG_LEVEL"] });
  }

  const parsed = appConfigSchema.safeParse(merged);
  if (!parsed.success) {
    const msg = parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
    throw new Error(`Invalid configuration: ${msg}`);
  }
  validateBinanceUrlsForEnvironment(
    parsed.data.environment,
    parsed.data.binance.restBaseUrl,
    parsed.data.binance.wsBaseUrl,
  );
  return deepFreeze(parsed.data);
}

export const loadAppConfig = loadConfig;

export function describeConfigPublic(cfg: AppConfig): Record<string, unknown> {
  return {
    configSchemaVersion: cfg.configSchemaVersion,
    environment: cfg.environment,
    isTestnet: cfg.environment === "testnet",
    credentialProfile: cfg.credentialProfile ?? cfg.environment,
    logLevel: cfg.logLevel,
    binance: cfg.binance,
    symbols: cfg.symbols,
    risk: cfg.risk,
    features: cfg.features,
    rollout: cfg.rollout,
    hasApiKey: Boolean(cfg.credentials.apiKey),
    hasApiSecret: Boolean(cfg.credentials.apiSecret),
    heartbeatIntervalMs: cfg.heartbeatIntervalMs,
    heartbeatMissThreshold: cfg.heartbeatMissThreshold,
    perSymbolOverridesCount: cfg.perSymbolOverrides.length,
  };
}
