import { applyInventorySkew } from "../liquidity/inventory-skew.js";
import type { FlattenIntent, QuoteIntent, QuotingInputs, QuotingRegime } from "./types.js";

export function roundToTick(price: number, tickSize: number): number {
  return quantize(Math.round(price / tickSize) * tickSize, tickSize);
}

export function ticksBetween(bidPx: number, askPx: number, tickSize: number): number {
  return Math.round((askPx - bidPx) / tickSize);
}

export function classifyRegime(i: QuotingInputs): QuotingRegime {
  if (i.inventoryMode === "stress") return "inventory_stress";
  const touchSpreadTicks = ticksBetween(i.touch.bestBid, i.touch.bestAsk, i.tickSize);
  /** Flow / adverse-selection proxy (VPIN + stressed RV bucket). */
  const flowToxic = i.toxicityScore >= i.toxicityTau || i.rvRegime === "stressed";
  /** Microstructure: touch tighter than quoted floor. */
  const microstructureToxic = touchSpreadTicks < i.minSpreadTicks;

  const split = i.regimeSplit;
  const mode = split?.enabled === true ? split.toxicCombineMode : "any";

  let toxic: boolean;
  switch (mode) {
    case "flow_only":
      toxic = flowToxic;
      break;
    case "microstructure_only":
      toxic = microstructureToxic;
      break;
    case "both":
      toxic = flowToxic && microstructureToxic;
      break;
    case "any":
    default:
      toxic = flowToxic || microstructureToxic;
      break;
  }

  if (toxic) return "toxic";
  return "normal";
}

/**
 * Hybrid policy:
 * - normal: at-touch or one-tick improve if spread floor still holds.
 * - toxic: one-tick off-touch.
 * - inventory_stress: no passive quote (flatten intent used by caller).
 */
export function buildHybridQuoteIntent(i: QuotingInputs): QuoteIntent {
  const regime = classifyRegime(i);
  if (regime === "inventory_stress") {
    return {
      regime,
      postOnly: false,
      reduceOnly: true,
      reason: "inventory stress requires flattening",
    };
  }

  const touchSpreadTicks = ticksBetween(i.touch.bestBid, i.touch.bestAsk, i.tickSize);
  const touchMid = (i.touch.bestBid + i.touch.bestAsk) / 2;
  const anchorMid =
    i.fairValueMode === "microprice" && i.fairMid !== undefined ? i.fairMid : touchMid;
  const anchorShift = anchorMid - touchMid;

  let bid = i.touch.bestBid + anchorShift;
  let ask = i.touch.bestAsk + anchorShift;

  if (regime === "toxic") {
    bid = i.touch.bestBid + anchorShift - i.tickSize;
    ask = i.touch.bestAsk + anchorShift + i.tickSize;
  } else {
    // Prefer wider capture when benign: if touch is already wider than floor + 2, step back one tick each side.
    if (touchSpreadTicks >= i.minSpreadTicks + 2) {
      bid = i.touch.bestBid + anchorShift - i.tickSize;
      ask = i.touch.bestAsk + anchorShift + i.tickSize;
    }
  }

  // Enforce floor and tick grid.
  bid = roundToTick(bid, i.tickSize);
  ask = roundToTick(ask, i.tickSize);
  const minAsk = bid + i.minSpreadTicks * i.tickSize;
  if (ask < minAsk) {
    ask = minAsk;
  }

  const skew = i.inventorySkew;
  if (skew?.enabled === true) {
    const shifted = applyInventorySkew({
      netQty: skew.netQty,
      maxAbsQty: skew.maxAbsQty,
      kappaTicks: skew.kappaTicks,
      tickSize: i.tickSize,
      bidPx: bid,
      askPx: ask,
      ...(skew.maxShiftTicks !== undefined ? { maxShiftTicks: skew.maxShiftTicks } : {}),
    });
    bid = shifted.bidPx;
    ask = shifted.askPx;
  }

  return {
    regime,
    bidPx: bid,
    askPx: ask,
    bidQty: i.baseOrderQty,
    askQty: i.baseOrderQty,
    postOnly: true,
    reduceOnly: false,
    reason: regime === "toxic" ? "toxic regime widen/off-touch" : "normal regime quoting",
  };
}

export function buildFlattenIntent(side: "buy" | "sell", quantity: number, reason: string): FlattenIntent {
  return {
    side,
    quantity,
    reduceOnly: true,
    aggressive: true,
    reason,
  };
}

function quantize(value: number, step: number): number {
  const decimals = stepDecimals(step);
  return Number(value.toFixed(decimals));
}

function stepDecimals(step: number): number {
  const s = step.toString();
  const idx = s.indexOf(".");
  return idx === -1 ? 0 : s.length - idx - 1;
}
