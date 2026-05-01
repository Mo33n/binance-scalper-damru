/**
 * SPEC-09 §2.2 — Listen-key REST; production passes the rate-limited `BinanceRestClient` from `venue-factory` / workers.
 */
import { signedDeleteJson, signedPostJson, type SignedCredentials } from "./signed-rest.js";
import type { BinanceRestClient } from "./rest-client.js";

export interface FillEvent {
  readonly symbol: string;
  readonly orderId: number;
  readonly tradeId: number;
  readonly side: "BUY" | "SELL";
  readonly quantity: number;
  readonly price: number;
}

export interface OrderUpdateEvent {
  readonly symbol: string;
  readonly orderId: number;
  readonly status: string;
  readonly clientOrderId?: string;
}

export interface AccountMarginSnapshot {
  readonly totalWalletBalance?: number;
  readonly totalUnrealizedProfit?: number;
}

export type UserStreamEvent =
  | { readonly kind: "fill"; readonly fill: FillEvent }
  | { readonly kind: "order_update"; readonly order: OrderUpdateEvent }
  | { readonly kind: "account"; readonly account: AccountMarginSnapshot };

export async function createListenKey(
  client: BinanceRestClient,
  creds: SignedCredentials,
): Promise<string> {
  const res = await signedPostJson<{ listenKey: string }>(
    client,
    "/fapi/v1/listenKey",
    { timestamp: Date.now() },
    creds,
  );
  return res.listenKey;
}

export async function keepAliveListenKey(
  client: BinanceRestClient,
  creds: SignedCredentials,
  listenKey: string,
): Promise<void> {
  await signedPostJson<unknown>(
    client,
    "/fapi/v1/listenKey",
    { listenKey, timestamp: Date.now() },
    creds,
  );
}

export async function closeListenKey(
  client: BinanceRestClient,
  creds: SignedCredentials,
  listenKey: string,
): Promise<void> {
  await signedDeleteJson<unknown>(
    client,
    "/fapi/v1/listenKey",
    { listenKey, timestamp: Date.now() },
    creds,
  );
}

export class UserStreamDeduper {
  private readonly seen = new Set<string>();
  acceptFill(fill: FillEvent): boolean {
    const key = `${fill.symbol}:${String(fill.orderId)}:${String(fill.tradeId)}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }
}

export function parseUserStreamEvent(raw: Record<string, unknown>): UserStreamEvent | undefined {
  const evtType = raw["e"];
  if (evtType === "ORDER_TRADE_UPDATE") {
    const o = raw["o"] as Record<string, unknown> | undefined;
    if (o === undefined) return undefined;
    const qty = Number(o["l"] ?? 0); // last fill qty
    const price = Number(o["L"] ?? 0); // last fill price
    const tradeId = Number(o["t"] ?? -1);
    const orderId = Number(o["i"] ?? -1);
    const symbol = asString(o["s"]);
    const side = (asString(o["S"]) || "BUY") as "BUY" | "SELL";
    const status = asString(o["X"]);
    const clientOrderId = asString(o["c"]);
    if (qty > 0 && price > 0 && tradeId >= 0) {
      return {
        kind: "fill",
        fill: { symbol, orderId, tradeId, side, quantity: qty, price },
      };
    }
    return {
      kind: "order_update",
      order: { symbol, orderId, status, ...(clientOrderId.length > 0 ? { clientOrderId } : {}) },
    };
  }

  if (evtType === "ACCOUNT_UPDATE") {
    const a = raw["a"] as Record<string, unknown> | undefined;
    if (a === undefined) return undefined;
    const wb = Number(a["wb"]);
    const up = Number(a["up"]);
    return {
      kind: "account",
      account: {
        ...(Number.isFinite(wb) ? { totalWalletBalance: wb } : {}),
        ...(Number.isFinite(up) ? { totalUnrealizedProfit: up } : {}),
      },
    };
  }
  return undefined;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}
