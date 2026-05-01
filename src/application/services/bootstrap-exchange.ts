import type { AppConfig } from "../../config/schema.js";
import { resolveBootstrapMinSpreadTicks } from "../../config/resolve-bootstrap-min-spread-ticks.js";
import { createRateLimitedBinanceRestClient } from "./rate-limited-binance-rest-client.js";
import { monotonicNowMs } from "../../shared/monotonic.js";
import { fetchExchangeInfo, buildSymbolBootstrap } from "../../infrastructure/binance/exchange-info.js";
import { fetchEffectiveFees } from "../../infrastructure/binance/fees.js";
import {
  fetchLeverageBrackets,
  chooseLeverage,
  setSymbolLeverage,
} from "../../infrastructure/binance/leverage.js";
import type { BinanceRestClient } from "../../infrastructure/binance/rest-client.js";
import { evaluateSpreadFloor } from "../../infrastructure/binance/spread-gate.js";
import type { LoggerPort } from "../ports/logger-port.js";
import type { EffectiveFees, SymbolSpec } from "../../infrastructure/binance/types.js";

export interface BootstrapSymbolDecision {
  readonly symbol: string;
  readonly status: "accepted" | "rejected";
  readonly reason?: string;
  readonly effectiveMinSpreadTicks?: number;
  readonly chosenLeverage?: number;
}

export interface BootstrapExchangeContext {
  readonly symbols: readonly SymbolSpec[];
  readonly fees: EffectiveFees;
  readonly decisions: readonly BootstrapSymbolDecision[];
}

export async function bootstrapExchangeContext(
  cfg: AppConfig,
  log: LoggerPort,
): Promise<BootstrapExchangeContext> {
  const client = createRateLimitedBinanceRestClient({ baseUrl: cfg.binance.restBaseUrl, log }, () =>
    monotonicNowMs(),
  );
  const info = await fetchExchangeInfo(client);
  const bootstrap = buildSymbolBootstrap(info, cfg.symbols);
  for (const reject of bootstrap.rejected) {
    log.warn({ event: "bootstrap.symbol.rejected", ...reject }, reject.message);
  }

  const creds = cfg.credentials.apiKey && cfg.credentials.apiSecret
    ? { apiKey: cfg.credentials.apiKey, apiSecret: cfg.credentials.apiSecret }
    : undefined;
  const fees =
    creds === undefined
      ? Object.freeze({
          makerRate: 0.0002,
          takerRate: 0.0005,
          bnbDiscountEnabled: false,
          asOfIso: new Date().toISOString(),
        })
      : await fetchEffectiveFees(client, creds, cfg.symbols[0] ?? "BTCUSDT");

  const leverageBrackets =
    creds === undefined
      ? new Map<string, readonly { notionalCap: number; initialLeverage: number }[]>()
      : await fetchLeverageBrackets(client, creds);

  const decisions: BootstrapSymbolDecision[] = [...bootstrap.rejected].map((r) => ({
    symbol: r.symbol,
    status: "rejected",
    reason: r.reason,
  }));
  const acceptedSymbols: SymbolSpec[] = [];

  for (const s of bootstrap.accepted) {
    const refPx = await fetchSpreadGateReferencePrice(client, s.symbol);
    const gate = evaluateSpreadFloor(
      s,
      fees,
      refPx,
      resolveBootstrapMinSpreadTicks(cfg, s.symbol),
      cfg.binance.feeSafetyBufferBps,
    );
    if (gate.outcome === "exclude") {
      decisions.push({
        symbol: s.symbol,
        status: "rejected",
        reason: "FEE_GATE_EXCLUDE",
      });
      log.warn(
        { event: "bootstrap.symbol.rejected", symbol: s.symbol, details: gate.details },
        gate.details,
      );
      continue;
    }

    const brackets = leverageBrackets.get(s.symbol) ?? [{ notionalCap: Infinity, initialLeverage: cfg.risk.maxDesiredLeverage }];
    const chosen = chooseLeverage(
      cfg.risk.maxDesiredLeverage,
      cfg.risk.riskMaxLeverage,
      brackets,
      cfg.risk.maxOpenNotionalQuote,
    );
    if (creds !== undefined) {
      await setSymbolLeverage(client, creds, s.symbol, chosen);
    }

    acceptedSymbols.push(s);
    decisions.push({
      symbol: s.symbol,
      status: "accepted",
      effectiveMinSpreadTicks: gate.minSpreadTicks,
      chosenLeverage: chosen,
    });
    log.info(
      {
        event: "bootstrap.symbol.accepted",
        symbol: s.symbol,
        minSpreadTicks: gate.minSpreadTicks,
        chosenLeverage: chosen,
      },
      "bootstrap.symbol.accepted",
    );
  }

  return Object.freeze({ symbols: acceptedSymbols, fees, decisions });
}

/** Mark-price–consistent fee/spread gate input (USD-M linear); falls back if ticker fails. */
async function fetchSpreadGateReferencePrice(
  client: BinanceRestClient,
  symbol: string,
): Promise<number> {
  try {
    const row = await client.requestJson<{ price?: string }>({
      path: "/fapi/v1/ticker/price",
      query: { symbol },
    });
    const p = Number(row.price);
    if (Number.isFinite(p) && p > 0) return p;
  } catch {
    /* ignore — bootstrap continues with conservative default */
  }
  return 1000;
}
