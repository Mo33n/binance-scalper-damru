import type { TapeTrade } from "../../domain/market-data/types.js";

export interface BinanceAggTradeRaw {
  readonly e?: string;
  readonly E: number;
  readonly s: string;
  readonly a: number;
  readonly p: string;
  readonly q: string;
  readonly m: boolean;
}

/**
 * Binance agg trade `m=true` means buyer is maker => aggressive side is sell.
 */
export function parseAggTrade(raw: BinanceAggTradeRaw): TapeTrade {
  const price = Number(raw.p);
  const quantity = Number(raw.q);
  if (!Number.isFinite(price) || !Number.isFinite(quantity)) {
    throw new Error("Invalid agg trade payload");
  }
  return {
    symbol: raw.s,
    tradeId: raw.a,
    price,
    quantity,
    side: raw.m ? "sell" : "buy",
    eventTimeMs: raw.E,
  };
}
