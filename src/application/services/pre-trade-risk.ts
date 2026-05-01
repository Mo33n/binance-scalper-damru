import type { AppConfig } from "../../config/schema.js";
import type { QuoteIntent } from "../../domain/quoting/types.js";
import type { SymbolSpec } from "../../infrastructure/binance/types.js";
import type { PositionLedger } from "./position-ledger.js";

export function canPlaceQuoteIntent(args: {
  readonly intent: QuoteIntent;
  readonly ledger: PositionLedger;
  readonly cfg: AppConfig["risk"];
  readonly spec: SymbolSpec;
}): { ok: true } | { ok: false; reason: string } {
  const { intent, ledger, cfg, spec } = args;
  const symbol = spec.symbol;
  const net = ledger.getPosition(symbol).netQty;
  const cs = spec.contractSize;

  if (intent.bidQty !== undefined && intent.bidPx !== undefined) {
    const q = intent.bidQty;
    const px = intent.bidPx;
    const nextNet = net + q;
    if (Math.abs(nextNet) > cfg.maxAbsQty) {
      return { ok: false, reason: "bid_would_exceed_max_abs_qty" };
    }
    const notional = Math.abs(q * px * cs);
    if (notional > cfg.maxAbsNotional) {
      return { ok: false, reason: "bid_exceeds_max_abs_notional" };
    }
  }

  if (intent.askQty !== undefined && intent.askPx !== undefined) {
    const q = intent.askQty;
    const px = intent.askPx;
    const nextNet = net - q;
    if (Math.abs(nextNet) > cfg.maxAbsQty) {
      return { ok: false, reason: "ask_would_exceed_max_abs_qty" };
    }
    const notional = Math.abs(q * px * cs);
    if (notional > cfg.maxAbsNotional) {
      return { ok: false, reason: "ask_exceeds_max_abs_notional" };
    }
  }

  /** Cross-symbol `globalMaxAbsNotional` — SPEC-06 defers full aggregator; ledger stress still gates via inventory. */
  return { ok: true };
}
