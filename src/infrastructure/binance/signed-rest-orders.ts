/**
 * SPEC-09 §2.2 — Signed order REST; production passes the rate-limited `BinanceRestClient` from `venue-factory` / workers.
 */
import type { SymbolSpec } from "./types.js";
import { signedDeleteJson, signedPostJson, type SignedCredentials } from "./signed-rest.js";
import { BinanceRestClient, BinanceRestError } from "./rest-client.js";

export type OrderSide = "BUY" | "SELL";

export interface NewOrderRequest {
  readonly symbol: string;
  readonly side: OrderSide;
  readonly price: number;
  readonly quantity: number;
  readonly postOnly: boolean;
  readonly reduceOnly: boolean;
  readonly clientOrderId: string;
}

export interface OrderAck {
  readonly symbol: string;
  readonly orderId: number;
  readonly clientOrderId: string;
  readonly status: string;
}

export type OrderErrorAction = "Retryable" | "Fatal" | "ReconcileRequired";

export interface OrderErrorMapping {
  readonly action: OrderErrorAction;
  /** Binance Futures `code` from JSON body when present. */
  readonly code?: number;
  readonly httpStatus?: number;
  readonly binanceMsg?: string;
  /** Truncated raw body for grep-friendly logs (no secrets expected in order errors). */
  readonly bodySnippet?: string;
  /** Non-Binance errors (e.g. normalization `throw`). */
  readonly detail?: string;
}

export function normalizeOrderRequest(r: NewOrderRequest, spec: SymbolSpec): NewOrderRequest {
  const price = roundStep(r.price, spec.tickSize);
  const quantity = roundStep(r.quantity, spec.stepSize);
  const notional = price * quantity * spec.contractSize;
  if (notional < spec.minNotional) {
    throw new Error(
      `Order notional ${String(notional)} below minNotional ${String(spec.minNotional)}`,
    );
  }
  return {
    ...r,
    price,
    quantity,
  };
}

export function mapBinanceOrderError(err: unknown): OrderErrorMapping {
  if (err instanceof BinanceRestError) {
    const binanceMsg = extractBinanceMsg(err.bodyText);
    const bodySnippet = snippetBody(err.bodyText);
    const msgFields = {
      ...(binanceMsg !== undefined ? { binanceMsg } : {}),
      ...(bodySnippet !== undefined ? { bodySnippet } : {}),
    };
    const httpStatus = err.status;
    if (err.status === 429 || err.status === 503) {
      return { action: "Retryable", httpStatus, ...msgFields };
    }
    const code = extractCode(err.bodyText);
    const common = { httpStatus, ...msgFields, ...(code !== undefined ? { code } : {}) };
    if (code === -2011) return { action: "ReconcileRequired", ...common }; // unknown order
    if (code === -2019 || code === -2022) return { action: "Fatal", ...common }; // margin/reduceOnly issues
    if (code !== undefined) return { action: "ReconcileRequired", ...common };
    return { action: "ReconcileRequired", httpStatus, ...msgFields };
  }
  if (err instanceof Error) {
    return { action: "ReconcileRequired", detail: err.message };
  }
  return { action: "ReconcileRequired", detail: String(err) };
}

export async function placeOrder(
  client: BinanceRestClient,
  creds: SignedCredentials,
  req: NewOrderRequest,
): Promise<OrderAck> {
  const response = await signedPostJson<{
    symbol: string;
    orderId: number;
    clientOrderId: string;
    status: string;
  }>(
    client,
    "/fapi/v1/order",
    {
      symbol: req.symbol,
      side: req.side,
      type: "LIMIT",
      timeInForce: req.postOnly ? "GTX" : "GTC",
      quantity: req.quantity,
      price: req.price,
      newClientOrderId: req.clientOrderId,
      reduceOnly: req.reduceOnly ? "true" : "false",
      timestamp: Date.now(),
    },
    creds,
  );
  return {
    symbol: response.symbol,
    orderId: response.orderId,
    clientOrderId: response.clientOrderId,
    status: response.status,
  };
}

export async function cancelOrder(
  client: BinanceRestClient,
  creds: SignedCredentials,
  symbol: string,
  orderId: number,
): Promise<void> {
  await signedDeleteJson<unknown>(
    client,
    "/fapi/v1/order",
    { symbol, orderId, timestamp: Date.now() },
    creds,
  );
}

export async function cancelAllOrders(
  client: BinanceRestClient,
  creds: SignedCredentials,
  symbol: string,
): Promise<void> {
  await signedDeleteJson<unknown>(
    client,
    "/fapi/v1/allOpenOrders",
    { symbol, timestamp: Date.now() },
    creds,
  );
}

function roundStep(x: number, step: number): number {
  const raw = Math.floor(x / step) * step;
  const decimals = stepDecimals(step);
  return Number(raw.toFixed(decimals));
}

function extractCode(body: string): number | undefined {
  try {
    const parsed = JSON.parse(body) as { code?: number };
    return typeof parsed.code === "number" ? parsed.code : undefined;
  } catch {
    return undefined;
  }
}

function extractBinanceMsg(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { msg?: string };
    return typeof parsed.msg === "string" ? parsed.msg : undefined;
  } catch {
    return undefined;
  }
}

function snippetBody(body: string): string | undefined {
  const t = body.trim();
  if (t.length === 0) return undefined;
  return t.length > 320 ? `${t.slice(0, 320)}…` : t;
}

function stepDecimals(step: number): number {
  const s = step.toString();
  const idx = s.indexOf(".");
  return idx === -1 ? 0 : s.length - idx - 1;
}
