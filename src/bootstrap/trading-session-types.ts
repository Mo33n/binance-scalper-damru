import type { AppConfig } from "../config/schema.js";
import type { LoggerPort } from "../application/ports/logger-port.js";
import type { ClockPort } from "../application/ports/clock-port.js";
import type { BootstrapExchangeContext } from "../application/services/bootstrap-exchange.js";
import type { TradingVenueHandles } from "./venue-types.js";
import type { DepthSnapshotConcurrencyGate } from "../infrastructure/binance/depth-snapshot-gate.js";

/** Immutable snapshot after config load + exchange bootstrap (SPEC-01). */
export interface TradingSessionBootstrap {
  readonly config: AppConfig;
  readonly bootstrap: BootstrapExchangeContext;
  readonly log: LoggerPort;
  readonly clock: ClockPort;
}

/** Bootstrap + shared REST/execution handles (SPEC-02). */
export interface TradingSession extends TradingSessionBootstrap {
  readonly venue: TradingVenueHandles;
  /** Shared across book adapters; set by `run-trader` from `binance.maxConcurrentDepthSnapshots` / spacing. */
  readonly depthSnapshotGate?: DepthSnapshotConcurrencyGate;
  /**
   * When `features.useWorkerThreads`, process-wide REST `/depth` gate coordination across workers.
   * Passed into each worker via `worker_threads` `workerData` (not serialized through bootstrap JSON).
   */
  readonly depthGateSharedBuffer?: SharedArrayBuffer;
}
