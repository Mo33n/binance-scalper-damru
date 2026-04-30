import type { BookSnapshot } from "../market-data/types.js";

export type RegimeStress = "normal" | "stressed";

export interface RegimeConfig {
  readonly slopeTau: number;
  readonly maxSpreadTicks: number;
  readonly minTopQty: number;
}

export function detectTrendStress(lastMid: number, nextMid: number, cfg: RegimeConfig): RegimeStress {
  const drift = Math.abs(nextMid - lastMid) / Math.max(1e-12, lastMid);
  return drift >= cfg.slopeTau ? "stressed" : "normal";
}

export function shouldHaltForBook(snapshot: BookSnapshot, cfg: RegimeConfig): boolean {
  const spread = snapshot.spreadTicks ?? Number.POSITIVE_INFINITY;
  const bestBidQty = snapshot.bestBid?.qty ?? 0;
  const bestAskQty = snapshot.bestAsk?.qty ?? 0;
  if (spread > cfg.maxSpreadTicks) return true;
  if (bestBidQty < cfg.minTopQty || bestAskQty < cfg.minTopQty) return true;
  return false;
}
