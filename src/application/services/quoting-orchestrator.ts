import type { AppConfig } from "../../config/schema.js";
import type { EffectiveFees, SymbolSpec } from "../../infrastructure/binance/types.js";
import { buildFairValueQuote } from "../../domain/liquidity/fair-value.js";
import {
  diffTargetVsWorking,
  quoteIntentToTargetBook,
} from "../../domain/liquidity/target-book.js";
import { passesEdgeGate } from "../../domain/liquidity/edge-gate.js";
import {
  initialRegimeFsmMemory,
  liquidityRegimeSpreadMultiplier,
  stepLiquidityRegimeFsm,
  type LiquidityRegimeState,
} from "../../domain/liquidity/regime-state-machine.js";
import { mapBinanceOrderError } from "../../infrastructure/binance/signed-rest-orders.js";
import type { BootstrapSymbolDecision } from "./bootstrap-exchange.js";
import { resolveExecutionDirective, type DeRiskExitPlan } from "../../domain/quoting/execution-directive.js";
import { ticksBetween } from "../../domain/quoting/hybrid-quoting.js";
import type { QuotingInputs, QuoteIntent } from "../../domain/quoting/types.js";
import type { QuotingSnapshot } from "../ports/quoting.js";
import type { InventoryReader } from "../ports/inventory-reader.js";
import type { LoggerPort } from "../ports/logger-port.js";
import type { ExecutionService, OrderActionContext } from "./execution-service.js";
import type { MarkoutPolicy } from "./markout-policy.js";
import type { MarkoutTracker } from "./markout-tracker.js";
import type { PortfolioMarkCoordinator } from "./portfolio-mark-coordinator.js";
import type { PositionLedger } from "./position-ledger.js";
import { evaluateGlobalPortfolioGate, resolveBetaToRef } from "./portfolio-gate.js";
import { canPlaceDeRiskExit, canPlaceQuoteIntent } from "./pre-trade-risk.js";

export function resolveAcceptedMinSpreadTicks(
  symbol: string,
  decisions: readonly BootstrapSymbolDecision[],
  defaultMinSpreadTicks: number,
): number {
  const row = decisions.find((d) => d.symbol === symbol && d.status === "accepted");
  return row?.effectiveMinSpreadTicks ?? defaultMinSpreadTicks;
}

/** Documented default: 5% of `maxAbsQty` when `quoting.baseOrderQty` unset (SPEC-05). */
export function resolveBaseOrderQty(cfg: Pick<AppConfig, "risk" | "quoting">): number {
  if (cfg.quoting.baseOrderQty !== undefined) {
    return cfg.quoting.baseOrderQty;
  }
  const cap = cfg.risk.maxAbsQty;
  const fraction = cap * 0.05;
  return Math.min(fraction, cap);
}

function intentHasWorkingLegs(intent: QuoteIntent): boolean {
  const bid = intent.bidPx !== undefined && intent.bidQty !== undefined;
  const ask = intent.askPx !== undefined && intent.askQty !== undefined;
  return bid || ask;
}

/** Reminder while book stays stale/unavailable (operator-visible `info`). */
const STALE_BOOK_ATTENTION_INTERVAL_MS = 30_000;

function stableIntentFingerprint(intent: QuoteIntent): string {
  return JSON.stringify({
    regime: intent.regime,
    bidPx: intent.bidPx ?? null,
    askPx: intent.askPx ?? null,
    bidQty: intent.bidQty ?? null,
    askQty: intent.askQty ?? null,
    postOnly: intent.postOnly,
    reduceOnly: intent.reduceOnly,
  });
}

function stableDeRiskFingerprint(exit: DeRiskExitPlan): string {
  return JSON.stringify({
    side: exit.side,
    quantity: exit.quantity,
    limitPrice: exit.limitPrice,
    mode: exit.mode,
    postOnly: exit.postOnly,
  });
}

export interface QuotingOrchestratorDeps {
  readonly log: LoggerPort;
  readonly execution: ExecutionService | undefined;
  readonly spec: SymbolSpec;
  readonly fees: EffectiveFees;
  readonly cfg: Pick<AppConfig, "risk" | "quoting" | "features">;
  readonly getSnapshot: () => QuotingSnapshot;
  readonly isHalted: () => boolean;
  readonly monotonicNowMs: () => number;
  /** Static ticks or resolver (e.g. regime throttle multiplies spread each tick). */
  readonly effectiveMinSpreadTicks: number | (() => number);
  readonly positionLedger: PositionLedger;
  readonly createInventoryReader: (markPx: number, nowMs: number) => InventoryReader;
  /** Per-symbol markout when `features.markoutFeedbackEnabled` (runner-local tracker). */
  readonly markoutFeedback?: {
    readonly symbol: string;
    readonly tracker: MarkoutTracker;
    readonly policy: MarkoutPolicy;
  };
  /** EWMA σ of log-mid — optional volatility hurdle for edge gate when `risk.rvEnabled`. */
  readonly getSigmaLn?: () => number | undefined;
  /**
   * Cross-symbol gross gate (main thread). With `worker_threads`, omit or accept partial marks
   * (each worker only records its own symbol).
   */
  readonly portfolioGate?: {
    readonly symbols: readonly string[];
    readonly specsBySymbol: ReadonlyMap<string, SymbolSpec>;
    readonly marks: PortfolioMarkCoordinator;
  };
}

export class QuotingOrchestrator {
  private readonly deps: QuotingOrchestratorDeps;
  private lastIntentFingerprint: string | undefined;
  private lastDeRiskFingerprint: string | undefined;
  private readonly lastSkipLogMsByReason = new Map<string, number>();
  private readonly lastWarnLogMsByEvent = new Map<string, number>();
  private staleBookUnavailableSinceMs: number | undefined;
  private lastStaleBookAttentionLogMs = 0;
  private regimeFsmMemory = initialRegimeFsmMemory();
  private liquidityRegimeState: LiquidityRegimeState = "COLLECT";
  private fairValueFallbackLogged = false;

  constructor(deps: QuotingOrchestratorDeps) {
    this.deps = deps;
  }

  private rateLimitedSkipLog(reason: string, now: number): boolean {
    const interval = this.deps.cfg.quoting.repriceMinIntervalMs;
    const last = this.lastSkipLogMsByReason.get(reason) ?? 0;
    if (now - last < interval) return false;
    this.lastSkipLogMsByReason.set(reason, now);
    return true;
  }

  private emitSkip(reason: string, now: number, extra?: Record<string, unknown>): void {
    if (!this.rateLimitedSkipLog(reason, now)) return;
    this.deps.log.debug({ event: "quoting.skip", reason, ...extra }, "quoting.skip");
  }

  /** Rate-limited warn — `quoting.warnLogCooldownMs` (default 60s); `0` falls back to `repriceMinIntervalMs`. */
  private emitWarnEvent(event: string, now: number, fields: Record<string, unknown>): void {
    const q = this.deps.cfg.quoting;
    const interval =
      q.warnLogCooldownMs > 0 ? q.warnLogCooldownMs : q.repriceMinIntervalMs;
    const last = this.lastWarnLogMsByEvent.get(event);
    if (last !== undefined && now - last < interval) return;
    this.lastWarnLogMsByEvent.set(event, now);
    this.deps.log.warn({ event, symbol: this.deps.spec.symbol, ...fields }, event);
  }

  private logStaleBookAttention(
    now: number,
    rm: QuotingSnapshot["readModel"],
    stalenessMs: number,
    maxBookStalenessMs: number,
  ): void {
    const subReason = rm.quotingPausedForBookResync ? "depth_resync" : "staleness_exceeded";
    const finiteStaleness = Number.isFinite(stalenessMs);
    const first = this.staleBookUnavailableSinceMs === undefined;
    if (first) {
      this.staleBookUnavailableSinceMs = now;
      this.lastStaleBookAttentionLogMs = now;
      this.deps.log.debug(
        {
          event: "quoting.book_unavailable",
          symbol: this.deps.spec.symbol,
          subReason,
          ...(finiteStaleness ? { stalenessMs } : { bookNeverApplied: true }),
          quotingPausedForBookResync: rm.quotingPausedForBookResync,
          maxBookStalenessMs,
        },
        "quoting.book_unavailable",
      );
      return;
    }
    if (now - this.lastStaleBookAttentionLogMs >= STALE_BOOK_ATTENTION_INTERVAL_MS) {
      this.lastStaleBookAttentionLogMs = now;
      this.deps.log.debug(
        {
          event: "quoting.book_still_unavailable",
          symbol: this.deps.spec.symbol,
          subReason,
          ...(finiteStaleness ? { stalenessMs } : { bookNeverApplied: true }),
          quotingPausedForBookResync: rm.quotingPausedForBookResync,
          maxBookStalenessMs,
          unavailableDurationMs: now - (this.staleBookUnavailableSinceMs ?? now),
        },
        "quoting.book_still_unavailable",
      );
    }
  }

  private clearStaleBookAttention(now: number): void {
    if (this.staleBookUnavailableSinceMs === undefined) return;
    const started = this.staleBookUnavailableSinceMs;
    this.staleBookUnavailableSinceMs = undefined;
    this.lastStaleBookAttentionLogMs = 0;
    this.deps.log.debug(
      {
        event: "quoting.book_restored",
        symbol: this.deps.spec.symbol,
        unavailableDurationMs: now - started,
      },
      "quoting.book_restored",
    );
  }

  async tick(): Promise<void> {
    const now = this.deps.monotonicNowMs();
    const { execution, cfg } = this.deps;

    if (execution === undefined) {
      this.emitSkip("read_only", now);
      return;
    }

    if (!cfg.features.liveQuotingEnabled) {
      this.emitSkip("live_quoting_disabled", now);
      return;
    }

    if (this.deps.isHalted()) {
      this.emitSkip("halted", now);
      return;
    }

    const snapshot = this.deps.getSnapshot();
    const rm = snapshot.readModel;

    const staleBook =
      rm.quotingPausedForBookResync || snapshot.stalenessMs > cfg.quoting.maxBookStalenessMs;
    if (staleBook) {
      this.logStaleBookAttention(now, rm, snapshot.stalenessMs, cfg.quoting.maxBookStalenessMs);
      this.emitSkip("stale_book", now);
      return;
    }

    this.clearStaleBookAttention(now);

    const bb = rm.bestBidPx;
    const ba = rm.bestAskPx;
    if (bb === undefined || ba === undefined) {
      this.emitSkip("incomplete_touch", now);
      return;
    }

    const markPx = (bb + ba) / 2;
    const positionRow = this.deps.positionLedger.getPosition(this.deps.spec.symbol);
    const symbolNetQty = positionRow.netQty;
    this.deps.portfolioGate?.marks.record(this.deps.spec.symbol, markPx);

    const mf = this.deps.markoutFeedback;
    if (mf !== undefined && cfg.features.markoutFeedbackEnabled) {
      mf.tracker.onMid(mf.symbol, markPx, now);
      const markoutSamples = mf.tracker.collectDueSamples(now);
      for (const s of markoutSamples) {
        this.deps.log.debug(
          {
            event: "liquidity.markout_sample",
            symbol: mf.symbol,
            liquidityEngineVersion: "p3",
            fillId: s.fillId,
            horizonMs: s.horizonMs,
            value: s.value,
            reliable: s.reliable,
            ...(s.liquidityRegimeState !== undefined
              ? { liquidityRegimeState: s.liquidityRegimeState }
              : {}),
          },
          "liquidity.markout_sample",
        );
      }
    }
    const markoutExtraTicks =
      mf !== undefined && cfg.features.markoutFeedbackEnabled ? mf.policy.widenSpreadTicks() : 0;
    const reader = this.deps.createInventoryReader(markPx, now);
    const inventoryMode = reader.getInventoryStressMode();
    const resolvedBaseOrderQty = resolveBaseOrderQty(cfg);
    const rawBaseTicks =
      typeof this.deps.effectiveMinSpreadTicks === "function"
        ? this.deps.effectiveMinSpreadTicks()
        : this.deps.effectiveMinSpreadTicks;

    const leCfg = cfg.quoting.liquidityEngine;
    let effectiveSpreadTicks = rawBaseTicks + markoutExtraTicks;
    let economicsMid = markPx;

    if (leCfg?.enabled === true && leCfg.regimeFsm.enabled === true) {
      const microScore =
        ticksBetween(bb, ba, this.deps.spec.tickSize) < rawBaseTicks + markoutExtraTicks ? 1 : 0;
      const fsmOut = stepLiquidityRegimeFsm({
        prevState: this.liquidityRegimeState,
        memory: this.regimeFsmMemory,
        flowScore: snapshot.toxicity.toxicityScore,
        microstructureScore: microScore,
        inventoryNormalized: Math.abs(symbolNetQty) / cfg.risk.maxAbsQty,
        config: leCfg.regimeFsm,
      });
      this.regimeFsmMemory = fsmOut.memory;
      this.liquidityRegimeState = fsmOut.state;
      if (mf !== undefined && cfg.features.markoutFeedbackEnabled) {
        mf.tracker.noteLiquidityRegimeState(fsmOut.state);
      }
      if (fsmOut.transitionReason !== undefined) {
        this.deps.log.info(
          {
            event: "liquidity.regime_transition",
            symbol: this.deps.spec.symbol,
            liquidityEngineVersion: "p1",
            state: fsmOut.state,
            transitionReason: fsmOut.transitionReason,
          },
          "liquidity.regime_transition",
        );
      }
      if (fsmOut.state === "OFF") {
        this.emitWarnEvent("liquidity.regime_off", now, { liquidityEngineVersion: "p1" });
        return;
      }
      const fsmMult = liquidityRegimeSpreadMultiplier(fsmOut.state, leCfg.regimeFsm);
      effectiveSpreadTicks = Math.max(1, Math.ceil(rawBaseTicks * fsmMult)) + markoutExtraTicks;
    }

    let fairMid: number | undefined;
    if (leCfg?.enabled === true && leCfg.fairValue.mode === "microprice") {
      const bbq = rm.bestBidQty;
      const baq = rm.bestAskQty;
      const fv = buildFairValueQuote({
        mode: "microprice",
        touch: { bestBid: bb, bestAsk: ba },
        ...(bbq !== undefined && baq !== undefined
          ? { topBid: { price: bb, qty: bbq }, topAsk: { price: ba, qty: baq } }
          : {}),
      });
      if (
        (bbq === undefined || baq === undefined || bbq <= 0 || baq <= 0) &&
        !this.fairValueFallbackLogged
      ) {
        this.fairValueFallbackLogged = true;
        this.deps.log.info(
          {
            event: "liquidity.fair_value_fallback",
            symbol: this.deps.spec.symbol,
            liquidityEngineVersion: "p1",
          },
          "liquidity.fair_value_fallback",
        );
      }
      fairMid = fv.anchorMid;
      economicsMid = fv.anchorMid;
    }

    const regimeSplit =
      leCfg?.regimeSplit?.enabled === true
        ? { enabled: true as const, toxicCombineMode: leCfg.regimeSplit.toxicCombineMode }
        : undefined;

    const skewCfg = leCfg?.inventorySkew;
    const inventorySkew =
      leCfg?.enabled === true && skewCfg?.enabled === true
        ? {
            enabled: true as const,
            kappaTicks: skewCfg.kappaTicks,
            ...(skewCfg.maxShiftTicks !== undefined ? { maxShiftTicks: skewCfg.maxShiftTicks } : {}),
            netQty: symbolNetQty,
            maxAbsQty: cfg.risk.maxAbsQty,
          }
        : undefined;

    const inputs: QuotingInputs = {
      touch: { bestBid: bb, bestAsk: ba },
      toxicityScore: snapshot.toxicity.toxicityScore,
      toxicityTau: cfg.risk.vpinTau,
      rvRegime: snapshot.rvRegime,
      minSpreadTicks: effectiveSpreadTicks,
      tickSize: this.deps.spec.tickSize,
      inventoryMode,
      baseOrderQty: resolvedBaseOrderQty,
      ...(regimeSplit !== undefined ? { regimeSplit } : {}),
      ...(leCfg?.enabled === true && leCfg.fairValue.mode === "microprice" && fairMid !== undefined
        ? { fairMid, fairValueMode: "microprice" as const }
        : {}),
      ...(inventorySkew !== undefined ? { inventorySkew } : {}),
    };
    const directive = resolveExecutionDirective({
      inventoryMode,
      features: { inventoryDeRiskEnabled: cfg.features.inventoryDeRiskEnabled },
      risk: {
        deRiskMode: cfg.risk.deRiskMode,
        deRiskProfitOnly: cfg.risk.deRiskProfitOnly,
        deRiskMinProfitTicks: cfg.risk.deRiskMinProfitTicks,
      },
      hybridInputs: inputs,
      symbolNetQty,
      spec: this.deps.spec,
      touch: { bestBid: bb, bestAsk: ba },
      ...(positionRow.avgEntryPrice !== undefined ? { avgEntryPrice: positionRow.avgEntryPrice } : {}),
    });

    if (directive.kind === "stress_suppressed") {
      this.emitWarnEvent("quoting.de_risk_suppressed", now, { reason: directive.reason });
      return;
    }

    if (directive.kind === "de_risk_skipped") {
      this.emitWarnEvent("quoting.de_risk_profit_gate", now, {
        skipReason: directive.reason,
        ...(positionRow.avgEntryPrice !== undefined ? { avgEntryPrice: positionRow.avgEntryPrice } : {}),
      });
      return;
    }

    if (directive.kind === "de_risk_unfillable") {
      this.emitWarnEvent("quoting.de_risk_unfillable_dust", now, { detail: directive.reason });
      return;
    }

    if (directive.kind === "de_risk") {
      this.lastIntentFingerprint = undefined;
      const exit = directive.exit;
      const drGate = canPlaceDeRiskExit({
        exit,
        netQty: symbolNetQty,
      });
      if (!drGate.ok) {
        this.emitSkip("pre_trade_risk", now, { detail: drGate.reason });
        return;
      }

      const fp = stableDeRiskFingerprint(exit);
      if (fp === this.lastDeRiskFingerprint) {
        return;
      }

      this.lastDeRiskFingerprint = fp;
      try {
        await execution.cancelAll(this.deps.spec.symbol, {
          reason: "de_risk_clear_working_orders",
        });
        await execution.executeDeRisk(this.deps.spec, exit, {
          reason: "inventory_de_risk",
          detail: {
            mode: exit.mode,
            side: exit.side,
            quantity: exit.quantity,
            limitPrice: exit.limitPrice,
            directiveReason: exit.reason,
          },
        });
        this.deps.log.info(
          {
            event: "quoting.de_risk_placed",
            symbol: this.deps.spec.symbol,
            mode: exit.mode,
            quantity: exit.quantity,
            side: exit.side,
          },
          "quoting.de_risk_placed",
        );
      } catch (err) {
        this.lastDeRiskFingerprint = undefined;
        this.logOrderError(err);
      }
      return;
    }

    const intent = directive.intent;

    const portfolioCfg = leCfg?.portfolio;
    const effectiveMaxAbsNotional =
      leCfg?.enabled === true && portfolioCfg?.betaCapEnabled === true
        ? cfg.risk.maxAbsNotional / resolveBetaToRef(this.deps.spec.symbol, portfolioCfg.betaToRef)
        : undefined;

    const gate = canPlaceQuoteIntent({
      intent,
      ledger: this.deps.positionLedger,
      cfg: cfg.risk,
      spec: this.deps.spec,
      ...(effectiveMaxAbsNotional !== undefined ? { effectiveMaxAbsNotional } : {}),
    });
    if (!gate.ok) {
      this.emitSkip("pre_trade_risk", now, { detail: gate.reason });
      return;
    }

    if (intentHasWorkingLegs(intent)) {
      if (leCfg?.enabled === true) {
        const sigmaLn = this.deps.getSigmaLn?.();
        const edgeResult = passesEdgeGate({
          fees: this.deps.fees,
          mid: economicsMid,
          lambdaSigma: leCfg.edge.lambdaSigma,
          minEdgeBpsFloor: leCfg.edge.minEdgeBpsFloor,
          ...(intent.bidPx !== undefined ? { bidPx: intent.bidPx } : {}),
          ...(intent.askPx !== undefined ? { askPx: intent.askPx } : {}),
          ...(sigmaLn !== undefined ? { sigmaLn } : {}),
        });

        if (!edgeResult.ok) {
          const enforce = leCfg.edge.enforce === true;
          if (enforce) {
            this.emitWarnEvent("liquidity.edge_blocked", now, {
              liquidityEngineVersion: "p0",
              shadow: false,
              midPx: economicsMid,
              bidPx: intent.bidPx,
              askPx: intent.askPx,
              hurdleBps: edgeResult.hurdleBps,
              bidHalfSpreadBps: edgeResult.bidHalfSpreadBps,
              askHalfSpreadBps: edgeResult.askHalfSpreadBps,
            });
            return;
          }
          if (leCfg.edge.shadowOnly === true) {
            this.deps.log.info(
              {
                event: "liquidity.edge_blocked",
                symbol: this.deps.spec.symbol,
                liquidityEngineVersion: "p0",
                shadow: true,
                midPx: economicsMid,
                bidPx: intent.bidPx,
                askPx: intent.askPx,
                hurdleBps: edgeResult.hurdleBps,
                bidHalfSpreadBps: edgeResult.bidHalfSpreadBps,
                askHalfSpreadBps: edgeResult.askHalfSpreadBps,
              },
              "liquidity.edge_blocked",
            );
          }
        }
      }

      if (leCfg?.enabled === true && leCfg.portfolio.enforceGlobal === true) {
        const pg = this.deps.portfolioGate;
        if (pg !== undefined) {
          const marks = pg.marks.getMarks();
          const ev = evaluateGlobalPortfolioGate({
            symbols: pg.symbols,
            ledger: this.deps.positionLedger,
            marks,
            specs: pg.specsBySymbol,
            globalMaxAbsNotional: cfg.risk.globalMaxAbsNotional,
            quoteSymbol: this.deps.spec.symbol,
            ...(intent.bidPx !== undefined && intent.bidQty !== undefined
              ? { intentBid: { qty: intent.bidQty, px: intent.bidPx } }
              : {}),
            ...(intent.askPx !== undefined && intent.askQty !== undefined
              ? { intentAsk: { qty: intent.askQty, px: intent.askPx } }
              : {}),
            ...(leCfg?.portfolio?.betaCapEnabled === true
              ? {
                  betaPortfolio: {
                    enabled: true,
                    betaToRef: leCfg.portfolio.betaToRef,
                  },
                }
              : {}),
          });
          if (!ev.ok) {
            this.emitWarnEvent("liquidity.portfolio_blocked", now, {
              liquidityEngineVersion: "p0",
              currentGross: ev.currentGross,
              projectedGross: ev.projectedGross,
              cap: ev.cap,
            });
            return;
          }
        }
      }
    }

    try {
      this.lastDeRiskFingerprint = undefined;

      if (!intentHasWorkingLegs(intent)) {
        if (intent.regime === "inventory_stress" && !cfg.features.inventoryDeRiskEnabled) {
          this.emitWarnEvent("quoting.de_risk_intent_empty", now, {
            regime: intent.regime,
            netQty: symbolNetQty,
          });
        }
        await execution.cancelAll(this.deps.spec.symbol, {
          reason: "quote_intent_empty_clear",
          detail: {
            regime: intent.regime,
            inventoryDeRiskEnabled: cfg.features.inventoryDeRiskEnabled,
          },
        });
        this.lastIntentFingerprint = undefined;
        return;
      }

      const fp = stableIntentFingerprint(intent);
      if (fp === this.lastIntentFingerprint) {
        return;
      }

      this.lastIntentFingerprint = fp;

      const useOmsDiff =
        leCfg?.enabled === true && leCfg.useLegacyCancelAllRefresh === false;

      if (useOmsDiff) {
        const target = quoteIntentToTargetBook(intent);
        const working = await execution.listOpenOrders(this.deps.spec.symbol);
        const plan = diffTargetVsWorking(target, working);
        this.deps.log.debug(
          {
            event: "liquidity.oms_diff",
            symbol: this.deps.spec.symbol,
            liquidityEngineVersion: "p2",
            cancelN: plan.cancelOrderIds.length,
            placeN: plan.placeLegs.length,
          },
          "liquidity.oms_diff",
        );
        const omsCtx: OrderActionContext = {
          reason: "liquidity_engine_oms_diff",
          detail: {
            cancelOrderCount: plan.cancelOrderIds.length,
            placeLegCount: plan.placeLegs.length,
          },
        };
        await execution.executePlacementPlan(this.deps.spec, plan, omsCtx);
      } else {
        await execution.cancelAll(this.deps.spec.symbol, {
          reason: "liquidity_engine_legacy_refresh",
        });
        await execution.placeFromIntent(this.deps.spec, intent, {
          reason: "liquidity_engine_legacy_quote",
          detail: { regime: intent.regime },
        });
      }
    } catch (err) {
      this.logOrderError(err);
    }
  }

  private logOrderError(err: unknown): void {
    const mapping = mapBinanceOrderError(err);
    this.deps.log.warn(
      {
        event: "quoting.order_error",
        symbol: this.deps.spec.symbol,
        action: mapping.action,
        ...(mapping.code !== undefined ? { code: mapping.code } : {}),
        ...(mapping.httpStatus !== undefined ? { httpStatus: mapping.httpStatus } : {}),
        ...(mapping.binanceMsg !== undefined ? { binanceMsg: mapping.binanceMsg } : {}),
        ...(mapping.bodySnippet !== undefined ? { bodySnippet: mapping.bodySnippet } : {}),
        ...(mapping.detail !== undefined ? { detail: mapping.detail } : {}),
      },
      "quoting.order_error",
    );
  }
}
