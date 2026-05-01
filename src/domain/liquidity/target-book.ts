/**
 * Target book + OMS diff (RFC P2).
 *
 * **v1 assumption:** at most one resting maker bid and one maker ask per symbol (Binance may return more;
 * extras are cancelled first). Price/qty equality uses strict numeric match — callers must align to tick/step.
 */
import type { QuoteIntent } from "../quoting/types.js";

export type OrderSide = "BUY" | "SELL";

/** Normalized working order for diff (USD-M LIMIT resting leg). */
export interface OpenOrderView {
  readonly orderId: number;
  readonly side: OrderSide;
  readonly price: number;
  /** Remaining quantity (base asset). */
  readonly quantity: number;
}

export interface TargetLeg {
  readonly price: number;
  readonly quantity: number;
  readonly postOnly: boolean;
  readonly reduceOnly: boolean;
}

export interface TargetBook {
  readonly bid?: TargetLeg;
  readonly ask?: TargetLeg;
}

export interface PlaceLegInstruction {
  readonly side: OrderSide;
  readonly price: number;
  readonly quantity: number;
  readonly postOnly: boolean;
  readonly reduceOnly: boolean;
}

export interface PlacementPlan {
  readonly cancelOrderIds: readonly number[];
  readonly placeLegs: readonly PlaceLegInstruction[];
}

export function quoteIntentToTargetBook(intent: QuoteIntent): TargetBook {
  const bid =
    intent.bidPx !== undefined && intent.bidQty !== undefined
      ? {
          price: intent.bidPx,
          quantity: intent.bidQty,
          postOnly: intent.postOnly,
          reduceOnly: intent.reduceOnly,
        }
      : undefined;
  const ask =
    intent.askPx !== undefined && intent.askQty !== undefined
      ? {
          price: intent.askPx,
          quantity: intent.askQty,
          postOnly: intent.postOnly,
          reduceOnly: intent.reduceOnly,
        }
      : undefined;
  return {
    ...(bid !== undefined ? { bid } : {}),
    ...(ask !== undefined ? { ask } : {}),
  };
}

function pickPrimaryBid(working: readonly OpenOrderView[]): OpenOrderView | undefined {
  const buys = working.filter((o) => o.side === "BUY");
  if (buys.length === 0) return undefined;
  return buys.reduce((a, b) => (a.price >= b.price ? a : b));
}

function pickPrimaryAsk(working: readonly OpenOrderView[]): OpenOrderView | undefined {
  const sells = working.filter((o) => o.side === "SELL");
  if (sells.length === 0) return undefined;
  return sells.reduce((a, b) => (a.price <= b.price ? a : b));
}

function legMatches(target: TargetLeg, open: OpenOrderView): boolean {
  return target.price === open.price && target.quantity === open.quantity;
}

function toPlace(side: OrderSide, leg: TargetLeg): PlaceLegInstruction {
  return {
    side,
    price: leg.price,
    quantity: leg.quantity,
    postOnly: leg.postOnly,
    reduceOnly: leg.reduceOnly,
  };
}

function dedupeIds(ids: readonly number[]): number[] {
  return [...new Set(ids)];
}

/**
 * Diff target maker book vs working LIMIT orders (one bid / one ask aggregate view).
 */
export function diffTargetVsWorking(target: TargetBook, working: readonly OpenOrderView[]): PlacementPlan {
  const cancelOrderIds: number[] = [];
  const placeLegs: PlaceLegInstruction[] = [];

  const bidPick = pickPrimaryBid(working);
  const askPick = pickPrimaryAsk(working);

  for (const o of working) {
    if (o.side === "BUY") {
      if (bidPick === undefined || o.orderId !== bidPick.orderId) {
        cancelOrderIds.push(o.orderId);
      }
    } else {
      if (askPick === undefined || o.orderId !== askPick.orderId) {
        cancelOrderIds.push(o.orderId);
      }
    }
  }

  if (target.bid !== undefined) {
    if (bidPick === undefined) {
      placeLegs.push(toPlace("BUY", target.bid));
    } else if (!legMatches(target.bid, bidPick)) {
      cancelOrderIds.push(bidPick.orderId);
      placeLegs.push(toPlace("BUY", target.bid));
    }
  } else if (bidPick !== undefined) {
    cancelOrderIds.push(bidPick.orderId);
  }

  if (target.ask !== undefined) {
    if (askPick === undefined) {
      placeLegs.push(toPlace("SELL", target.ask));
    } else if (!legMatches(target.ask, askPick)) {
      cancelOrderIds.push(askPick.orderId);
      placeLegs.push(toPlace("SELL", target.ask));
    }
  } else if (askPick !== undefined) {
    cancelOrderIds.push(askPick.orderId);
  }

  return {
    cancelOrderIds: dedupeIds(cancelOrderIds),
    placeLegs,
  };
}
