import { utcNowIso } from "../../shared/time.js";
import { signedGetJson, type SignedCredentials } from "./signed-rest.js";
import { BinanceRestClient } from "./rest-client.js";
import type { EffectiveFees } from "./types.js";

interface CommissionRateRaw {
  readonly symbol?: string;
  readonly makerCommissionRate: string;
  readonly takerCommissionRate: string;
}

/**
 * Refresh policy: read once at bootstrap and periodically per config feeRefreshIntervalMs.
 */
export async function fetchEffectiveFees(
  client: BinanceRestClient,
  creds: SignedCredentials,
  symbol = "BTCUSDT",
): Promise<EffectiveFees> {
  const ts = Date.now();
  const raw = await signedGetJson<CommissionRateRaw>(
    client,
    "/fapi/v1/commissionRate",
    { symbol, timestamp: ts },
    creds,
  );
  const makerRate = Number(raw.makerCommissionRate);
  const takerRate = Number(raw.takerCommissionRate);
  if (!Number.isFinite(makerRate) || !Number.isFinite(takerRate)) {
    throw new Error("Invalid commission rate response");
  }
  return Object.freeze({
    makerRate,
    takerRate,
    bnbDiscountEnabled: false,
    asOfIso: utcNowIso(),
  });
}
