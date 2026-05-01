import type { BookSnapshot } from "../../domain/market-data/types.js";

/** Published snapshot for quoting / supervision (SPEC-04). Immutable via `Object.freeze`. */
export interface MarketDataReadModel {
  readonly lastBookApplyMonotonicMs: number | undefined;
  readonly lastMid: number | undefined;
  readonly touchSpreadTicks: number | undefined;
  readonly bestBidPx: number | undefined;
  readonly bestAskPx: number | undefined;
  readonly bestBidQty: number | undefined;
  readonly bestAskQty: number | undefined;
  readonly quotingPausedForBookResync: boolean;
}

/** Single-threaded mutation site for book-driven fields (runner callbacks only). */
export class MarketDataReadModelStore {
  private lastBookApplyMonotonicMs: number | undefined;
  private lastMid: number | undefined;
  private touchSpreadTicks: number | undefined;
  private bestBidPx: number | undefined;
  private bestAskPx: number | undefined;
  private bestBidQty: number | undefined;
  private bestAskQty: number | undefined;
  private quotingPausedForBookResync = false;

  setQuotingPaused(value: boolean): void {
    this.quotingPausedForBookResync = value;
  }

  /** Called after any successfully applied book snapshot or diff update. */
  onBookApplied(book: BookSnapshot, monotonicNowMs: number): void {
    this.lastBookApplyMonotonicMs = monotonicNowMs;
    this.quotingPausedForBookResync = false;

    const bb = book.bestBid;
    const ba = book.bestAsk;
    if (bb !== undefined && ba !== undefined) {
      this.bestBidPx = bb.price;
      this.bestAskPx = ba.price;
      this.bestBidQty = bb.qty;
      this.bestAskQty = ba.qty;
      this.lastMid = (bb.price + ba.price) / 2;
      this.touchSpreadTicks = book.spreadTicks;
    } else {
      this.bestBidPx = undefined;
      this.bestAskPx = undefined;
      this.bestBidQty = undefined;
      this.bestAskQty = undefined;
      this.lastMid = undefined;
      this.touchSpreadTicks = undefined;
    }
  }

  getReadModel(): MarketDataReadModel {
    return Object.freeze({
      lastBookApplyMonotonicMs: this.lastBookApplyMonotonicMs,
      lastMid: this.lastMid,
      touchSpreadTicks: this.touchSpreadTicks,
      bestBidPx: this.bestBidPx,
      bestAskPx: this.bestAskPx,
      bestBidQty: this.bestBidQty,
      bestAskQty: this.bestAskQty,
      quotingPausedForBookResync: this.quotingPausedForBookResync,
    });
  }
}
