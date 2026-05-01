import type { AppConfig } from "../../config/schema.js";
import type { DeRiskExitPlan } from "../../domain/quoting/execution-directive.js";
import type { QuoteIntent } from "../../domain/quoting/types.js";
import type { SymbolSpec } from "../../infrastructure/binance/types.js";
import type { PositionLedger } from "./position-ledger.js";

export function canPlaceQuoteIntent(args: {
  readonly intent: QuoteIntent;
  readonly ledger: PositionLedger;
  readonly cfg: AppConfig["risk"];
  readonly spec: SymbolSpec;
  /**
   * Per-symbol quote-leg cap (USD-M quote notional) — use when scaling `risk.maxAbsNotional`
   * by β (RFC P3 beta portfolio cap).
   */
  readonly effectiveMaxAbsNotional?: number;
}): { ok: true } | { ok: false; reason: string } {
  const { intent, ledger, cfg, spec } = args;
  const symbol = spec.symbol;
  const net = ledger.getPosition(symbol).netQty;
  const cs = spec.contractSize;
  const maxAbsNotionalCap = args.effectiveMaxAbsNotional ?? cfg.maxAbsNotional;

  if (intent.bidQty !== undefined && intent.bidPx !== undefined) {
    const q = intent.bidQty;
    const px = intent.bidPx;
    const nextNet = net + q;
    if (Math.abs(nextNet) > cfg.maxAbsQty) {
      return { ok: false, reason: "bid_would_exceed_max_abs_qty" };
    }
    const notional = Math.abs(q * px * cs);
    if (notional > maxAbsNotionalCap + 1e-9) {
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
    if (notional > maxAbsNotionalCap + 1e-9) {
      return { ok: false, reason: "ask_exceeds_max_abs_notional" };
    }
  }

  /** Cross-symbol `globalMaxAbsNotional` — SPEC-06 defers full aggregator; ledger stress still gates via inventory. */
  return { ok: true };
}

/**
 * Gates reduce-only de-risk: side vs position and clip vs |net|.
 * Does **not** apply `maxAbsQty` / `maxAbsNotional` entry caps — those limit **building** exposure;
 * exits reduce risk even when the position already breaches limits (RFC inventory de-risk).
 */
export function canPlaceDeRiskExit(args: {
  readonly exit: DeRiskExitPlan;
  readonly netQty: number;
}): { ok: true } | { ok: false; reason: string } {
  const { exit, netQty } = args;
  const q = exit.quantity;
  if (netQty > 0) {
    if (exit.side !== "SELL") {
      return { ok: false, reason: "de_risk_side_mismatch_long" };
    }
    const next = netQty - q;
    if (next < -1e-12) {
      return { ok: false, reason: "de_risk_sell_exceeds_net" };
    }
  } else if (netQty < 0) {
    if (exit.side !== "BUY") {
      return { ok: false, reason: "de_risk_side_mismatch_short" };
    }
    const next = netQty + q;
    if (next > 1e-12) {
      return { ok: false, reason: "de_risk_buy_exceeds_net" };
    }
  } else {
    return { ok: false, reason: "de_risk_flat" };
  }
  return { ok: true };
}
