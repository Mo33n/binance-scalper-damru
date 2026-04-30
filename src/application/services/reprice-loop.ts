import type { BookSnapshot } from "../../domain/market-data/types.js";
import type { QuoteIntent } from "../../domain/quoting/types.js";
import { ticksBetween } from "../../domain/quoting/hybrid-quoting.js";

export interface RepriceLoopConfig {
  readonly minRepriceIntervalMs: number;
  readonly moveCancelTicks: number;
  readonly staleBookThresholdMs: number;
  readonly tickSize: number;
}

export interface RepriceDecision {
  readonly action: "skip" | "replace" | "cancel_all";
  readonly reason: string;
}

export class RepriceLoop {
  private readonly cfg: RepriceLoopConfig;
  private lastRepriceMs = 0;
  private lastWorkingBid: number | undefined;
  private lastWorkingAsk: number | undefined;
  private suppressedCount = 0;

  constructor(cfg: RepriceLoopConfig) {
    this.cfg = cfg;
  }

  onQuoted(intent: QuoteIntent, nowMs: number): void {
    this.lastRepriceMs = nowMs;
    this.lastWorkingBid = intent.bidPx;
    this.lastWorkingAsk = intent.askPx;
  }

  decide(
    book: BookSnapshot | undefined,
    intent: QuoteIntent,
    nowMs: number,
    stalenessMs: number | undefined,
  ): RepriceDecision {
    if (stalenessMs !== undefined && stalenessMs > this.cfg.staleBookThresholdMs) {
      return { action: "cancel_all", reason: "stale_book_guard" };
    }

    if (nowMs - this.lastRepriceMs < this.cfg.minRepriceIntervalMs) {
      this.suppressedCount += 1;
      return { action: "skip", reason: "throttle" };
    }

    if (
      book !== undefined &&
      this.lastWorkingBid !== undefined &&
      this.lastWorkingAsk !== undefined &&
      book.bestBid !== undefined &&
      book.bestAsk !== undefined
    ) {
      const bidMove = Math.abs(
        ticksBetween(this.lastWorkingBid, book.bestBid.price, this.cfg.tickSize),
      );
      const askMove = Math.abs(
        ticksBetween(this.lastWorkingAsk, book.bestAsk.price, this.cfg.tickSize),
      );
      if (Math.max(bidMove, askMove) >= this.cfg.moveCancelTicks) {
        return { action: "cancel_all", reason: "move_cancel_threshold" };
      }
    }

    return { action: "replace", reason: "normal_reprice" };
  }

  getSuppressedCount(): number {
    return this.suppressedCount;
  }
}
