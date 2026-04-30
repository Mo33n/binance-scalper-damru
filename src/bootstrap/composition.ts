import { loadAppConfig, describeConfigPublic } from "../config/load.js";
import { createPinoLogger, toLoggerPort } from "../infrastructure/logging/pino-logger-adapter.js";
import { createSystemClock } from "../infrastructure/time/system-clock.js";
import { createStubExchangeAdapter } from "../infrastructure/binance/stub-exchange-adapter.js";
import { createStdoutStatsSink } from "../infrastructure/observability/stdout-stats-sink.js";
import { STARTUP_EVENTS } from "../shared/startup-events.js";
import type { AppConfig } from "../config/schema.js";
import type { ClockPort } from "../application/ports/clock-port.js";
import type { LoggerPort } from "../application/ports/logger-port.js";
import type { ExchangePort } from "../application/ports/exchange-port.js";
import type { StatsSink } from "../application/ports/stats-sink.js";
import type { Logger } from "pino";

export interface AppContext {
  readonly config: AppConfig;
  readonly log: LoggerPort;
  /** Raw pino logger when structured child loggers are needed. */
  readonly pino: Logger;
  readonly clock: ClockPort;
  readonly exchange: ExchangePort;
  readonly statsSink: StatsSink;
}

/**
 * Single composition root (architecture §5 — manual wiring, no DI framework).
 */
export function createAppContext(): AppContext {
  const config = loadAppConfig();
  const pino = createPinoLogger("trader", config.logLevel);
  const log = toLoggerPort(pino);
  const clock = createSystemClock();
  const exchange = createStubExchangeAdapter(config.environment);
  const statsSink = createStdoutStatsSink(log);
  return { config, log, pino, clock, exchange, statsSink };
}

export function logStartupConfig(log: LoggerPort, config: AppConfig): void {
  log.info({ event: STARTUP_EVENTS.configLoaded, ...describeConfigPublic(config) }, "config.loaded");
  log.info({ event: STARTUP_EVENTS.configFeatures, ...config.features }, "config.features");
  log.info({ event: STARTUP_EVENTS.configRollout, ...config.rollout }, "config.rollout");
}
