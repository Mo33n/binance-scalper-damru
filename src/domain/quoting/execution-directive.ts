/**
 * RFC — inventory de-risk: single decision point for quote vs reduce-only exit.
 * Pure domain — no I/O.
 */
import { buildHybridQuoteIntent, roundToTick } from "./hybrid-quoting.js";
import type { QuoteIntent, QuotingInputs, InventoryMode, SymbolExecutionConstraints } from "./types.js";

/** Mirrors `AppConfig["risk"]` de-risk slice — keep narrow to avoid config coupling in tests. */
export type DeRiskRiskConfig = {
  readonly deRiskMode: "off" | "passive_touch" | "ioc_touch";
};

export type ExecutionFeaturesSlice = {
  readonly inventoryDeRiskEnabled: boolean;
};

export type DeRiskMode = DeRiskRiskConfig["deRiskMode"];

export type DeRiskExitPlan = {
  readonly side: "BUY" | "SELL";
  readonly quantity: number;
  readonly limitPrice: number;
  readonly mode: Exclude<DeRiskMode, "off">;
  readonly postOnly: boolean;
  readonly reduceOnly: true;
  readonly reason: string;
};

export type ExecutionDirective =
  | { readonly kind: "quote"; readonly intent: QuoteIntent }
  | { readonly kind: "de_risk"; readonly exit: DeRiskExitPlan }
  | { readonly kind: "stress_suppressed"; readonly reason: "de_risk_mode_off" }
  | { readonly kind: "de_risk_unfillable"; readonly reason: "flat" | "dust" };

function floorToStepSize(qty: number, stepSize: number): number {
  const raw = Math.floor(qty / stepSize) * stepSize;
  const decimals = stepDecimals(stepSize);
  return Number(raw.toFixed(decimals));
}

function stepDecimals(step: number): number {
  const s = step.toString();
  const idx = s.indexOf(".");
  return idx === -1 ? 0 : s.length - idx - 1;
}

/**
 * Build reduce-only exit at touch: long → limit sell at best ask; short → limit buy at best bid.
 */
export function buildDeRiskExitPlan(args: {
  readonly spec: SymbolExecutionConstraints;
  readonly touch: { readonly bestBid: number; readonly bestAsk: number };
  readonly netQty: number;
  readonly mode: Exclude<DeRiskMode, "off">;
}): { readonly ok: true; readonly exit: DeRiskExitPlan } | { readonly ok: false; readonly reason: "flat" | "dust" } {
  const { spec, touch, netQty, mode } = args;
  const abs = Math.abs(netQty);
  const q = floorToStepSize(abs, spec.stepSize);
  if (q <= 0) {
    return { ok: false, reason: "flat" };
  }

  const tickSize = spec.tickSize;
  let side: "BUY" | "SELL";
  let limitPrice: number;
  if (netQty > 0) {
    side = "SELL";
    limitPrice = roundToTick(touch.bestAsk, tickSize);
  } else {
    side = "BUY";
    limitPrice = roundToTick(touch.bestBid, tickSize);
  }

  const notional = q * limitPrice * spec.contractSize;
  if (notional < spec.minNotional) {
    return { ok: false, reason: "dust" };
  }

  const postOnly = mode === "passive_touch";
  return {
    ok: true,
    exit: {
      side,
      quantity: q,
      limitPrice,
      mode,
      postOnly,
      reduceOnly: true,
      reason: "inventory stress de-risk",
    },
  };
}

/**
 * When ledger reports stress but this symbol has no net, hybrid would emit empty `inventory_stress`.
 * For global-only breach, continue two-sided quoting on this symbol by masking inventory mode.
 */
function hybridInputsForExecution(
  base: QuotingInputs,
  inventoryMode: InventoryMode,
  symbolNetQty: number,
): QuotingInputs {
  if (inventoryMode === "stress" && symbolNetQty === 0) {
    return { ...base, inventoryMode: "normal" };
  }
  return { ...base, inventoryMode };
}

export function resolveExecutionDirective(args: {
  readonly inventoryMode: InventoryMode;
  readonly features: ExecutionFeaturesSlice;
  readonly risk: DeRiskRiskConfig;
  readonly hybridInputs: QuotingInputs;
  readonly symbolNetQty: number;
  readonly spec: SymbolExecutionConstraints;
  readonly touch: { readonly bestBid: number; readonly bestAsk: number };
}): ExecutionDirective {
  const { inventoryMode, features, risk, hybridInputs, symbolNetQty: netQty, spec, touch } = args;

  if (inventoryMode !== "stress") {
    return { kind: "quote", intent: buildHybridQuoteIntent(hybridInputsForExecution(hybridInputs, inventoryMode, netQty)) };
  }

  if (features.inventoryDeRiskEnabled && risk.deRiskMode === "off") {
    return { kind: "stress_suppressed", reason: "de_risk_mode_off" };
  }

  if (features.inventoryDeRiskEnabled && risk.deRiskMode !== "off") {
    const built = buildDeRiskExitPlan({
      spec,
      touch,
      netQty,
      mode: risk.deRiskMode,
    });
    if (!built.ok) {
      return { kind: "de_risk_unfillable", reason: built.reason };
    }
    return { kind: "de_risk", exit: built.exit };
  }

  return {
    kind: "quote",
    intent: buildHybridQuoteIntent(hybridInputsForExecution(hybridInputs, inventoryMode, netQty)),
  };
}
