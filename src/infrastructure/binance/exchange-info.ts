import { BinanceRestClient } from "./rest-client.js";
import type { ExchangeBootstrapResult, SymbolSpec } from "./types.js";

interface BinanceFilter {
  readonly filterType: string;
  readonly tickSize?: string;
  readonly stepSize?: string;
  readonly minNotional?: string;
  readonly notional?: string;
}

interface BinanceSymbolRaw {
  readonly symbol: string;
  readonly status: string;
  readonly contractType?: string;
  readonly contractSize?: string;
  readonly filters: readonly BinanceFilter[];
}

interface ExchangeInfoRaw {
  readonly symbols: readonly BinanceSymbolRaw[];
}

export async function fetchExchangeInfo(client: BinanceRestClient): Promise<ExchangeInfoRaw> {
  return client.requestJson<ExchangeInfoRaw>({ path: "/fapi/v1/exchangeInfo" });
}

export function buildSymbolBootstrap(
  info: ExchangeInfoRaw,
  requestedSymbols: readonly string[],
): ExchangeBootstrapResult {
  const bySymbol = new Map(info.symbols.map((s) => [s.symbol, s]));
  const accepted: SymbolSpec[] = [];
  const rejected: { symbol: string; reason: "NOT_LISTED" | "NOT_TRADING" | "INVALID_FILTERS"; message: string }[] = [];

  for (const symbol of requestedSymbols) {
    const raw = bySymbol.get(symbol);
    if (raw === undefined) {
      rejected.push({ symbol, reason: "NOT_LISTED", message: "symbol not listed on exchangeInfo" });
      continue;
    }
    if (raw.status !== "TRADING") {
      rejected.push({ symbol, reason: "NOT_TRADING", message: `symbol status=${raw.status}` });
      continue;
    }
    const spec = parseSymbolSpec(raw);
    if (spec === undefined) {
      rejected.push({ symbol, reason: "INVALID_FILTERS", message: "required filters missing/invalid" });
      continue;
    }
    accepted.push(spec);
  }

  return { accepted, rejected };
}

export function parseSymbolSpec(raw: BinanceSymbolRaw): SymbolSpec | undefined {
  const priceFilter = raw.filters.find((f) => f.filterType === "PRICE_FILTER");
  const lotFilter = raw.filters.find((f) => f.filterType === "LOT_SIZE");
  const minNotionalFilter = raw.filters.find(
    (f) => f.filterType === "MIN_NOTIONAL" || f.filterType === "NOTIONAL",
  );
  const tickSize = Number(priceFilter?.tickSize);
  const stepSize = Number(lotFilter?.stepSize);
  const minNotional = Number(minNotionalFilter?.minNotional ?? minNotionalFilter?.notional);
  const contractSize = Number(raw.contractSize ?? "1");

  if (
    !Number.isFinite(tickSize) ||
    !Number.isFinite(stepSize) ||
    !Number.isFinite(minNotional) ||
    !Number.isFinite(contractSize) ||
    tickSize <= 0 ||
    stepSize <= 0 ||
    minNotional <= 0 ||
    contractSize <= 0
  ) {
    return undefined;
  }

  const base = {
    symbol: raw.symbol,
    status: raw.status,
    tickSize,
    stepSize,
    minNotional,
    contractSize,
  };
  return raw.contractType === undefined
    ? Object.freeze(base)
    : Object.freeze({ ...base, contractType: raw.contractType });
}
