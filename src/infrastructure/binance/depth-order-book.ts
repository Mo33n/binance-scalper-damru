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
 * Reorders buffered websocket diffs so the first applied event overlaps REST snapshot `lastUpdateId` (L).
 * Applying FIFO only is unsafe: an event with `U > L` may arrive before any diff whose `[U,u]` contains `L`,
 * which would incorrectly trigger a gap even though a valid bridge event is already buffered.
 */
export function orderDepthDiffsForBridge(
  anchorLastUpdateId: number,
  pending: readonly DepthDiffEvent[],
):
  | { readonly ok: true; readonly events: readonly DepthDiffEvent[] }
  | { readonly ok: false } {
  const L = anchorLastUpdateId;
  if (pending.length === 0) {
    return { ok: true, events: [] };
  }
  const kept = pending.filter((e) => e.finalUpdateId >= L);
  if (kept.length === 0) {
    return { ok: true, events: [] };
  }
  const bridgeIdx = kept.findIndex((e) => e.firstUpdateId <= L && e.finalUpdateId >= L);
  if (bridgeIdx === -1) {
    return { ok: false };
  }
  return { ok: true, events: kept.slice(bridgeIdx) };
}

/**
 * Maintains top-of-book with Binance USDS-M futures depth rules:
 * after each REST snapshot, the first stream event must overlap the snapshot `lastUpdateId` (`U <= L <= u`);
 * thereafter each event's `pu` must match the previous `u` (or U/u fallback when `pu` is absent).
 */
export class DepthOrderBook {
  private readonly symbol: string;
  private readonly tickSize: number;
  private lastFinalUpdateId?: number;
  private synchronized = false;
  /** Per Binance futures book sync: first diff after REST must overlap `[U,u]` with snapshot `lastUpdateId`. */
  private snapshotAnchorId: number | undefined = undefined;
  private awaitingSnapshotBridge = false;
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
    this.snapshotAnchorId = raw.lastUpdateId;
    this.awaitingSnapshotBridge = true;
    this.synchronized = true;
    this.lastAppliedMonotonicMs = monotonicNowMs();
    return this.currentSnapshot(undefined);
  }

  applyDiff(evt: DepthDiffEvent): DepthApplyResult {
    if (!this.synchronized || this.lastFinalUpdateId === undefined) {
      return { kind: "ignored" };
    }

    if (this.awaitingSnapshotBridge && this.snapshotAnchorId !== undefined) {
      const L = this.snapshotAnchorId;
      if (evt.finalUpdateId < L) {
        return { kind: "ignored" };
      }
      const overlaps = evt.firstUpdateId <= L && evt.finalUpdateId >= L;
      if (!overlaps) {
        if (evt.firstUpdateId > L) {
          this.synchronized = false;
          this.awaitingSnapshotBridge = false;
          this.snapshotAnchorId = undefined;
          return { kind: "gap" };
        }
        return { kind: "ignored" };
      }
      applyNumericLevels(this.bids, evt.bids);
      applyNumericLevels(this.asks, evt.asks);
      this.lastFinalUpdateId = evt.finalUpdateId;
      this.awaitingSnapshotBridge = false;
      this.snapshotAnchorId = undefined;
      this.lastAppliedMonotonicMs = monotonicNowMs();
      return { kind: "updated", snapshot: this.currentSnapshot(evt.eventTimeMs) };
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
      this.awaitingSnapshotBridge = false;
      this.snapshotAnchorId = undefined;
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

  /** While awaiting the post-snapshot bridge diff, returns REST `lastUpdateId`; otherwise `undefined`. */
  getBridgeAnchorWhenAwaiting(): number | undefined {
    if (!this.awaitingSnapshotBridge || this.snapshotAnchorId === undefined) return undefined;
    return this.snapshotAnchorId;
  }

  /** Drop synchronized state after an unrecoverable sequence error (adapter schedules REST resync). */
  forceDesyncForGap(): void {
    this.synchronized = false;
    this.awaitingSnapshotBridge = false;
    this.snapshotAnchorId = undefined;
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
