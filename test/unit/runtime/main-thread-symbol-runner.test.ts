import { describe, it, expect, vi, afterEach } from "vitest";
import type { LoggerPort } from "../../../src/application/ports/logger-port.js";
import type { TradingSession } from "../../../src/bootstrap/trading-session-types.js";
import { quotingSchema } from "../../../src/config/schema.js";
import { PositionLedger } from "../../../src/application/services/position-ledger.js";
import { parseEnvelope } from "../../../src/runtime/messaging/envelope.js";
import { MainThreadSymbolRunner } from "../../../src/runtime/worker/main-thread-symbol-runner.js";

function stubLedger(): PositionLedger {
  return new PositionLedger({
    maxAbsQty: 100,
    maxAbsNotional: 1e12,
    globalMaxAbsNotional: 1e12,
    inventoryEpsilon: 0,
    maxTimeAboveEpsilonMs: 60_000,
    riskLimitBreachLogCooldownMs: 60_000,
  });
}

function makeLoggerPort(): LoggerPort {
  const log: LoggerPort = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child(): LoggerPort {
      return log;
    },
  };
  return log;
}

function makeMinimalSession(input: {
  readonly heartbeatIntervalMs: number;
  readonly execution: { cancelAll: (symbol: string) => Promise<void> } | undefined;
}): TradingSession {
  return {
    config: {
      heartbeatIntervalMs: input.heartbeatIntervalMs,
      binance: {
        restBaseUrl: "https://testnet.binancefuture.com",
        wsBaseUrl: "wss://stream.binancefuture.com/ws",
      },
      risk: {
        vpinBucketVolume: 1,
        vpinBucketBasis: "base",
        vpinEwmaN: 5,
        vpinStaleFlushMs: 60_000,
        vpinTau: 0.6,
        rvEnabled: false,
        rvTau: 0.0005,
      },
      quoting: quotingSchema.parse({ repriceMinIntervalMs: 250, maxBookStalenessMs: 3000 }),
      features: {
        liveQuotingEnabled: false,
        markoutFeedbackEnabled: false,
        reconciliationIntervalOverrideEnabled: false,
        preFundingFlattenEnabled: false,
        regimeFlagsEnabled: false,
        inventoryDeRiskEnabled: false,
        useWorkerThreads: false,
        combinedDepthStream: false,
      },
    },
    clock: {
      monotonicNowMs: () => 0,
      utcIsoTimestamp: () => "2026-01-01T00:00:00.000Z",
    },
    log: makeLoggerPort(),
    bootstrap: {
      symbols: [],
      fees: Object.freeze({
        makerRate: 0,
        takerRate: 0,
        bnbDiscountEnabled: false,
        asOfIso: "",
      }),
      decisions: [],
    },
    venue: {
      rest: {} as never,
      execution: input.execution,
      mode: input.execution !== undefined ? "order_capable" : "read_only",
      modeReasons: [],
    },
  } as unknown as TradingSession;
}

describe("MainThreadSymbolRunner (SPEC-03)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("T01: double stop resolves; onExit once", async () => {
    const session = makeMinimalSession({ heartbeatIntervalMs: 60_000, execution: undefined });
    const runner = new MainThreadSymbolRunner({
      session,
      monotonicNowMs: () => 0,
      positionLedger: stubLedger(),
      attachMarketData: false,
    });
    const onExit = vi.fn();
    const h = runner.startSymbolRunner({
      symbol: "BTCUSDT",
      workerId: "w-BTCUSDT",
      onMessage: () => {},
      onExit,
    });
    await h.stop();
    await h.stop();
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("T02: heartbeats emit parseable envelopes with increasing seq", () => {
    vi.useFakeTimers();
    let mono = 100;
    const session = makeMinimalSession({ heartbeatIntervalMs: 1000, execution: undefined });
    const runner = new MainThreadSymbolRunner({
      session,
      monotonicNowMs: () => mono,
      positionLedger: stubLedger(),
      attachMarketData: false,
    });
    const onMessage = vi.fn();
    runner.startSymbolRunner({
      symbol: "BTCUSDT",
      workerId: "w-BTCUSDT",
      onMessage,
      onExit: vi.fn(),
    });

    vi.advanceTimersByTime(1000);
    mono += 1;
    vi.advanceTimersByTime(1000);

    expect(onMessage).toHaveBeenCalledTimes(2);
    const c0 = onMessage.mock.calls[0];
    const c1 = onMessage.mock.calls[1];
    expect(c0).toBeDefined();
    expect(c1).toBeDefined();
    const e0 = parseEnvelope(String(c0?.[0]));
    const e1 = parseEnvelope(String(c1?.[0]));
    expect(e0.kind).toBe("heartbeat");
    expect(e1.kind).toBe("heartbeat");
    expect((e0.payload as { seq: number }).seq).toBe(1);
    expect((e1.payload as { seq: number }).seq).toBe(2);
  });

  it("T03: execution undefined — stop does not throw", async () => {
    const session = makeMinimalSession({ heartbeatIntervalMs: 60_000, execution: undefined });
    const runner = new MainThreadSymbolRunner({
      session,
      monotonicNowMs: () => 0,
      positionLedger: stubLedger(),
      attachMarketData: false,
    });
    const h = runner.startSymbolRunner({
      symbol: "BTCUSDT",
      workerId: "w-BTCUSDT",
      onMessage: () => {},
      onExit: vi.fn(),
    });
    await expect(h.stop()).resolves.toBeUndefined();
  });

  it("T04: execution.cancelAll invoked once on stop", async () => {
    const cancelAll = vi.fn(async () => {});
    const session = makeMinimalSession({
      heartbeatIntervalMs: 60_000,
      execution: { cancelAll },
    });
    const runner = new MainThreadSymbolRunner({
      session,
      monotonicNowMs: () => 0,
      positionLedger: stubLedger(),
      attachMarketData: false,
    });
    const h = runner.startSymbolRunner({
      symbol: "BTCUSDT",
      workerId: "w-BTCUSDT",
      onMessage: () => {},
      onExit: vi.fn(),
    });
    await h.stop();
    expect(cancelAll).toHaveBeenCalledTimes(1);
    expect(cancelAll).toHaveBeenCalledWith("BTCUSDT", { reason: "symbol_runner_stop" });
  });
});
