import { describe, expect, it, vi } from "vitest";
import { serializeEnvelope } from "../../../src/runtime/messaging/envelope.js";
import type { SymbolRunnerHandle, SymbolRunnerPort } from "../../../src/runtime/worker/symbol-runner.js";
import { Supervisor } from "../../../src/runtime/supervisor/supervisor.js";

class RunnerStub implements SymbolRunnerPort {
  readonly handles: SymbolRunnerHandle[] = [];
  startSymbolRunner(input: {
    symbol: string;
    workerId: string;
    onMessage(raw: string): void;
    onExit(): void;
  }): SymbolRunnerHandle {
    const handle: SymbolRunnerHandle = {
      workerId: input.workerId,
      symbol: input.symbol,
      stop: vi.fn(async () => {}),
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

  it("triggers cancel-all on heartbeat miss", async () => {
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
});
