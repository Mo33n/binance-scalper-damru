import type { AppConfig } from "../../config/schema.js";
import { BinanceRestClient } from "../../infrastructure/binance/rest-client.js";
import { fetchExchangeInfo, buildSymbolBootstrap } from "../../infrastructure/binance/exchange-info.js";
import { fetchEffectiveFees } from "../../infrastructure/binance/fees.js";
import {
  fetchLeverageBrackets,
  chooseLeverage,
  setSymbolLeverage,
} from "../../infrastructure/binance/leverage.js";
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
  const client = new BinanceRestClient({ baseUrl: cfg.binance.restBaseUrl, log });
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
    const gate = evaluateSpreadFloor(
      s,
      fees,
      1_000,
      cfg.risk.defaultMinSpreadTicks,
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
