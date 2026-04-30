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
  if (i.toxicityScore >= i.toxicityTau || i.rvRegime === "stressed" || touchSpreadTicks < i.minSpreadTicks) {
    return "toxic";
  }
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
  let bid = i.touch.bestBid;
  let ask = i.touch.bestAsk;

  if (regime === "toxic") {
    bid = i.touch.bestBid - i.tickSize;
    ask = i.touch.bestAsk + i.tickSize;
  } else {
    // Prefer wider capture when benign: if touch is already wider than floor + 2, step back one tick each side.
    if (touchSpreadTicks >= i.minSpreadTicks + 2) {
      bid = i.touch.bestBid - i.tickSize;
      ask = i.touch.bestAsk + i.tickSize;
    }
  }

  // Enforce floor and tick grid.
  bid = roundToTick(bid, i.tickSize);
  ask = roundToTick(ask, i.tickSize);
  const minAsk = bid + i.minSpreadTicks * i.tickSize;
  if (ask < minAsk) {
    ask = minAsk;
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
