import type { AppConfig } from "../config/schema.js";
import type { LoggerPort } from "../application/ports/logger-port.js";
import { createRateLimitedBinanceRestClient } from "../application/services/rate-limited-binance-rest-client.js";
import { monotonicNowMs } from "../shared/monotonic.js";
import { ExecutionService } from "../application/services/execution-service.js";
import type { TradingModeReason, TradingVenueHandles } from "./venue-types.js";

export const TRADING_MODE_EVENT = "trading.mode" as const;

export function createTradingVenueHandles(input: {
  readonly cfg: AppConfig;
  readonly log: LoggerPort;
  readonly argv: readonly string[];
}): TradingVenueHandles {
  const rest = createRateLimitedBinanceRestClient(
    { baseUrl: input.cfg.binance.restBaseUrl, log: input.log },
    () => monotonicNowMs(),
  );

  const hasCreds = Boolean(input.cfg.credentials.apiKey && input.cfg.credentials.apiSecret);
  const dryRun = input.argv.includes("--dry-run");
  const reasons: TradingModeReason[] = [];

  if (!hasCreds) {
    reasons.push("no_credentials");
    input.log.info(
      { event: TRADING_MODE_EVENT, mode: "read_only" as const, reasons: [...reasons] },
      "trading.mode.selected",
    );
    return { rest, execution: undefined, mode: "read_only", modeReasons: reasons };
  }

  if (dryRun) {
    reasons.push("dry_run");
    input.log.info(
      { event: TRADING_MODE_EVENT, mode: "read_only" as const, reasons: [...reasons] },
      "trading.mode.selected",
    );
    return { rest, execution: undefined, mode: "read_only", modeReasons: reasons };
  }

  if (!input.cfg.features.liveQuotingEnabled) {
    reasons.push("live_quoting_disabled");
    input.log.info(
      { event: TRADING_MODE_EVENT, mode: "read_only" as const, reasons: [...reasons] },
      "trading.mode.selected",
    );
    return { rest, execution: undefined, mode: "read_only", modeReasons: reasons };
  }

  const apiKey = input.cfg.credentials.apiKey;
  const apiSecret = input.cfg.credentials.apiSecret;
  if (!apiKey || !apiSecret) {
    reasons.push("no_credentials");
    input.log.info(
      { event: TRADING_MODE_EVENT, mode: "read_only" as const, reasons: [...reasons] },
      "trading.mode.selected",
    );
    return { rest, execution: undefined, mode: "read_only", modeReasons: reasons };
  }

  reasons.push("ready");
  const execution = new ExecutionService(rest, { apiKey, apiSecret }, undefined, input.log);
  input.log.info(
    { event: TRADING_MODE_EVENT, mode: "order_capable" as const, reasons: [...reasons] },
    "trading.mode.selected",
  );
  return { rest, execution, mode: "order_capable", modeReasons: reasons };
}
