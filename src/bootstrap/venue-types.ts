import type { BinanceRestClient } from "../infrastructure/binance/rest-client.js";
import type { ExecutionService } from "../application/services/execution-service.js";

export type TradingMode = "read_only" | "order_capable";

export type TradingModeReason =
  | "no_credentials"
  | "dry_run"
  | "live_quoting_disabled"
  | "ready";

export interface TradingVenueHandles {
  readonly rest: BinanceRestClient;
  readonly execution: ExecutionService | undefined;
  readonly mode: TradingMode;
  readonly modeReasons: readonly TradingModeReason[];
}
