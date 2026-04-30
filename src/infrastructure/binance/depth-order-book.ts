import type { BookLevel, BookSnapshot, DepthDiffEvent } from "../../domain/market-data/types.js";
import { monotonicNowMs } from "../../shared/monotonic.js";

export interface DepthSnapshotRaw {
  readonly lastUpdateId: number;
  readonly bids: readonly [string, string][];
  readonly asks: readonly [string, string][];
}

export type DepthApplyResult =
  | { readonly kind: "updated"; readonly snapshot: BookSnapshot }
  | { readonly kind: "ignored" }
  | { readonly kind: "gap" };

/**
 * Maintains top-of-book with Binance depth sequence guards.
 * Uses `pu` continuity when present and falls back to U/u checks.
 */
export class DepthOrderBook {
  private readonly symbol: string;
  private readonly tickSize: number;
  private lastFinalUpdateId?: number;
  private synchronized = false;
  private lastAppliedMonotonicMs?: number;
  private bids = new Map<number, number>();
  private asks = new Map<number, number>();

  constructor(symbol: string, tickSize: number) {
    this.symbol = symbol;
    this.tickSize = tickSize;
  }

  applySnapshot(raw: DepthSnapshotRaw): BookSnapshot {
    this.bids.clear();
    this.asks.clear();
    applyLevels(this.bids, raw.bids);
    applyLevels(this.asks, raw.asks);
    this.lastFinalUpdateId = raw.lastUpdateId;
    this.synchronized = true;
    this.lastAppliedMonotonicMs = monotonicNowMs();
    return this.currentSnapshot(undefined);
  }

  applyDiff(evt: DepthDiffEvent): DepthApplyResult {
    if (!this.synchronized || this.lastFinalUpdateId === undefined) {
      return { kind: "ignored" };
    }

    if (evt.finalUpdateId <= this.lastFinalUpdateId) {
      return { kind: "ignored" };
    }

    const expectedPrev = this.lastFinalUpdateId;
    const hasGap =
      (evt.prevFinalUpdateId !== undefined && evt.prevFinalUpdateId !== expectedPrev) ||
      (evt.prevFinalUpdateId === undefined &&
        (evt.firstUpdateId > expectedPrev + 1 || evt.finalUpdateId < expectedPrev + 1));
    if (hasGap) {
      this.synchronized = false;
      return { kind: "gap" };
    }

    applyNumericLevels(this.bids, evt.bids);
    applyNumericLevels(this.asks, evt.asks);
    this.lastFinalUpdateId = evt.finalUpdateId;
    this.lastAppliedMonotonicMs = monotonicNowMs();
    return { kind: "updated", snapshot: this.currentSnapshot(evt.eventTimeMs) };
  }

  getSnapshot(): BookSnapshot | undefined {
    if (!this.synchronized) return undefined;
    return this.currentSnapshot(undefined);
  }

  getStalenessMs(nowMs = monotonicNowMs()): number | undefined {
    if (this.lastAppliedMonotonicMs === undefined) return undefined;
    return Math.max(0, nowMs - this.lastAppliedMonotonicMs);
  }

  getResyncRequired(): boolean {
    return !this.synchronized;
  }

  private currentSnapshot(eventTimeMs: number | undefined): BookSnapshot {
    const bestBid = bestFromMap(this.bids, "desc");
    const bestAsk = bestFromMap(this.asks, "asc");
    const spreadTicks =
      bestBid !== undefined && bestAsk !== undefined
        ? Math.round((bestAsk.price - bestBid.price) / this.tickSize)
        : undefined;
    return {
      symbol: this.symbol,
      bids: topLevels(this.bids, "desc", 20),
      asks: topLevels(this.asks, "asc", 20),
      ...(bestBid !== undefined ? { bestBid } : {}),
      ...(bestAsk !== undefined ? { bestAsk } : {}),
      ...(spreadTicks !== undefined ? { spreadTicks } : {}),
      ...(eventTimeMs !== undefined ? { exchangeEventTimeMs: eventTimeMs } : {}),
    };
  }
}

function applyLevels(target: Map<number, number>, levels: readonly [string, string][]): void {
  for (const [p, q] of levels) {
    const price = Number(p);
    const qty = Number(q);
    if (!Number.isFinite(price) || !Number.isFinite(qty) || price <= 0) continue;
    if (qty <= 0) target.delete(price);
    else target.set(price, qty);
  }
}

function applyNumericLevels(target: Map<number, number>, levels: readonly BookLevel[]): void {
  for (const lvl of levels) {
    if (lvl.qty <= 0) target.delete(lvl.price);
    else target.set(lvl.price, lvl.qty);
  }
}

function bestFromMap(
  levels: Map<number, number>,
  direction: "asc" | "desc",
): BookLevel | undefined {
  const arr = topLevels(levels, direction, 1);
  return arr[0];
}

function topLevels(
  levels: Map<number, number>,
  direction: "asc" | "desc",
  limit: number,
): BookLevel[] {
  const entries = [...levels.entries()].sort((a, b) =>
    direction === "asc" ? a[0] - b[0] : b[0] - a[0],
  );
  return entries.slice(0, limit).map(([price, qty]) => ({ price, qty }));
}
