import { signedGetJson, signedPostJson, type SignedCredentials } from "./signed-rest.js";
import { BinanceRestClient } from "./rest-client.js";
import type { LeverageBracket } from "./types.js";

interface BracketRaw {
  readonly symbol: string;
  readonly brackets: readonly {
    readonly initialLeverage: number;
    readonly notionalCap: number;
  }[];
}

interface SetLeverageResponse {
  readonly leverage: number;
}

export async function fetchLeverageBrackets(
  client: BinanceRestClient,
  creds: SignedCredentials,
): Promise<Map<string, readonly LeverageBracket[]>> {
  const raw = await signedGetJson<readonly BracketRaw[]>(
    client,
    "/fapi/v1/leverageBracket",
    { timestamp: Date.now() },
    creds,
  );
  const out = new Map<string, readonly LeverageBracket[]>();
  for (const item of raw) {
    const brackets: LeverageBracket[] = item.brackets
      .map((b) => ({
        initialLeverage: b.initialLeverage,
        notionalCap: b.notionalCap,
      }))
      .filter((b) => Number.isFinite(b.initialLeverage) && Number.isFinite(b.notionalCap))
      .sort((a, b) => a.notionalCap - b.notionalCap);
    out.set(item.symbol, brackets);
  }
  return out;
}

export function chooseLeverage(
  desiredMaxLeverage: number,
  riskPolicyMaxLeverage: number,
  brackets: readonly LeverageBracket[],
  positionNotionalQuote: number,
): number {
  const bracket = brackets.find((b) => positionNotionalQuote <= b.notionalCap) ?? brackets.at(-1);
  const exchangeMax = bracket?.initialLeverage ?? desiredMaxLeverage;
  // RFC §7.4: "max leverage" is bounded by risk policy and liquidation discipline.
  return Math.max(1, Math.min(desiredMaxLeverage, riskPolicyMaxLeverage, exchangeMax));
}

export async function setSymbolLeverage(
  client: BinanceRestClient,
  creds: SignedCredentials,
  symbol: string,
  leverage: number,
): Promise<number> {
  const res = await signedPostJson<SetLeverageResponse>(
    client,
    "/fapi/v1/leverage",
    { symbol, leverage, timestamp: Date.now() },
    creds,
  );
  return res.leverage;
}
