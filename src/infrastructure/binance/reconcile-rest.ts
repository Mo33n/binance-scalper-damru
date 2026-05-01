/**
 * SPEC-09 §2.2 — Ledger reconcile REST; caller passes `session.venue.rest` (rate-limited in production).
 */
import type { BinanceRestClient } from "./rest-client.js";
import type { SignedCredentials } from "./signed-rest.js";
import { signedGetJson } from "./signed-rest.js";

export interface UsdMPositionRiskRow {
  readonly netQty: number;
  readonly markPrice: number;
}

export async function fetchUsdMPositionRiskRow(
  client: BinanceRestClient,
  creds: SignedCredentials,
  symbol: string,
): Promise<UsdMPositionRiskRow> {
  const rows = await signedGetJson<
    Array<{ symbol: string; positionAmt: string; markPrice?: string }>
  >(client, "/fapi/v2/positionRisk", { symbol, timestamp: Date.now() }, creds);
  const row = rows.find((r) => r.symbol === symbol);
  if (row === undefined) {
    return { netQty: 0, markPrice: 0 };
  }
  const netQty = Number(row.positionAmt);
  const markPrice = row.markPrice !== undefined ? Number(row.markPrice) : 0;
  return {
    netQty: Number.isFinite(netQty) ? netQty : 0,
    markPrice: Number.isFinite(markPrice) && markPrice > 0 ? markPrice : 0,
  };
}

export async function fetchUsdMNetPositionQty(
  client: BinanceRestClient,
  creds: SignedCredentials,
  symbol: string,
): Promise<number> {
  const row = await fetchUsdMPositionRiskRow(client, creds, symbol);
  return row.netQty;
}
