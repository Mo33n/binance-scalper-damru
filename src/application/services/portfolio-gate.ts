import type { PositionLedger } from "./position-ledger.js";
import type { SymbolSpec } from "../../infrastructure/binance/types.js";

/** β vs reference notional (e.g. BTC); defaults to 1 when unknown or map absent. */
export function resolveBetaToRef(
  symbol: string,
  betaToRef: Readonly<Record<string, number>> | undefined,
): number {
  if (betaToRef === undefined) return 1;
  const b = betaToRef[symbol];
  return typeof b === "number" && Number.isFinite(b) && b > 0 ? b : 1;
}

export function quoteLegNotionalUsdM(params: {
  readonly qty: number;
  readonly px: number;
  readonly contractSize: number;
}): number {
  return Math.abs(params.qty * params.px * params.contractSize);
}

function resolveSpec(
  symbol: string,
  specs: ReadonlyMap<string, SymbolSpec> | Readonly<Record<string, SymbolSpec>>,
): SymbolSpec | undefined {
  if (specs instanceof Map) return specs.get(symbol);
  const o = specs as Readonly<Record<string, SymbolSpec>>;
  return Object.prototype.hasOwnProperty.call(o, symbol) ? o[symbol] : undefined;
}

/**
 * Global gross: Σ |qᵢ| · markᵢ · contractSizeᵢ (USD-M quote notional).
 * Projected gross adds **both** new passive legs for the current quote symbol (worst case both fill).
 */
export function evaluateGlobalPortfolioGate(args: {
  readonly symbols: readonly string[];
  readonly ledger: PositionLedger;
  readonly marks: Readonly<Record<string, number | undefined>>;
  readonly specs: ReadonlyMap<string, SymbolSpec> | Readonly<Record<string, SymbolSpec>>;
  readonly globalMaxAbsNotional: number;
  readonly quoteSymbol: string;
  readonly intentBid?: { readonly qty: number; readonly px: number };
  readonly intentAsk?: { readonly qty: number; readonly px: number };
  /** When set, gross = Σ |q|·mark·cs·β(symbol); intent add scaled by β(quoteSymbol). */
  readonly betaPortfolio?: {
    readonly enabled: boolean;
    readonly betaToRef: Readonly<Record<string, number>>;
  };
}): {
  readonly ok: boolean;
  readonly currentGross: number;
  readonly projectedGross: number;
  readonly cap: number;
} {
  const betaOn = args.betaPortfolio?.enabled === true;
  const betaMap = args.betaPortfolio?.betaToRef;

  let currentGross = 0;
  for (const sym of args.symbols) {
    const spec = resolveSpec(sym, args.specs);
    const mark = args.marks[sym];
    if (spec === undefined || mark === undefined || !Number.isFinite(mark)) continue;
    const absQty = Math.abs(args.ledger.getPosition(sym).netQty);
    const raw = absQty * mark * spec.contractSize;
    const b = betaOn ? resolveBetaToRef(sym, betaMap) : 1;
    currentGross += raw * b;
  }

  const quoteSpec = resolveSpec(args.quoteSymbol, args.specs);
  const quoteMark = args.marks[args.quoteSymbol];
  let intentAdd = 0;
  if (
    quoteSpec !== undefined &&
    quoteMark !== undefined &&
    Number.isFinite(quoteMark) &&
    quoteSpec.contractSize > 0
  ) {
    const cs = quoteSpec.contractSize;
    if (args.intentBid !== undefined) {
      intentAdd += quoteLegNotionalUsdM({
        qty: args.intentBid.qty,
        px: args.intentBid.px,
        contractSize: cs,
      });
    }
    if (args.intentAsk !== undefined) {
      intentAdd += quoteLegNotionalUsdM({
        qty: args.intentAsk.qty,
        px: args.intentAsk.px,
        contractSize: cs,
      });
    }
    if (betaOn) {
      intentAdd *= resolveBetaToRef(args.quoteSymbol, betaMap);
    }
  }

  const projectedGross = currentGross + intentAdd;
  const cap = args.globalMaxAbsNotional;
  const ok = projectedGross <= cap + 1e-9;

  return { ok, currentGross, projectedGross, cap };
}
