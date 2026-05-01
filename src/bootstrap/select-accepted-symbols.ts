import type {
  BootstrapExchangeContext,
  BootstrapSymbolDecision,
} from "../application/services/bootstrap-exchange.js";
import type { SymbolSpec } from "../infrastructure/binance/types.js";

/**
 * Pure filter (SPEC-03): a symbol without a decision row is treated as not accepted.
 * Call sites SHOULD log missing decisions once (see `run-trader.ts`).
 */
export function selectAcceptedSymbolSpecs(ctx: BootstrapExchangeContext): readonly SymbolSpec[] {
  const map = new Map<string, BootstrapSymbolDecision>(
    ctx.decisions.map((d) => [d.symbol, d]),
  );
  return ctx.symbols.filter((spec) => map.get(spec.symbol)?.status === "accepted");
}
