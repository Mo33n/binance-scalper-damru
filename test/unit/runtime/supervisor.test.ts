import { describe, expect, it, vi } from "vitest";
import { LossGuard } from "../../../src/application/services/loss-guard.js";
import { serializeEnvelope } from "../../../src/runtime/messaging/envelope.js";
import type { SymbolRunnerHandle, SymbolRunnerPort } from "../../../src/runtime/worker/symbol-runner.js";
import { Supervisor } from "../../../src/runtime/supervisor/supervisor.js";

class RunnerStub implements SymbolRunnerPort {
  readonly handles: SymbolRunnerHandle[] = [];
  readonly stopSpies: Array<ReturnType<typeof vi.fn>> = [];
  startSymbolRunner(input: {
    symbol: string;
    workerId: string;
    onMessage(raw: string): void;
    onExit(): void;
  }): SymbolRunnerHandle {
    const stop = vi.fn(async () => {});
    this.stopSpies.push(stop);
    const handle: SymbolRunnerHandle = {
      workerId: input.workerId,
      symbol: input.symbol,
      stop,
      sendCommand: vi.fn(),
    };
    this.handles.push(handle);
    return handle;
  }
}

describe("Supervisor", () => {
  it("drops malformed IPC messages", () => {
    const runner = new RunnerStub();
    const sink = { emitSnapshot: vi.fn() };
    const cancelAllForSymbol = vi.fn(async () => {});
    const sup = new Supervisor(
      { heartbeatIntervalMs: 1000, heartbeatMissThreshold: 2 },
      {
        runners: runner,
        statsSink: sink,
        nowUtcIso: () => "2026-01-01T00:00:00.000Z",
        monotonicNowMs: () => 0,
        cancelAllForSymbol,
      },
    );
    sup.startSymbols(["BTCUSDT"]);
    expect(() => {
      sup.ingestRawMessage("{bad-json");
    }).not.toThrow();
  });

  it("SPEC-07 T01 / heartbeat miss triggers cancel-all once", async () => {
    let now = 0;
    const runner = new RunnerStub();
    const sink = { emitSnapshot: vi.fn() };
    const cancelAllForSymbol = vi.fn(async () => {});
    const sup = new Supervisor(
      { heartbeatIntervalMs: 1000, heartbeatMissThreshold: 2 },
      {
        runners: runner,
        statsSink: sink,
        nowUtcIso: () => "2026-01-01T00:00:00.000Z",
        monotonicNowMs: () => now,
        cancelAllForSymbol,
      },
    );
    sup.startSymbols(["BTCUSDT"]);
    now = 2501;
    await sup.checkHeartbeats();
    expect(cancelAllForSymbol).toHaveBeenCalledTimes(1);
    expect(cancelAllForSymbol).toHaveBeenCalledWith("BTCUSDT");
  });

  it("rate-limits repeated halt broadcasts by reason", () => {
    const runner = new RunnerStub();
    const sink = { emitSnapshot: vi.fn() };
    const sup = new Supervisor(
      { heartbeatIntervalMs: 1000, heartbeatMissThreshold: 2 },
      {
        runners: runner,
        statsSink: sink,
        nowUtcIso: () => "2026-01-01T00:00:00.000Z",
        monotonicNowMs: () => 0,
        cancelAllForSymbol: async () => {},
      },
    );
    sup.startSymbols(["BTCUSDT"]);
    const h = runner.handles[0];
    expect(h).toBeDefined();
    if (h === undefined) {
      throw new Error("missing runner handle");
    }
    sup.broadcast({ type: "HALT_QUOTING", reason: "margin_halt" });
    sup.broadcast({ type: "HALT_QUOTING", reason: "margin_halt" });
    expect((h.sendCommand as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);
  });

  it("SPEC-07 T03: stopAll invokes stop on every symbol handle", async () => {
    const runner = new RunnerStub();
    const sink = { emitSnapshot: vi.fn() };
    const sup = new Supervisor(
      { heartbeatIntervalMs: 1000, heartbeatMissThreshold: 2 },
      {
        runners: runner,
        statsSink: sink,
        nowUtcIso: () => "2026-01-01T00:01:00.000Z",
        monotonicNowMs: () => 0,
        cancelAllForSymbol: async () => {},
      },
    );
    sup.startSymbols(["BTCUSDT", "ETHUSDT"]);
    await sup.stopAll();
    expect(runner.handles).toHaveLength(2);
    expect(runner.stopSpies).toHaveLength(2);
    for (const s of runner.stopSpies) {
      expect(s).toHaveBeenCalledTimes(1);
    }
  });

  it("aggregates metric deltas and emits a consolidated snapshot", () => {
    const runner = new RunnerStub();
    const sink = { emitSnapshot: vi.fn() };
    const sup = new Supervisor(
      { heartbeatIntervalMs: 1000, heartbeatMissThreshold: 2 },
      {
        runners: runner,
        statsSink: sink,
        nowUtcIso: () => "2026-01-01T00:01:00.000Z",
        monotonicNowMs: () => 0,
        cancelAllForSymbol: async () => {},
      },
    );
    sup.startSymbols(["BTCUSDT"]);
    sup.ingestRawMessage(
      serializeEnvelope({
        v: 1,
        kind: "metric_delta",
        payload: {
          workerId: "w-BTCUSDT",
          symbol: "BTCUSDT",
          quoteVolumeDelta: 1000,
          pnlDeltaQuote: 12,
          feesDeltaQuote: -1,
          fundingDeltaQuote: -0.5,
        },
      }),
    );
    const out = sup.emitSnapshot();
    expect(out.portfolioVolumeQuote).toBe(1000);
    expect(out.portfolioNetPnlQuote).toBeCloseTo(10.5);
    expect(out.lines).toHaveLength(1);
    expect(sink.emitSnapshot).toHaveBeenCalledTimes(1);
  });

  it("SPEC-09: halt_request envelope triggers HALT_QUOTING broadcast", () => {
    const runner = new RunnerStub();
    const sink = { emitSnapshot: vi.fn() };
    const sup = new Supervisor(
      { heartbeatIntervalMs: 1000, heartbeatMissThreshold: 2 },
      {
        runners: runner,
        statsSink: sink,
        nowUtcIso: () => "2026-01-01T00:01:00.000Z",
        monotonicNowMs: () => 0,
        cancelAllForSymbol: async () => {},
      },
    );
    sup.startSymbols(["BTCUSDT"]);
    const h = runner.handles[0];
    expect(h).toBeDefined();
    if (h === undefined) throw new Error("missing runner handle");

    sup.ingestRawMessage(
      serializeEnvelope({
        v: 1,
        kind: "halt_request",
        payload: {
          workerId: "w-BTCUSDT",
          symbol: "BTCUSDT",
          reason: "regime_book_stress",
        },
      }),
    );

    expect(h.sendCommand).toHaveBeenCalledWith({
      type: "HALT_QUOTING",
      reason: "regime_book_stress",
    });
  });

  it("SPEC-09 T03: loss guard trips HALT_QUOTING session_loss_cap", () => {
    const runner = new RunnerStub();
    const sink = { emitSnapshot: vi.fn() };
    const lossGuard = new LossGuard({
      sessionLossCapQuote: 50,
      dailyLossCapQuote: 50,
      cooldownMs: 60_000,
      allowTradingAfterKill: false,
    });
    const sup = new Supervisor(
      { heartbeatIntervalMs: 1000, heartbeatMissThreshold: 2 },
      {
        runners: runner,
        statsSink: sink,
        nowUtcIso: () => "2026-01-01T00:01:00.000Z",
        monotonicNowMs: () => 0,
        cancelAllForSymbol: async () => {},
        lossGuard,
      },
    );
    sup.startSymbols(["BTCUSDT"]);
    const h = runner.handles[0];
    expect(h).toBeDefined();
    if (h === undefined) throw new Error("missing runner handle");

    sup.ingestRawMessage(
      serializeEnvelope({
        v: 1,
        kind: "metric_delta",
        payload: {
          workerId: "w-BTCUSDT",
          symbol: "BTCUSDT",
          pnlDeltaQuote: -120,
        },
      }),
    );

    expect(h.sendCommand).toHaveBeenCalledWith({
      type: "HALT_QUOTING",
      reason: "session_loss_cap",
    });
  });
});
