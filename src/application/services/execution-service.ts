import type { SymbolSpec } from "../../infrastructure/binance/types.js";
import type { DeRiskExitPlan } from "../../domain/quoting/execution-directive.js";
import type { QuoteIntent } from "../../domain/quoting/types.js";
import type { OpenOrderView, PlacementPlan } from "../../domain/liquidity/target-book.js";
import {
  normalizeOrderRequest,
  placeOrder,
  cancelOrder,
  cancelAllOrders,
  mapBinanceOrderError,
  signedListOpenOrders,
  type NewOrderRequest,
  type OrderAck,
} from "../../infrastructure/binance/signed-rest-orders.js";
import type { BinanceRestClient } from "../../infrastructure/binance/rest-client.js";
import type { SignedCredentials } from "../../infrastructure/binance/signed-rest.js";
import type { LoggerPort } from "../ports/logger-port.js";
import { mapBinanceOpenOrdersResponse } from "./open-order-mapper.js";

/** Structured reason for order REST actions — pass from orchestrator/runner for an audit trail. */
export type OrderActionContext = {
  readonly reason: string;
  readonly detail?: Record<string, unknown>;
};

export interface ExecutionServiceOptions {
  readonly log?: LoggerPort;
  /** RFC P0 — cancel first leg if second `placeOrder` fails (USD-M maker bid+ask). */
  readonly twoLegSafetyEnabled?: boolean;
  /**
   * Wall-clock TTL for `listOpenOrders` in-memory cache (RFC P2). `0` = always fetch.
   * @default 1000
   */
  readonly openOrdersCacheTtlMs?: number;
}

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
  private readonly twoLegSafetyEnabled: boolean;
  private readonly openOrdersCacheTtlMs: number;
  private readonly openOrdersCache = new Map<string, { atMs: number; orders: OpenOrderView[] }>();

  constructor(
    client: BinanceRestClient,
    creds: SignedCredentials,
    idGen: ClientOrderIdGenerator | undefined,
    options?: ExecutionServiceOptions,
  ) {
    this.client = client;
    this.creds = creds;
    this.idGen = idGen ?? new ClientOrderIdGenerator();
    this.log = options?.log;
    this.twoLegSafetyEnabled = options?.twoLegSafetyEnabled ?? false;
    this.openOrdersCacheTtlMs = options?.openOrdersCacheTtlMs ?? 1000;
  }

  /** Invalidate cached `listOpenOrders` after local order mutations. */
  private invalidateOpenOrdersCache(symbol: string): void {
    this.openOrdersCache.delete(symbol);
  }

  private logCancelOk(
    symbol: string,
    orderId: number,
    ctx: OrderActionContext | undefined,
    extra?: Record<string, unknown>,
  ): void {
    const reason = ctx?.reason ?? "cancel_order";
    this.log?.info(
      {
        event: "execution.order_cancelled",
        symbol,
        orderId,
        reason,
        ...(ctx?.detail !== undefined ? { detail: ctx.detail } : {}),
        ...extra,
      },
      "execution.order_cancelled",
    );
  }

  private logPlaceOk(
    ack: OrderAck,
    req: NewOrderRequest,
    ctx: OrderActionContext | undefined,
    extra?: Record<string, unknown>,
  ): void {
    const reason = ctx?.reason ?? "place_order";
    const timeInForce =
      req.limitTimeInForce !== undefined ? req.limitTimeInForce : req.postOnly ? "GTX" : "GTC";
    this.log?.info(
      {
        event: "execution.order_placed",
        symbol: req.symbol,
        orderId: ack.orderId,
        clientOrderId: ack.clientOrderId,
        exchangeStatus: ack.status,
        side: req.side,
        price: req.price,
        quantity: req.quantity,
        postOnly: req.postOnly,
        reduceOnly: req.reduceOnly,
        timeInForce,
        reason,
        ...(ctx?.detail !== undefined ? { detail: ctx.detail } : {}),
        ...extra,
      },
      "execution.order_placed",
    );
    this.log?.debug(
      {
        event: "execution.order_placed_debug",
        symbol: req.symbol,
        orderId: ack.orderId,
        clientOrderId: req.clientOrderId,
        reason,
        request: {
          side: req.side,
          price: req.price,
          quantity: req.quantity,
          postOnly: req.postOnly,
          reduceOnly: req.reduceOnly,
          timeInForce,
        },
      },
      "execution.order_placed_debug",
    );
  }

  async listOpenOrders(symbol: string): Promise<OpenOrderView[]> {
    const now = Date.now();
    if (this.openOrdersCacheTtlMs > 0) {
      const hit = this.openOrdersCache.get(symbol);
      if (hit !== undefined && now - hit.atMs < this.openOrdersCacheTtlMs) {
        return hit.orders;
      }
    }
    const raw = await signedListOpenOrders(this.client, this.creds, symbol);
    const orders = mapBinanceOpenOrdersResponse(raw);
    if (this.openOrdersCacheTtlMs > 0) {
      this.openOrdersCache.set(symbol, { atMs: now, orders });
    }
    return orders;
  }

  async placeFromIntent(
    symbol: SymbolSpec,
    intent: QuoteIntent,
    ctx?: OrderActionContext,
  ): Promise<void> {
    const reqs = buildOrderRequests(symbol, intent, this.idGen);
    try {
      await this.placeNormalizedRequests(symbol, reqs, ctx ?? { reason: "quote_intent" });
    } finally {
      this.invalidateOpenOrdersCache(symbol.symbol);
    }
  }

  async executePlacementPlan(
    symbol: SymbolSpec,
    plan: PlacementPlan,
    ctx?: OrderActionContext,
  ): Promise<void> {
    const baseCtx = ctx ?? { reason: "placement_plan" };
    try {
      let cancelIdx = 0;
      for (const orderId of plan.cancelOrderIds) {
        try {
          await cancelOrder(this.client, this.creds, symbol.symbol, orderId);
          this.logCancelOk(symbol.symbol, orderId, baseCtx, {
            phase: "placement_plan",
            cancelIndex: cancelIdx,
            cancelTotal: plan.cancelOrderIds.length,
          });
        } catch (err) {
          const mapping = mapBinanceOrderError(err);
          this.log?.error(
            {
              event: "order.cancel_error",
              symbol: symbol.symbol,
              orderId,
              reason: baseCtx.reason,
              mapping,
            },
            "order.cancel_error",
          );
          if (mapping.action === "Fatal") throw err;
        }
        cancelIdx += 1;
      }

      const reqs: NewOrderRequest[] = [];
      for (const leg of plan.placeLegs) {
        reqs.push(
          normalizeOrderRequest(
            {
              symbol: symbol.symbol,
              side: leg.side,
              price: leg.price,
              quantity: leg.quantity,
              postOnly: leg.postOnly,
              reduceOnly: leg.reduceOnly,
              clientOrderId: this.idGen.next(symbol.symbol),
            },
            symbol,
          ),
        );
      }
      await this.placeNormalizedRequests(symbol, reqs, baseCtx);
    } finally {
      this.invalidateOpenOrdersCache(symbol.symbol);
    }
  }

  private async placeNormalizedRequests(
    symbol: SymbolSpec,
    reqs: NewOrderRequest[],
    ctx: OrderActionContext,
  ): Promise<void> {
    if (reqs.length === 0) return;

    if (!this.twoLegSafetyEnabled || reqs.length === 1) {
      let leg = 0;
      for (const req of reqs) {
        try {
          const ack = await placeOrder(this.client, this.creds, req);
          this.logPlaceOk(ack, req, ctx, {
            legIndex: leg,
            legTotal: reqs.length,
          });
        } catch (err) {
          const mapping = mapBinanceOrderError(err);
          this.log?.error(
            { event: "order.error", symbol: req.symbol, mapping, clientOrderId: req.clientOrderId },
            "order.error",
          );
          if (mapping.action === "Fatal") throw err;
        }
        leg += 1;
      }
      return;
    }

    const ranked = reqs.map((req) => ({
      req,
      /** Quote notional (USD-M): price × qty × contractSize */
      notional: req.price * req.quantity * symbol.contractSize,
    }));
    ranked.sort((a, b) => a.notional - b.notional);

    let firstAck: OrderAck | undefined;
    try {
      firstAck = await placeOrder(this.client, this.creds, ranked[0]!.req);
      this.logPlaceOk(firstAck, ranked[0]!.req, ctx, {
        twoLegRank: "smaller_notional_first",
        legIndex: 0,
        legTotal: 2,
      });
    } catch (err) {
      const mapping = mapBinanceOrderError(err);
      this.log?.error(
        {
          event: "order.error",
          symbol: ranked[0]!.req.symbol,
          mapping,
          clientOrderId: ranked[0]!.req.clientOrderId,
        },
        "order.error",
      );
      if (mapping.action === "Fatal") throw err;
      return;
    }

    try {
      const secondAck = await placeOrder(this.client, this.creds, ranked[1]!.req);
      this.logPlaceOk(secondAck, ranked[1]!.req, ctx, {
        twoLegRank: "larger_notional_second",
        legIndex: 1,
        legTotal: 2,
      });
    } catch (err) {
      const mapping = mapBinanceOrderError(err);
      this.log?.error(
        {
          event: "liquidity.two_leg_rollback",
          liquidityEngineVersion: "p0",
          symbol: symbol.symbol,
          firstOrderId: firstAck.orderId,
          secondClientOrderId: ranked[1]!.req.clientOrderId,
          mapping,
        },
        "liquidity.two_leg_rollback",
      );
      try {
        await cancelOrder(this.client, this.creds, symbol.symbol, firstAck.orderId);
        this.logCancelOk(symbol.symbol, firstAck.orderId, ctx, {
          phase: "two_leg_rollback",
          companionClientOrderId: ranked[1]!.req.clientOrderId,
        });
      } catch (cancelErr) {
        const cancelMap = mapBinanceOrderError(cancelErr);
        this.log?.error(
          {
            event: "liquidity.two_leg_rollback_cancel_failed",
            liquidityEngineVersion: "p0",
            symbol: symbol.symbol,
            firstOrderId: firstAck.orderId,
            mapping: cancelMap,
          },
          "liquidity.two_leg_rollback_cancel_failed",
        );
      }
      this.log?.error(
        {
          event: "order.error",
          symbol: ranked[1]!.req.symbol,
          mapping,
          clientOrderId: ranked[1]!.req.clientOrderId,
        },
        "order.error",
      );
      if (mapping.action === "Fatal") throw err;
    }
  }

  async executeDeRisk(
    symbol: SymbolSpec,
    exit: DeRiskExitPlan,
    ctx?: OrderActionContext,
  ): Promise<void> {
    const req = buildDeRiskOrderRequest(symbol, exit, this.idGen);
    const eff =
      ctx ??
      ({
        reason: "de_risk",
        detail: { mode: exit.mode, postOnly: exit.postOnly },
      } satisfies OrderActionContext);
    try {
      const ack = await placeOrder(this.client, this.creds, req);
      this.logPlaceOk(ack, req, eff);
    } catch (err) {
      const mapping = mapBinanceOrderError(err);
      this.log?.error(
        { event: "order.error", symbol: req.symbol, mapping, clientOrderId: req.clientOrderId },
        "order.error",
      );
      if (mapping.action === "Fatal") throw err;
    } finally {
      this.invalidateOpenOrdersCache(symbol.symbol);
    }
  }

  async cancel(symbol: string, orderId: number, ctx?: OrderActionContext): Promise<void> {
    try {
      await cancelOrder(this.client, this.creds, symbol, orderId);
      this.logCancelOk(symbol, orderId, ctx ?? { reason: "single_cancel" });
    } finally {
      this.invalidateOpenOrdersCache(symbol);
    }
  }

  async cancelAll(symbol: string, ctx?: OrderActionContext): Promise<void> {
    const reason = ctx?.reason ?? "cancel_all";
    try {
      await cancelAllOrders(this.client, this.creds, symbol);
      this.log?.info(
        {
          event: "execution.cancel_all",
          symbol,
          reason,
          ...(ctx?.detail !== undefined ? { detail: ctx.detail } : {}),
        },
        "execution.cancel_all",
      );
    } finally {
      this.invalidateOpenOrdersCache(symbol);
    }
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
