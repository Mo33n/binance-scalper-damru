import pino, { type Logger } from "pino";
import type { LoggerPort } from "../../application/ports/logger-port.js";

function wrap(logger: Logger): LoggerPort {
  return {
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
  return pino({
    name,
    level,
    base: { pid: process.pid },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
