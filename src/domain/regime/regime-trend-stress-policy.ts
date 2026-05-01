import type { AppConfig } from "../../config/schema.js";
import { detectTrendStress } from "./regime-flags.js";
import type { RegimeStress } from "./regime-flags.js";
import { DEFAULT_REGIME_TREND_STRESS } from "./live-regime-thresholds.js";

export type RegimeTrendStressPolicy = AppConfig["quoting"]["regimeTrendStressPolicy"];

export type RegimeTrendImpulseNormalizer = AppConfig["quoting"]["regimeTrendImpulseNormalizer"];

/**
 * Trend sample stressed: percentage drift (`none`) or |Δln mid| / σ_ln (`rv_scaled` when σ available).
 */
export function detectTrendStressSample(args: {
  readonly lastMid: number;
  readonly mid: number;
  readonly impulseNormalizer: RegimeTrendImpulseNormalizer;
  readonly rvSigmaLn: number | undefined;
  readonly rvZHalt: number;
}): RegimeStress {
  const { lastMid, mid, impulseNormalizer, rvSigmaLn, rvZHalt } = args;
  if (
    impulseNormalizer === "rv_scaled" &&
    rvSigmaLn !== undefined &&
    rvSigmaLn > 1e-18 &&
    lastMid > 0 &&
    mid > 0
  ) {
    const z = Math.abs(Math.log(mid / lastMid)) / rvSigmaLn;
    return z >= rvZHalt ? "stressed" : "normal";
  }
  return detectTrendStress(lastMid, mid, DEFAULT_REGIME_TREND_STRESS);
}

/** True when policy uses T0 (cancel working orders) before or instead of leaving stale makers. */
export function regimePolicyUsesT0Cancel(policy: RegimeTrendStressPolicy): boolean {
  return policy !== "legacy";
}

/** Whether to emit portfolio halt_request on this trend-stress sample (legacy: first breach). */
export function shouldEmitTrendHaltRequest(args: {
  readonly policy: RegimeTrendStressPolicy;
  readonly consecutiveStressedSamples: number;
  readonly persistenceN: number;
}): boolean {
  const { policy, consecutiveStressedSamples, persistenceN } = args;
  if (policy === "legacy") {
    return consecutiveStressedSamples >= 1;
  }
  return consecutiveStressedSamples >= persistenceN;
}

/** Throttle multiplier for min spread (1 = off). */
export function regimeThrottleSpreadMult(quoting: AppConfig["quoting"], throttleActive: boolean): number {
  if (!throttleActive) return 1;
  const m = quoting.regimeTrendThrottleSpreadMult;
  return Number.isFinite(m) && m >= 1 ? m : 1;
}

/**
 * Wrong-way: inventory sign opposes mid impulse (both non-zero).
 * Used for optional ladder_mvp reduce-only pass.
 */
export function isWrongWayTrendVsInventory(args: {
  readonly deltaMid: number;
  readonly netQty: number;
  readonly minAbsQty: number;
}): boolean {
  const { deltaMid, netQty, minAbsQty } = args;
  if (minAbsQty > 0 && Math.abs(netQty) < minAbsQty) return false;
  const sMid = Math.sign(deltaMid);
  const sQty = Math.sign(netQty);
  if (sMid === 0 || sQty === 0) return false;
  return sMid !== sQty;
}
