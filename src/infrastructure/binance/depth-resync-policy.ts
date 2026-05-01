import { BinanceRestError } from "./rest-client.js";

const REST_BACKOFF_BASE_MS = 400;
const REST_BACKOFF_CAP_MS = 30_000;
const WS_RECONNECT_BASE_MS = 500;
const WS_RECONNECT_CAP_MS = 30_000;

/** HTTP 429 and 5xx are retried; other Binance errors fail fast. Unknown errors (network) retry. */
export function isRetriableDepthSnapshotError(err: unknown): boolean {
  if (err instanceof BinanceRestError) {
    if (err.status === 429) return true;
    if (err.status >= 500 && err.status <= 599) return true;
    return false;
  }
  return true;
}

export function restResyncBackoffMs(attemptIndex: number): number {
  const exp = Math.min(REST_BACKOFF_CAP_MS, REST_BACKOFF_BASE_MS * 2 ** attemptIndex);
  const jitter = Math.floor(Math.random() * Math.min(250, exp / 4 + 1));
  return Math.min(REST_BACKOFF_CAP_MS, exp + jitter);
}

export function wsReconnectBackoffMs(attemptIndex: number): number {
  const exp = Math.min(WS_RECONNECT_CAP_MS, WS_RECONNECT_BASE_MS * 2 ** attemptIndex);
  const jitter = Math.floor(Math.random() * Math.min(400, exp / 3 + 1));
  return Math.min(WS_RECONNECT_CAP_MS, exp + jitter);
}

export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
