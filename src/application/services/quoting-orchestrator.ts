import type { AppConfig } from "../../config/schema.js";
import type { EffectiveFees, SymbolSpec } from "../../infrastructure/binance/types.js";
import { mapBinanceOrderError } from "../../infrastructure/binance/signed-rest-orders.js";
import type { BootstrapSymbolDecision } from "./bootstrap-exchange.js";
import { buildHybridQuoteIntent } from "../../domain/quoting/hybrid-quoting.js";
import type { QuotingInputs, QuoteIntent } from "../../domain/quoting/types.js";
import type { QuotingSnapshot } from "../ports/quoting.js";
import type { InventoryReader } from "../ports/inventory-reader.js";
import type { LoggerPort } from "../ports/logger-port.js";
import type { ExecutionService } from "./execution-service.js";
import type { MarkoutPolicy } from "./markout-policy.js";
import type { MarkoutTracker } from "./markout-tracker.js";
import type { PositionLedger } from "./position-ledger.js";
import { canPlaceQuoteIntent } from "./pre-trade-risk.js";

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

export interface QuotingOrchestratorDeps {
  readonly log: LoggerPort;
  readonly execution: ExecutionService | undefined;
  readonly spec: SymbolSpec;
  readonly fees: EffectiveFees;
  readonly cfg: Pick<AppConfig, "risk" | "quoting" | "features">;
  readonly getSnapshot: () => QuotingSnapshot;
  readonly isHalted: () => boolean;
  readonly monotonicNowMs: () => number;
  readonly effectiveMinSpreadTicks: number;
  readonly positionLedger: PositionLedger;
  readonly createInventoryReader: (markPx: number, nowMs: number) => InventoryReader;
  /** Per-symbol markout when `features.markoutFeedbackEnabled` (runner-local tracker). */
  readonly markoutFeedback?: {
    readonly symbol: string;
    readonly tracker: MarkoutTracker;
    readonly policy: MarkoutPolicy;
  };
}

export class QuotingOrchestrator {
  private readonly deps: QuotingOrchestratorDeps;
  private lastIntentFingerprint: string | undefined;
  private readonly lastSkipLogMsByReason = new Map<string, number>();
  private staleBookUnavailableSinceMs: number | undefined;
  private lastStaleBookAttentionLogMs = 0;

  constructor(deps: QuotingOrchestratorDeps) {
    this.deps = deps;
    void deps.fees;
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
      this.deps.log.info(
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
      this.deps.log.info(
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
    this.deps.log.info(
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
    const mf = this.deps.markoutFeedback;
    if (mf !== undefined && cfg.features.markoutFeedbackEnabled) {
      mf.tracker.onMid(mf.symbol, markPx, now);
      mf.tracker.collectDueSamples(now);
    }
    const markoutExtraTicks =
      mf !== undefined && cfg.features.markoutFeedbackEnabled ? mf.policy.widenSpreadTicks() : 0;
    const reader = this.deps.createInventoryReader(markPx, now);
    const inputs: QuotingInputs = {
      touch: { bestBid: bb, bestAsk: ba },
      toxicityScore: snapshot.toxicity.toxicityScore,
      toxicityTau: cfg.risk.vpinTau,
      rvRegime: snapshot.rvRegime,
      minSpreadTicks: this.deps.effectiveMinSpreadTicks + markoutExtraTicks,
      tickSize: this.deps.spec.tickSize,
      inventoryMode: reader.getInventoryStressMode(),
      baseOrderQty: resolveBaseOrderQty(cfg),
    };

    const intent = buildHybridQuoteIntent(inputs);

    const gate = canPlaceQuoteIntent({
      intent,
      ledger: this.deps.positionLedger,
      cfg: cfg.risk,
      spec: this.deps.spec,
    });
    if (!gate.ok) {
      this.emitSkip("pre_trade_risk", now, { detail: gate.reason });
      return;
    }

    try {
      if (!intentHasWorkingLegs(intent)) {
        await execution.cancelAll(this.deps.spec.symbol);
        this.lastIntentFingerprint = undefined;
        return;
      }

      const fp = stableIntentFingerprint(intent);
      if (fp === this.lastIntentFingerprint) {
        return;
      }

      this.lastIntentFingerprint = fp;
      await execution.cancelAll(this.deps.spec.symbol);
      await execution.placeFromIntent(this.deps.spec, intent);
    } catch (err) {
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
}
