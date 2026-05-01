/**
 * SPEC-09 §2.2 — Ledger reconcile REST; caller passes `session.venue.rest` (rate-limited in production).
 */
import type { BinanceRestClient } from "./rest-client.js";
import type { SignedCredentials } from "./signed-rest.js";
import { signedGetJson } from "./signed-rest.js";

export async function fetchUsdMNetPositionQty(
  client: BinanceRestClient,
  creds: SignedCredentials,
  symbol: string,
): Promise<number> {
  const rows = await signedGetJson<Array<{ symbol: string; positionAmt: string }>>(
    client,
    "/fapi/v2/positionRisk",
    { symbol, timestamp: Date.now() },
    creds,
  );
  const row = rows.find((r) => r.symbol === symbol);
  if (row === undefined) return 0;
  const amt = Number(row.positionAmt);
  return Number.isFinite(amt) ? amt : 0;
}
