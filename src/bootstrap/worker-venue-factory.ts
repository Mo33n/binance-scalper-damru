import type { AppConfig } from "../config/schema.js";
import type { LoggerPort } from "../application/ports/logger-port.js";
import { ExecutionService } from "../application/services/execution-service.js";
import type { BinanceRestClient } from "../infrastructure/binance/rest-client.js";

/**
 * SPEC-08 — execution in worker threads uses env credentials only (no secrets in postMessage).
 */
export function createWorkerExecutionService(
  features: AppConfig["features"],
  quoting: AppConfig["quoting"],
  rest: BinanceRestClient,
  log: LoggerPort,
): ExecutionService | undefined {
  const key = process.env["BINANCE_API_KEY"];
  const secret = process.env["BINANCE_API_SECRET"];
  const dryRun = process.argv.includes("--dry-run");
  if (!key || !secret || dryRun || !features.liveQuotingEnabled) return undefined;
  return new ExecutionService(rest, { apiKey: key, apiSecret: secret }, undefined, {
    log,
    twoLegSafetyEnabled: quoting.liquidityEngine?.twoLegSafety.enabled === true,
  });
}
