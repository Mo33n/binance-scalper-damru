import type { ClockPort } from "../../application/ports/clock-port.js";
import type { LoggerPort } from "../../application/ports/logger-port.js";
import type { QuotingSnapshot } from "../../application/ports/quoting.js";
import type { BootstrapSymbolDecision } from "../../application/services/bootstrap-exchange.js";
import { EwmaMarkoutPolicy } from "../../application/services/markout-policy.js";
import { MarkoutTracker } from "../../application/services/markout-tracker.js";
import {
  QuotingOrchestrator,
  resolveAcceptedMinSpreadTicks,
  type QuotingOrchestratorDeps,
} from "../../application/services/quoting-orchestrator.js";
import type { ExecutionService } from "../../application/services/execution-service.js";
import type { PositionLedger } from "../../application/services/position-ledger.js";
import type { SignalEngine } from "../../application/services/signal-engine.js";
import { createInventoryReaderForMark } from "../../application/services/inventory-reader-factory.js";
import { createSignalEngineForSession } from "../../bootstrap/signal-engine-factory.js";
import type { AppConfig } from "../../config/schema.js";
import type { BookSnapshot } from "../../domain/market-data/types.js";
import { DEFAULT_REGIME_BOOK_HALT, DEFAULT_REGIME_TREND_STRESS } from "../../domain/regime/live-regime-thresholds.js";
import { detectTrendStress, shouldHaltForBook } from "../../domain/regime/regime-flags.js";
import type { FillEvent } from "../../infrastructure/binance/user-stream.js";
import type { EffectiveFees, SymbolSpec } from "../../infrastructure/binance/types.js";
import { serializeEnvelope } from "../messaging/envelope.js";
import type { HeartbeatPayload, SupervisorCommand } from "../messaging/types.js";
import type { BinanceBookFeedAdapter } from "../../infrastructure/binance/binance-market-data-adapters.js";
import type { DepthSnapshotGatePort } from "../../infrastructure/binance/depth-snapshot-gate.js";
import {
  createMarketDataControllerForSession,
  type MarketDataController,
  type MarketDataHostContext,
} from "./market-data-controller.js";

export interface SymbolLoopStartParams {
  readonly workerId: string;
  readonly symbol: string;
  readonly spec: SymbolSpec | undefined;
  readonly clock: ClockPort;
  readonly binance: AppConfig["binance"];
  readonly risk: AppConfig["risk"];
  readonly quoting: AppConfig["quoting"];
  readonly features: AppConfig["features"];
  readonly heartbeatIntervalMs: number;
  readonly fees: EffectiveFees;
  readonly decisions: readonly BootstrapSymbolDecision[];
  readonly emitEnvelope: (raw: string) => void;
  readonly monotonicNowMs: () => number;
  readonly attachMarketData: boolean;
  readonly positionLedger: PositionLedger;
  readonly execution: ExecutionService | undefined;
  readonly log: LoggerPort;
  readonly rest: MarketDataHostContext["venue"]["rest"];
  /** Invoked once after cleanup (main-thread runner notifies supervisor via `onExit`). */
  readonly onStopped?: () => void;
  /** When set, depth uses this shared adapter (`features.combinedDepthStream` on main thread). */
  readonly sharedBookFeed?: BinanceBookFeedAdapter;
  readonly depthSnapshotGate: DepthSnapshotGatePort;
}

type LoopState = "running" | "stopping" | "stopped";

/**
 * Shared per-symbol runtime (SPEC-08) — used by main-thread runner and `worker_threads` worker.
 */
export class SymbolLoopRuntime {
  private readonly workerId: string;
  private readonly symbol: string;
  private readonly emitEnvelope: (raw: string) => void;
  private readonly log: LoggerPort;
  private readonly monotonicNowMs: () => number;
  private readonly intervalId: ReturnType<typeof setInterval>;
  private quotingIntervalId: ReturnType<typeof setInterval> | undefined;
  private readonly signalEngine: SignalEngine;
  private readonly marketData: MarketDataController | undefined;
  private seq = 0;
  private state: LoopState = "running";
  private exitNotified = false;
  private halted = false;
  private stopChain: Promise<void> | undefined;
  private readonly positionLedger: PositionLedger;
  private readonly execution: ExecutionService | undefined;
  private readonly onStopped: (() => void) | undefined;
  private lastMidForRegime: number | undefined;
  private regimeHaltEmitted = false;

  private constructor(params: SymbolLoopStartParams) {
    this.workerId = params.workerId;
    this.symbol = params.symbol;
    this.emitEnvelope = params.emitEnvelope;
    this.log = params.log;
    this.monotonicNowMs = params.monotonicNowMs;
    this.positionLedger = params.positionLedger;
    this.execution = params.execution;
    this.onStopped = params.onStopped;

    const intervalMs = params.heartbeatIntervalMs;
    this.intervalId = setInterval(() => {
      if (this.state !== "running") return;
      this.seq += 1;
      const payload: HeartbeatPayload = {
        workerId: this.workerId,
        symbol: this.symbol,
        seq: this.seq,
        sentAtMonotonicMs: this.monotonicNowMs(),
      };
      this.emitEnvelope(serializeEnvelope({ v: 1, kind: "heartbeat", payload }));
    }, intervalMs);

    this.signalEngine = createSignalEngineForSession(
      { config: { risk: params.risk }, clock: params.clock },
      params.log,
    );

    const host: MarketDataHostContext = {
      config: { binance: params.binance, quoting: params.quoting },
      venue: { rest: params.rest },
      depthSnapshotGate: params.depthSnapshotGate,
    };

    let marketData: MarketDataController | undefined;
    if (params.attachMarketData && params.spec !== undefined) {
      marketData = createMarketDataControllerForSession(
        host,
        params.spec,
        this.signalEngine,
        params.monotonicNowMs,
        params.log,
        params.sharedBookFeed !== undefined ? { sharedBook: params.sharedBookFeed } : undefined,
      );
      void marketData.start().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        params.log.error({ event: "marketdata.start_failed", symbol: params.symbol, msg }, "marketdata.start_failed");
      });
    }
    this.marketData = marketData;

    if (params.spec !== undefined && marketData !== undefined) {
      const sym = params.symbol;
      let markoutFeedback: QuotingOrchestratorDeps["markoutFeedback"];
      if (params.features.markoutFeedbackEnabled) {
        const tracker = new MarkoutTracker([1000, 5000, 15_000]);
        markoutFeedback = {
          symbol: sym,
          tracker,
          policy: new EwmaMarkoutPolicy(tracker, {
            tickSize: params.spec.tickSize,
            adverseEwmaTicks: 2,
            maxExtraTicks: 4,
          }),
        };
        params.positionLedger.registerFillListener((fill) => {
          if (fill.symbol !== sym) return;
          tracker.onFill({
            fillId: `${fill.symbol}:${String(fill.orderId)}:${String(fill.tradeId)}`,
            symbol: fill.symbol,
            side: fill.side,
            fillPrice: fill.price,
            fillAtMs: params.monotonicNowMs(),
          });
        });
      }
      const orch = new QuotingOrchestrator({
        log: params.log,
        execution: params.execution,
        spec: params.spec,
        fees: params.fees,
        cfg: {
          risk: params.risk,
          quoting: params.quoting,
          features: params.features,
        },
        getSnapshot: () => {
          const q = this.getQuotingSnapshot();
          if (q === undefined) throw new Error(`QuotingSnapshot unavailable for ${sym}`);
          return q;
        },
        isHalted: () => (this.state === "running" ? this.halted : true),
        monotonicNowMs: params.monotonicNowMs,
        effectiveMinSpreadTicks: resolveAcceptedMinSpreadTicks(
          sym,
          params.decisions,
          params.risk.defaultMinSpreadTicks,
        ),
        positionLedger: params.positionLedger,
        createInventoryReader: (markPx, nowMs) =>
          createInventoryReaderForMark(params.positionLedger, sym, markPx, nowMs),
        ...(markoutFeedback !== undefined ? { markoutFeedback } : {}),
      });
      const qMs = params.quoting.repriceMinIntervalMs;
      this.quotingIntervalId = setInterval(() => {
        if (this.state !== "running") return;
        if (params.features.regimeFlagsEnabled) {
          this.maybeEmitRegimeHalt(params);
        }
        void orch.tick().catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.log.warn({ event: "quoting.tick_failed", msg }, "quoting.tick_failed");
        });
      }, qMs);
    }
  }

  static start(params: SymbolLoopStartParams): SymbolLoopRuntime {
    return new SymbolLoopRuntime(params);
  }

  getMarketDataController(): MarketDataController | undefined {
    return this.marketData;
  }

  getQuotingSnapshot(): QuotingSnapshot | undefined {
    if (this.marketData === undefined) return undefined;
    const rm = this.marketData.getReadModel();
    const mono = this.monotonicNowMs();
    const stalenessMs =
      rm.lastBookApplyMonotonicMs === undefined
        ? Number.POSITIVE_INFINITY
        : Math.max(0, mono - rm.lastBookApplyMonotonicMs);
    return {
      readModel: {
        quotingPausedForBookResync: rm.quotingPausedForBookResync,
        bestBidPx: rm.bestBidPx,
        bestAskPx: rm.bestAskPx,
      },
      stalenessMs,
      toxicity: this.signalEngine.getSnapshot(),
      rvRegime: this.signalEngine.getQuotingInputs().rvRegime,
    };
  }

  applyLedgerFill(fill: FillEvent, nowMs: number): void {
    this.positionLedger.applyFill(fill, nowMs);
  }

  sendCommand(cmd: SupervisorCommand): void {
    void this.applyCommand(cmd);
  }

  async stop(): Promise<void> {
    if (this.state === "stopped") return;
    if (this.stopChain !== undefined) {
      await this.stopChain;
      return;
    }

    this.state = "stopping";
    const symbol = this.symbol;
    this.stopChain = (async () => {
      if (this.quotingIntervalId !== undefined) {
        clearInterval(this.quotingIntervalId);
        this.quotingIntervalId = undefined;
      }
      clearInterval(this.intervalId);
      await this.marketData?.stop();
      if (this.execution !== undefined) {
        await this.execution.cancelAll(symbol);
      }
      if (!this.exitNotified) {
        this.exitNotified = true;
      }
      this.state = "stopped";
      this.onStopped?.();
    })();

    await this.stopChain;
    this.stopChain = undefined;
  }

  private maybeEmitRegimeHalt(params: SymbolLoopStartParams): void {
    if (this.regimeHaltEmitted) return;
    const md = this.marketData;
    if (md === undefined) return;
    const rm = md.getReadModel();
    const bb = rm.bestBidPx;
    const ba = rm.bestAskPx;
    if (bb === undefined || ba === undefined) return;

    const bookSnap: BookSnapshot = {
      symbol: params.symbol,
      bids: [],
      asks: [],
      bestBid: { price: bb, qty: rm.bestBidQty ?? 0 },
      bestAsk: { price: ba, qty: rm.bestAskQty ?? 0 },
      ...(rm.touchSpreadTicks !== undefined ? { spreadTicks: rm.touchSpreadTicks } : {}),
    };

    if (shouldHaltForBook(bookSnap, DEFAULT_REGIME_BOOK_HALT)) {
      this.emitRegimeHalt(params.workerId, params.symbol, "regime_book_stress");
      return;
    }

    const mid = rm.lastMid;
    if (mid !== undefined && this.lastMidForRegime !== undefined) {
      if (detectTrendStress(this.lastMidForRegime, mid, DEFAULT_REGIME_TREND_STRESS) === "stressed") {
        this.emitRegimeHalt(params.workerId, params.symbol, "regime_trend_stress");
        return;
      }
    }
    if (mid !== undefined) {
      this.lastMidForRegime = mid;
    }

    if (this.signalEngine.getQuotingInputs().rvRegime === "stressed") {
      this.emitRegimeHalt(params.workerId, params.symbol, "regime_rv_stressed");
    }
  }

  private emitRegimeHalt(workerId: string, symbol: string, reason: string): void {
    if (this.regimeHaltEmitted) return;
    this.regimeHaltEmitted = true;
    this.emitEnvelope(
      serializeEnvelope({
        v: 1,
        kind: "halt_request",
        payload: { workerId, symbol, reason },
      }),
    );
    this.log.warn({ event: "runner.regime_halt_request", symbol, reason }, "runner.regime_halt_request");
  }

  private async applyCommand(cmd: SupervisorCommand): Promise<void> {
    if (this.state !== "running") return;
    switch (cmd.type) {
      case "HALT_QUOTING":
        this.halted = true;
        this.log.info({ event: "runner.halt", reason: cmd.reason }, "runner.halt");
        break;
      case "RESUME_QUOTING":
        this.halted = false;
        this.regimeHaltEmitted = false;
        break;
      case "CANCEL_ALL":
        if (cmd.symbol === this.symbol) {
          await this.execution?.cancelAll(this.symbol);
        }
        break;
    }
  }
}
