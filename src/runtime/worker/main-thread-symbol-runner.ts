import type { PositionLedger } from "../../application/services/position-ledger.js";
import type { TradingSession } from "../../bootstrap/trading-session-types.js";
import type { QuotingSnapshot } from "../../application/ports/quoting.js";
import { SymbolLoopRuntime } from "./symbol-loop.js";
import type { MarketDataController } from "./market-data-controller.js";
import type { SymbolRunnerHandle, SymbolRunnerPort } from "./symbol-runner.js";

export interface MainThreadRunnerDeps {
  readonly session: TradingSession;
  readonly monotonicNowMs: () => number;
  /** Shared session ledger (SPEC-06); filled via account user stream when order-capable. */
  readonly positionLedger: PositionLedger;
  /**
   * When false, skips per-symbol WS market data (bootstrap-only runs / CI).
   * Set env `DAMRU_DISABLE_MARKET_DATA=1` from tests.
   */
  readonly attachMarketData?: boolean;
}

interface Entry {
  readonly loop: SymbolLoopRuntime;
}

export class MainThreadSymbolRunner implements SymbolRunnerPort {
  private readonly deps: MainThreadRunnerDeps;
  private readonly entries = new Map<string, Entry>();
  private readonly handles = new Map<string, SymbolRunnerHandle>();

  constructor(deps: MainThreadRunnerDeps) {
    this.deps = deps;
  }

  startSymbolRunner(input: {
    symbol: string;
    workerId: string;
    onMessage(raw: string): void;
    onExit(): void;
  }): SymbolRunnerHandle {
    const existing = this.handles.get(input.symbol);
    if (existing !== undefined) {
      return existing;
    }

    const log = this.deps.session.log.child({ symbol: input.symbol });
    const sym = input.symbol;
    const spec = this.deps.session.bootstrap.symbols.find((s) => s.symbol === sym);

    const loop = SymbolLoopRuntime.start({
      workerId: input.workerId,
      symbol: sym,
      spec,
      clock: this.deps.session.clock,
      binance: this.deps.session.config.binance,
      risk: this.deps.session.config.risk,
      quoting: this.deps.session.config.quoting,
      features: this.deps.session.config.features,
      heartbeatIntervalMs: this.deps.session.config.heartbeatIntervalMs,
      fees: this.deps.session.bootstrap.fees,
      decisions: this.deps.session.bootstrap.decisions,
      emitEnvelope: (raw) => {
        input.onMessage(raw);
      },
      monotonicNowMs: this.deps.monotonicNowMs,
      attachMarketData: this.deps.attachMarketData !== false,
      positionLedger: this.deps.positionLedger,
      execution: this.deps.session.venue.execution,
      log,
      rest: this.deps.session.venue.rest,
      onStopped: () => {
        input.onExit();
      },
    });

    this.entries.set(sym, { loop });

    const handle: SymbolRunnerHandle = {
      workerId: input.workerId,
      symbol: sym,
      stop: async () => {
        await this.stopSymbol(sym);
      },
      sendCommand: (cmd) => {
        this.entries.get(sym)?.loop.sendCommand(cmd);
      },
    };
    this.handles.set(sym, handle);
    return handle;
  }

  /** SPEC-04 §11 — inputs for quoting loop (SPEC-05). */
  getQuotingSnapshot(symbol: string): QuotingSnapshot | undefined {
    return this.entries.get(symbol)?.loop.getQuotingSnapshot();
  }

  getMarketDataController(symbol: string): MarketDataController | undefined {
    return this.entries.get(symbol)?.loop.getMarketDataController();
  }

  private async stopSymbol(symbol: string): Promise<void> {
    const entry = this.entries.get(symbol);
    if (entry === undefined) return;
    await entry.loop.stop();
    this.entries.delete(symbol);
    this.handles.delete(symbol);
  }
}
