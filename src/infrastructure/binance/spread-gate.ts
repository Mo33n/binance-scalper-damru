import type { EffectiveFees, SymbolSpec } from "./types.js";

export type SpreadGateDecision =
  | { readonly outcome: "pass"; readonly minSpreadTicks: number; readonly details: string }
  | { readonly outcome: "adjustTicks"; readonly minSpreadTicks: number; readonly details: string }
  | { readonly outcome: "exclude"; readonly minSpreadTicks: number; readonly details: string };

/**
 * Quote tick value at reference price using contractSize (linear perps assumption in this RFC project).
 * For USD-M linear contracts, one tick quote move ~= tickSize * contractSize * quantity.
 */
export function tickValueQuoteAtPrice(
  symbol: SymbolSpec,
  _referencePrice: number,
  quantity = 1,
): number {
  return symbol.tickSize * symbol.contractSize * quantity;
}

export function evaluateSpreadFloor(
  symbol: SymbolSpec,
  fees: EffectiveFees,
  referencePrice: number,
  configuredMinSpreadTicks: number,
  feeSafetyBufferBps: number,
): SpreadGateDecision {
  const tickValue = tickValueQuoteAtPrice(symbol, referencePrice);
  const roundTripFeeQuote = referencePrice * (fees.makerRate * 2);
  const safetyBufferQuote = referencePrice * (feeSafetyBufferBps / 10_000);
  const requiredEdgeQuote = roundTripFeeQuote + safetyBufferQuote;
  const availableEdgeQuote = configuredMinSpreadTicks * tickValue;

  if (availableEdgeQuote >= requiredEdgeQuote) {
    return {
      outcome: "pass",
      minSpreadTicks: configuredMinSpreadTicks,
      details: "configured spread covers modeled fees+bps buffer",
    };
  }

  const neededTicks = Math.ceil(requiredEdgeQuote / tickValue);
  if (!Number.isFinite(neededTicks) || neededTicks > configuredMinSpreadTicks * 4) {
    return {
      outcome: "exclude",
      minSpreadTicks: configuredMinSpreadTicks,
      details: "required spread too high for configured floor",
    };
  }

  return {
    outcome: "adjustTicks",
    minSpreadTicks: Math.max(configuredMinSpreadTicks, neededTicks),
    details: "raise min spread ticks to pass fee gate",
  };
}
