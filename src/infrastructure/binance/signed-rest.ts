import { createHmac } from "node:crypto";
import { BinanceRestClient } from "./rest-client.js";

export interface SignedCredentials {
  readonly apiKey: string;
  readonly apiSecret: string;
}

export function buildSignedQuery(
  query: Record<string, string | number | boolean>,
  creds: SignedCredentials,
): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    params.set(k, String(v));
  }
  const payload = params.toString();
  const signature = createHmac("sha256", creds.apiSecret).update(payload).digest("hex");
  return `${payload}&signature=${signature}`;
}

export async function signedGetJson<T>(
  client: BinanceRestClient,
  path: string,
  query: Record<string, string | number | boolean>,
  creds: SignedCredentials,
): Promise<T> {
  const q = buildSignedQuery(query, creds);
  return client.requestJson<T>({
    path,
    query: Object.fromEntries(new URLSearchParams(q).entries()),
    headers: { "X-MBX-APIKEY": creds.apiKey },
  });
}

export async function signedPostJson<T>(
  client: BinanceRestClient,
  path: string,
  query: Record<string, string | number | boolean>,
  creds: SignedCredentials,
): Promise<T> {
  const q = buildSignedQuery(query, creds);
  return client.requestJson<T>({
    method: "POST",
    path,
    query: Object.fromEntries(new URLSearchParams(q).entries()),
    headers: { "X-MBX-APIKEY": creds.apiKey },
  });
}

export async function signedDeleteJson<T>(
  client: BinanceRestClient,
  path: string,
  query: Record<string, string | number | boolean>,
  creds: SignedCredentials,
): Promise<T> {
  const q = buildSignedQuery(query, creds);
  return client.requestJson<T>({
    method: "DELETE",
    path,
    query: Object.fromEntries(new URLSearchParams(q).entries()),
    headers: { "X-MBX-APIKEY": creds.apiKey },
  });
}
