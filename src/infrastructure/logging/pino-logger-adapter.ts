import pino, { type Logger } from "pino";
import type { LoggerPort } from "../../application/ports/logger-port.js";

function wrap(logger: Logger): LoggerPort {
  return {
    debug(meta, msg) {
      logger.debug(meta, msg);
    },
    info(meta, msg) {
      logger.info(meta, msg);
    },
    warn(meta, msg) {
      logger.warn(meta, msg);
    },
    error(meta, msg) {
      logger.error(meta, msg);
    },
    child(bindings) {
      return wrap(logger.child(bindings));
    },
  };
}

export function toLoggerPort(logger: Logger): LoggerPort {
  return wrap(logger);
}

export function createPinoLogger(name: string, level: "debug" | "info" | "warn" | "error"): Logger {
  return pino(
    {
      name,
      level,
      base: { pid: process.pid },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    // Sync stdout so short-lived CLI runs flush before Node exits (default SonicBoom is async-buffered).
    pino.destination({ dest: 1, sync: true }),
  );
}
