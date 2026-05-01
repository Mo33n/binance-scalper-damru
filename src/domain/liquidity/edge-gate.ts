import type { EffectiveFees } from "../../infrastructure/binance/types.js";

/**
 * Maker fee hurdle in basis points (before λ·σ and floor).
 * RFC §4.3.5 — passive capture must clear maker fees at minimum.
 */
export function computeMakerEdgeBps(fees: EffectiveFees): number {
  return fees.makerRate * 10_000;
}

/**
 * Full hurdle in bps: maker fee (as bps) + λ·σ (σ optional, same scale as fractional rates) + floor.
 * σ is typically EWMA √variance of log-mid from `SignalEngine.getRvEwmaSigmaLn()` when RV enabled.
 */
export function computeHurdleBps(params: {
  readonly fees: EffectiveFees;
  readonly lambdaSigma: number;
  readonly sigmaLn?: number;
  readonly minEdgeBpsFloor: number;
}): number {
  const sigma = params.sigmaLn ?? 0;
  return (
    computeMakerEdgeBps(params.fees) +
    params.lambdaSigma * sigma * 10_000 +
    params.minEdgeBpsFloor
  );
}

function halfSpreadBidBps(mid: number, bidPx: number): number {
  return ((mid - bidPx) / mid) * 10_000;
}

function halfSpreadAskBps(mid: number, askPx: number): number {
  return ((askPx - mid) / mid) * 10_000;
}

/**
 * RFC §4.3.5 — per passive leg, half-spread capture (bps) must meet hurdle.
 * Returns half-spreads as **positive** when prices are inside the touch (capture ≥ 0).
 */
export function passesEdgeGate(params: {
  readonly fees: EffectiveFees;
  readonly mid: number;
  readonly bidPx?: number;
  readonly askPx?: number;
  readonly sigmaLn?: number;
  readonly lambdaSigma: number;
  readonly minEdgeBpsFloor: number;
}): {
  readonly ok: boolean;
  readonly bidHalfSpreadBps: number;
  readonly askHalfSpreadBps: number;
  readonly hurdleBps: number;
} {
  const hurdleBps = computeHurdleBps({
    fees: params.fees,
    lambdaSigma: params.lambdaSigma,
    minEdgeBpsFloor: params.minEdgeBpsFloor,
    ...(params.sigmaLn !== undefined ? { sigmaLn: params.sigmaLn } : {}),
  });

  if (!Number.isFinite(params.mid) || params.mid <= 0) {
    return {
      ok: false,
      bidHalfSpreadBps: 0,
      askHalfSpreadBps: 0,
      hurdleBps,
    };
  }

  let bidHalfSpreadBps = 0;
  let askHalfSpreadBps = 0;
  let ok = true;

  if (params.bidPx !== undefined && Number.isFinite(params.bidPx)) {
    bidHalfSpreadBps = halfSpreadBidBps(params.mid, params.bidPx);
    ok = bidHalfSpreadBps >= hurdleBps;
  }
  if (params.askPx !== undefined && Number.isFinite(params.askPx)) {
    askHalfSpreadBps = halfSpreadAskBps(params.mid, params.askPx);
    ok &&= askHalfSpreadBps >= hurdleBps;
  }

  return {
    ok,
    bidHalfSpreadBps,
    askHalfSpreadBps,
    hurdleBps,
  };
}
