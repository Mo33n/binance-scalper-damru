import type { SymbolSpec } from "../../infrastructure/binance/types.js";
import type { DeRiskExitPlan } from "../../domain/quoting/execution-directive.js";
import type { QuoteIntent } from "../../domain/quoting/types.js";
import {
  normalizeOrderRequest,
  placeOrder,
  cancelOrder,
  cancelAllOrders,
  mapBinanceOrderError,
  type NewOrderRequest,
} from "../../infrastructure/binance/signed-rest-orders.js";
import type { BinanceRestClient } from "../../infrastructure/binance/rest-client.js";
import type { SignedCredentials } from "../../infrastructure/binance/signed-rest.js";
import type { LoggerPort } from "../ports/logger-port.js";

export class ClientOrderIdGenerator {
  private seq = 0;
  next(symbol: string): string {
    this.seq += 1;
    const rand = Math.floor(Math.random() * 1_000_000)
      .toString()
      .padStart(6, "0");
    return `msc-${symbol}-${String(Date.now())}-${String(this.seq)}-${rand}`.slice(0, 36);
  }
}

export class ExecutionService {
  private readonly client: BinanceRestClient;
  private readonly creds: SignedCredentials;
  private readonly idGen: ClientOrderIdGenerator;
  private readonly log: LoggerPort | undefined;

  constructor(
    client: BinanceRestClient,
    creds: SignedCredentials,
    idGen = new ClientOrderIdGenerator(),
    log?: LoggerPort,
  ) {
    this.client = client;
    this.creds = creds;
    this.idGen = idGen;
    this.log = log;
  }

  async placeFromIntent(symbol: SymbolSpec, intent: QuoteIntent): Promise<void> {
    const reqs = buildOrderRequests(symbol, intent, this.idGen);
    for (const req of reqs) {
      try {
        await placeOrder(this.client, this.creds, req);
      } catch (err) {
        const mapping = mapBinanceOrderError(err);
        this.log?.error(
          { event: "order.error", symbol: req.symbol, mapping, clientOrderId: req.clientOrderId },
          "order.error",
        );
        if (mapping.action === "Fatal") throw err;
      }
    }
  }

  async executeDeRisk(symbol: SymbolSpec, exit: DeRiskExitPlan): Promise<void> {
    const req = buildDeRiskOrderRequest(symbol, exit, this.idGen);
    try {
      await placeOrder(this.client, this.creds, req);
    } catch (err) {
      const mapping = mapBinanceOrderError(err);
      this.log?.error(
        { event: "order.error", symbol: req.symbol, mapping, clientOrderId: req.clientOrderId },
        "order.error",
      );
      if (mapping.action === "Fatal") throw err;
    }
  }

  async cancel(symbol: string, orderId: number): Promise<void> {
    await cancelOrder(this.client, this.creds, symbol, orderId);
  }

  async cancelAll(symbol: string): Promise<void> {
    await cancelAllOrders(this.client, this.creds, symbol);
  }
}

export function buildDeRiskOrderRequest(
  symbol: SymbolSpec,
  exit: DeRiskExitPlan,
  idGen: ClientOrderIdGenerator,
): NewOrderRequest {
  const base: NewOrderRequest = {
    symbol: symbol.symbol,
    side: exit.side,
    price: exit.limitPrice,
    quantity: exit.quantity,
    postOnly: exit.postOnly,
    reduceOnly: true,
    clientOrderId: idGen.next(symbol.symbol),
  };
  const withIoc: NewOrderRequest =
    exit.mode === "ioc_touch" ? { ...base, limitTimeInForce: "IOC" } : base;
  return normalizeOrderRequest(withIoc, symbol);
}

export function buildOrderRequests(
  symbol: SymbolSpec,
  intent: QuoteIntent,
  idGen: ClientOrderIdGenerator,
): NewOrderRequest[] {
  const out: NewOrderRequest[] = [];
  if (intent.bidPx !== undefined && intent.bidQty !== undefined) {
    out.push(
      normalizeOrderRequest(
        {
          symbol: symbol.symbol,
          side: "BUY",
          price: intent.bidPx,
          quantity: intent.bidQty,
          postOnly: intent.postOnly,
          reduceOnly: intent.reduceOnly,
          clientOrderId: idGen.next(symbol.symbol),
        },
        symbol,
      ),
    );
  }
  if (intent.askPx !== undefined && intent.askQty !== undefined) {
    out.push(
      normalizeOrderRequest(
        {
          symbol: symbol.symbol,
          side: "SELL",
          price: intent.askPx,
          quantity: intent.askQty,
          postOnly: intent.postOnly,
          reduceOnly: intent.reduceOnly,
          clientOrderId: idGen.next(symbol.symbol),
        },
        symbol,
      ),
    );
  }
  return out;
}
