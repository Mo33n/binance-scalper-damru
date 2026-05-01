import type { FairValueMode } from "../quoting/types.js";

export interface TouchTop {
  readonly bestBid: number;
  readonly bestAsk: number;
}

export interface FairValueQuote {
  readonly mode: FairValueMode;

  readonly touchMid: number;
  /** Active anchor mid used for quote construction (`fairMid` when microprice; else touch mid). */
  readonly anchorMid: number;
}

export function computeTouchMid(touch: TouchTop): number {
  return (touch.bestBid + touch.bestAsk) / 2;
}

export interface TopOfBookSide {
  readonly price: number;
  readonly qty: number;
}

/**
 * Microprice at L1: \((P_{ask} Q_{bid} + P_{bid} Q_{ask}) / (Q_{bid} + Q_{ask})\).
 * Zero or invalid depth falls back to touch mid (same formula collapses to mid when symmetric).
 */
export function computeMicroprice(topBid: TopOfBookSide, topAsk: TopOfBookSide): number {
  const qb = topBid.qty;
  const qa = topAsk.qty;
  if (!(qb > 0) || !(qa > 0) || !Number.isFinite(qb) || !Number.isFinite(qa)) {
    return computeTouchMid({ bestBid: topBid.price, bestAsk: topAsk.price });
  }
  return (topAsk.price * qb + topBid.price * qa) / (qb + qa);
}

export function buildFairValueQuote(args: {
  readonly mode: FairValueMode;
  readonly touch: TouchTop;
  readonly topBid?: TopOfBookSide;
  readonly topAsk?: TopOfBookSide;
}): FairValueQuote {
  const touchMid = computeTouchMid(args.touch);
  if (args.mode !== "microprice") {
    return { mode: args.mode, touchMid, anchorMid: touchMid };
  }
  if (args.topBid !== undefined && args.topAsk !== undefined) {
    return {
      mode: "microprice",
      touchMid,
      anchorMid: computeMicroprice(args.topBid, args.topAsk),
    };
  }
  return { mode: "microprice", touchMid, anchorMid: touchMid };
}
