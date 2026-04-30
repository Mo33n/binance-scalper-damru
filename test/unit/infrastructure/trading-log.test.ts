import { describe, it, expect } from "vitest";
import { logTradingEvent, redactForLog } from "../../../src/infrastructure/logging/trading-log.js";
import type { LoggerPort } from "../../../src/application/ports/logger-port.js";

describe("trading-log", () => {
  it("redacts sensitive keys in nested objects", () => {
    const out = redactForLog({
      apiKey: "super-secret-key",
      nested: { apiSecret: "x".repeat(40) },
      ok: 1,
    });
    expect(out["apiKey"]).toBe("[REDACTED]");
    expect((out["nested"] as Record<string, unknown>)["apiSecret"]).toBe("[REDACTED]");
    expect(out["ok"]).toBe(1);
  });

  it("logTradingEvent forwards redacted metadata", () => {
    const calls: unknown[][] = [];
    const log: LoggerPort = {
      info: (meta, msg) => {
        calls.push([meta, msg]);
      },
      warn: () => undefined,
      error: () => undefined,
      child: () => log,
    };
    logTradingEvent(log, {
      event: "fill",
      symbol: "BTCUSDT",
      clientOrderId: "c1",
      extra: { apiSecret: "should-redact" },
    });
    expect(calls.length).toBe(1);
    const first = calls[0];
    if (first === undefined) throw new Error("expected one log call");
    const meta = first[0] as Record<string, unknown>;
    expect(meta["event"]).toBe("fill");
    expect(meta["apiSecret"]).toBe("[REDACTED]");
  });
});
