import type { LoggerPort } from "../../application/ports/logger-port.js";
import type { TradingLogEvent } from "../../shared/trading-log-event.js";

const SENSITIVE_KEYS = new Set([
  "apiKey",
  "apiSecret",
  "secret",
  "privateKey",
  "passphrase",
  "listenKey",
]);

export function redactForLog(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SENSITIVE_KEYS.has(k)) {
      out[k] = "[REDACTED]";
      continue;
    }
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      out[k] = redactForLog(v as Record<string, unknown>);
      continue;
    }
    out[k] = v;
  }
  return out;
}

export function logTradingEvent(log: LoggerPort, e: TradingLogEvent): void {
  const base: Record<string, unknown> = {
    event: e.event,
    ...(e.symbol !== undefined ? { symbol: e.symbol } : {}),
    ...(e.orderId !== undefined ? { orderId: e.orderId } : {}),
    ...(e.clientOrderId !== undefined ? { clientOrderId: e.clientOrderId } : {}),
  };
  const extra = e.extra !== undefined ? redactForLog(e.extra) : {};
  log.info({ ...base, ...extra }, e.event);
}
