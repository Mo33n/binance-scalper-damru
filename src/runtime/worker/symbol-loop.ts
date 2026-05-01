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
import { DEFAULT_REGIME_BOOK_HALT } from "../../domain/regime/live-regime-thresholds.js";
import { shouldHaltForBook } from "../../domain/regime/regime-flags.js";
import {
  buildDeRiskExitPlan,
  isTouchDeRiskProfitable,
} from "../../domain/quoting/execution-directive.js";
import {
  detectTrendStressSample,
  isWrongWayTrendVsInventory,
  regimePolicyUsesT0Cancel,
  regimeThrottleSpreadMult,
  shouldEmitTrendHaltRequest,
} from "../../domain/regime/regime-trend-stress-policy.js";
import { canPlaceDeRiskExit } from "../../application/services/pre-trade-risk.js";
import type { FillEvent } from "../../infrastructure/binance/user-stream.js";
import type { PortfolioMarkCoordinator } from "../../application/services/portfolio-mark-coordinator.js";
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
  /** Cross-symbol portfolio gross gate (optional; main-thread runners typically pass shared marks cache). */
  readonly portfolioGate?: {
    readonly symbols: readonly string[];
    readonly specsBySymbol: ReadonlyMap<string, SymbolSpec>;
    readonly marks: PortfolioMarkCoordinator;
  };
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
  private trendStressConsecutive = 0;
  private regimeThrottleActive = false;
  private regimeEpisodeCancelDone = false;
  private trendClearSinceMono: number | undefined;
  private lastWrongWayDeRiskSkipLogMono = Number.NEGATIVE_INFINITY;
  private readonly loopParams: SymbolLoopStartParams;
  private quotingOrchestrator: QuotingOrchestrator | undefined;
  private quoteDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  private lastQuoteEvalMono = 0;
  private lastProbeMid: number | undefined;
  private lastProbeBb: number | undefined;
  private lastProbeBa: number | undefined;

  private constructor(params: SymbolLoopStartParams) {
    this.loopParams = params;
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
      const baseSpreadTicks = resolveAcceptedMinSpreadTicks(
        sym,
        params.decisions,
        params.risk.defaultMinSpreadTicks,
      );
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
        /** Trend-stress throttle only; `QuotingOrchestrator` applies liquidity FSM spread mult on top (RFC P1.5). */
        effectiveMinSpreadTicks: () => {
          const mult = regimeThrottleSpreadMult(params.quoting, this.regimeThrottleActive);
          return Math.max(1, Math.ceil(baseSpreadTicks * mult));
        },
        positionLedger: params.positionLedger,
        createInventoryReader: (markPx, nowMs) =>
          createInventoryReaderForMark(params.positionLedger, sym, markPx, nowMs),
        ...(markoutFeedback !== undefined ? { markoutFeedback } : {}),
        getSigmaLn: () => this.signalEngine.getRvEwmaSigmaLn(),
        ...(params.portfolioGate !== undefined ? { portfolioGate: params.portfolioGate } : {}),
      });
      this.quotingOrchestrator = orch;
      marketData.setOnBookApplied(() => {
        this.scheduleDebouncedOrchestratorTick("book_update");
      });
      const qMs = params.quoting.repriceMinIntervalMs;
      this.quotingIntervalId = setInterval(() => {
        if (this.state !== "running") return;
        void this.runOrchestratorTickCycle(params, "interval");
      }, qMs);
    }
  }

  /**
   * Debounced mid/BBO jump repricing. Precedence: trend-stress halt/cancel in `maybeEmitRegimeHaltAsync`
   * runs only on the timer path today; jump triggers call the same `orch.tick()` without duplicating regime wiring.
   */
  private scheduleDebouncedOrchestratorTick(reason: string): void {
    const p = this.loopParams;
    const le = p.quoting.liquidityEngine;
    if (this.state !== "running" || le?.enabled !== true || le.quoteTriggers.enabled !== true) return;
    const rm = this.marketData?.getReadModel();
    if (rm?.bestBidPx === undefined || rm.bestAskPx === undefined) return;
    const mid = (rm.bestBidPx + rm.bestAskPx) / 2;
    const bb = rm.bestBidPx;
    const ba = rm.bestAskPx;
    const tick = p.spec?.tickSize ?? 1;
    const epsTicks = le.quoteTriggers.epsilonTicks;
    if (this.lastProbeMid === undefined) {
      this.lastProbeMid = mid;
      this.lastProbeBb = bb;
      this.lastProbeBa = ba;
      return;
    }
    const midJump = Math.abs(mid - this.lastProbeMid) >= epsTicks * tick;
    const bboMove = bb !== this.lastProbeBb || ba !== this.lastProbeBa;
    this.lastProbeMid = mid;
    this.lastProbeBb = bb;
    this.lastProbeBa = ba;
    if (!midJump && !bboMove) return;

    if (this.quoteDebounceTimer !== undefined) {
      clearTimeout(this.quoteDebounceTimer);
      this.quoteDebounceTimer = undefined;
    }
    const floorMs = p.quoting.repriceMinIntervalMs;
    const now = p.monotonicNowMs();
    const elapsed = now - this.lastQuoteEvalMono;
    const delay = computeQuoteTriggerDelayMs(floorMs, elapsed);
    this.quoteDebounceTimer = setTimeout(() => {
      this.quoteDebounceTimer = undefined;
      void this.runOrchestratorTickCycle(p, reason);
    }, delay);
  }

  private async runOrchestratorTickCycle(params: SymbolLoopStartParams, tickReason: string): Promise<void> {
    const orch = this.quotingOrchestrator;
    if (orch === undefined || this.state !== "running") return;
    try {
      if (params.features.regimeFlagsEnabled) {
        await this.maybeEmitRegimeHaltAsync(params);
      }
      if (this.state !== "running") return;
      await orch.tick();
      this.lastQuoteEvalMono = params.monotonicNowMs();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn({ event: "quoting.tick_failed", msg, tickReason }, "quoting.tick_failed");
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
        ...(rm.bestBidQty !== undefined ? { bestBidQty: rm.bestBidQty } : {}),
        ...(rm.bestAskQty !== undefined ? { bestAskQty: rm.bestAskQty } : {}),
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
      if (this.quoteDebounceTimer !== undefined) {
        clearTimeout(this.quoteDebounceTimer);
        this.quoteDebounceTimer = undefined;
      }
      if (this.quotingIntervalId !== undefined) {
        clearInterval(this.quotingIntervalId);
        this.quotingIntervalId = undefined;
      }
      clearInterval(this.intervalId);
      await this.marketData?.stop();
      if (this.execution !== undefined) {
        await this.execution.cancelAll(symbol, { reason: "symbol_runner_stop" });
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

  private resetRegimeTrendSoftState(): void {
    this.trendStressConsecutive = 0;
    this.regimeThrottleActive = false;
    this.regimeEpisodeCancelDone = false;
    this.trendClearSinceMono = undefined;
  }

  private async cancelRegimeWorkingOrdersIfNeeded(params: SymbolLoopStartParams, reason: string): Promise<void> {
    if (!regimePolicyUsesT0Cancel(params.quoting.regimeTrendStressPolicy)) return;
    if (this.regimeEpisodeCancelDone) return;
    if (this.execution === undefined) {
      this.log.debug(
        { event: "runner.regime_cancel_skipped", symbol: this.symbol, reason, cause: "no_execution" },
        "runner.regime_cancel_skipped",
      );
      return;
    }
    this.regimeEpisodeCancelDone = true;
    try {
      await this.execution.cancelAll(this.symbol, {
        reason: "regime_episode_cancel",
        detail: { regimeReason: reason },
      });
      this.log.info({ event: "runner.regime_t0_cancel", symbol: this.symbol, reason }, "runner.regime_t0_cancel");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(
        { event: "runner.regime_t0_cancel_failed", symbol: this.symbol, reason, msg },
        "runner.regime_t0_cancel_failed",
      );
    }
  }

  private async tryWrongWayDeRiskOnTrend(
    params: SymbolLoopStartParams,
    touch: { readonly bestBid: number; readonly bestAsk: number },
  ): Promise<void> {
    const policy = params.quoting.regimeTrendStressPolicy;
    if (policy !== "ladder_mvp" && policy !== "ladder_full") return;
    if (params.spec === undefined) return;
    if (!params.features.inventoryDeRiskEnabled) {
      const now = params.monotonicNowMs();
      if (now - this.lastWrongWayDeRiskSkipLogMono >= params.quoting.repriceMinIntervalMs) {
        this.lastWrongWayDeRiskSkipLogMono = now;
        this.log.warn(
          {
            event: "quoting.regime_flatten_skipped_de_risk_off",
            symbol: params.symbol,
            policy,
          },
          "quoting.regime_flatten_skipped_de_risk_off",
        );
      }
      return;
    }
    if (params.risk.deRiskMode === "off") {
      const now = params.monotonicNowMs();
      if (now - this.lastWrongWayDeRiskSkipLogMono >= params.quoting.repriceMinIntervalMs) {
        this.lastWrongWayDeRiskSkipLogMono = now;
        this.log.warn(
          {
            event: "quoting.regime_flatten_skipped_de_risk_mode_off",
            symbol: params.symbol,
          },
          "quoting.regime_flatten_skipped_de_risk_mode_off",
        );
      }
      return;
    }
    if (this.execution === undefined) return;

    const netQty = this.positionLedger.getPosition(params.symbol).netQty;
    const plan = buildDeRiskExitPlan({
      spec: params.spec,
      touch,
      netQty,
      mode: params.risk.deRiskMode,
    });
    if (!plan.ok) return;

    if (params.risk.deRiskProfitOnly === true) {
      const pos = this.positionLedger.getPosition(params.symbol);
      const avg = pos.avgEntryPrice;
      if (avg === undefined || !Number.isFinite(avg)) {
        return;
      }
      if (
        !isTouchDeRiskProfitable({
          netQty,
          avgEntryPrice: avg,
          touch,
          tickSize: params.spec.tickSize,
          minProfitTicks: params.risk.deRiskMinProfitTicks ?? 0,
        })
      ) {
        return;
      }
    }

    const gate = canPlaceDeRiskExit({ exit: plan.exit, netQty });
    if (!gate.ok) return;

    try {
      await this.execution.cancelAll(this.symbol, { reason: "regime_wrong_way_clear" });
      await this.execution.executeDeRisk(params.spec, plan.exit, {
        reason: "regime_wrong_way_de_risk",
        detail: {
          mode: plan.exit.mode,
          side: plan.exit.side,
          quantity: plan.exit.quantity,
        },
      });
      this.log.info(
        {
          event: "quoting.regime_trend_wrong_way_de_risk",
          symbol: params.symbol,
          side: plan.exit.side,
          quantity: plan.exit.quantity,
          mode: plan.exit.mode,
        },
        "quoting.regime_trend_wrong_way_de_risk",
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(
        { event: "quoting.regime_trend_wrong_way_de_risk_failed", symbol: params.symbol, msg },
        "quoting.regime_trend_wrong_way_de_risk_failed",
      );
    }
  }

  private maybeClearTrendStressWithHysteresis(params: SymbolLoopStartParams): void {
    const clearedMs = params.quoting.regimeStressClearedMs;
    const now = params.monotonicNowMs();
    if (clearedMs <= 0) {
      this.resetRegimeTrendSoftState();
      return;
    }
    if (this.trendClearSinceMono === undefined) {
      this.trendClearSinceMono = now;
      return;
    }
    if (now - this.trendClearSinceMono >= clearedMs) {
      this.resetRegimeTrendSoftState();
    }
  }

  private async maybeEmitRegimeHaltAsync(params: SymbolLoopStartParams): Promise<void> {
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
      await this.cancelRegimeWorkingOrdersIfNeeded(params, "regime_book_stress");
      this.regimeThrottleActive = regimePolicyUsesT0Cancel(params.quoting.regimeTrendStressPolicy);
      this.emitRegimeHalt(params.workerId, params.symbol, "regime_book_stress");
      return;
    }

    const mid = rm.lastMid;
    if (mid !== undefined && this.lastMidForRegime !== undefined) {
      const trendStressed =
        detectTrendStressSample({
          lastMid: this.lastMidForRegime,
          mid,
          impulseNormalizer: params.quoting.regimeTrendImpulseNormalizer,
          rvSigmaLn: this.signalEngine.getRvEwmaSigmaLn(),
          rvZHalt: params.quoting.regimeTrendRvZHalt,
        }) === "stressed";

      if (trendStressed) {
        this.trendClearSinceMono = undefined;
        this.trendStressConsecutive += 1;
        const policy = params.quoting.regimeTrendStressPolicy;
        if (regimePolicyUsesT0Cancel(policy)) {
          await this.cancelRegimeWorkingOrdersIfNeeded(params, "regime_trend_stress");
          this.regimeThrottleActive = true;
        }

        const emitHalt = shouldEmitTrendHaltRequest({
          policy,
          consecutiveStressedSamples: this.trendStressConsecutive,
          persistenceN: params.quoting.regimeTrendStressPersistenceN,
        });

        if (emitHalt) {
          const deltaMid = mid - this.lastMidForRegime;
          const netQty = this.positionLedger.getPosition(params.symbol).netQty;
          if (
            isWrongWayTrendVsInventory({
              deltaMid,
              netQty,
              minAbsQty: params.quoting.regimeTrendInventoryMinQty,
            })
          ) {
            await this.tryWrongWayDeRiskOnTrend(params, { bestBid: bb, bestAsk: ba });
          }

          this.emitRegimeHalt(params.workerId, params.symbol, "regime_trend_stress");
        }
        return;
      }

      if (this.trendStressConsecutive > 0 || this.regimeThrottleActive) {
        this.maybeClearTrendStressWithHysteresis(params);
      }
      if (mid !== undefined) {
        this.lastMidForRegime = mid;
      }
    } else if (mid !== undefined) {
      this.lastMidForRegime = mid;
    }

    if (this.signalEngine.getQuotingInputs().rvRegime === "stressed") {
      await this.cancelRegimeWorkingOrdersIfNeeded(params, "regime_rv_stressed");
      this.regimeThrottleActive = regimePolicyUsesT0Cancel(params.quoting.regimeTrendStressPolicy);
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
        this.resetRegimeTrendSoftState();
        break;
      case "CANCEL_ALL":
        if (cmd.symbol === this.symbol) {
          await this.execution?.cancelAll(this.symbol, { reason: "supervisor_cancel_all_command" });
        }
        break;
    }
  }
}

/** Exported for tests — debounce wait until next eligible quoting tick (RFC P1.6). */
export function computeQuoteTriggerDelayMs(floorMs: number, elapsedSinceLastTickMs: number): number {
  return Math.max(0, floorMs - elapsedSinceLastTickMs);
}
