/**
 * Single source for default Binance USD-M Futures endpoints and host allowlists (Epic I1.1).
 * Do not scatter production host strings elsewhere in `src/`.
 */

export const DEFAULT_TESTNET_REST_BASE_URL = "https://testnet.binancefuture.com" as const;
export const DEFAULT_TESTNET_WS_BASE_URL = "wss://stream.binancefuture.com/ws" as const;

export const DEFAULT_LIVE_REST_BASE_URL = "https://fapi.binance.com" as const;
export const DEFAULT_LIVE_WS_BASE_URL = "wss://fstream.binance.com/ws" as const;

/** Hostnames allowed when `environment === "testnet"` */
export const ALLOWED_TESTNET_REST_HOSTS = new Set<string>(["testnet.binancefuture.com"]);
export const ALLOWED_TESTNET_WS_HOSTS = new Set<string>(["stream.binancefuture.com"]);

/** Hostnames allowed when `environment === "live"` */
export const ALLOWED_LIVE_REST_HOSTS = new Set<string>(["fapi.binance.com"]);
export const ALLOWED_LIVE_WS_HOSTS = new Set<string>(["fstream.binance.com"]);

export function validateBinanceUrlsForEnvironment(
  environment: "testnet" | "live",
  restBaseUrl: string,
  wsBaseUrl: string,
): void {
  let restHost: string;
  let wsHost: string;
  try {
    restHost = new URL(restBaseUrl).hostname;
    wsHost = new URL(wsBaseUrl).hostname;
  } catch {
    throw new Error("binance: invalid restBaseUrl or wsBaseUrl (not a valid URL)");
  }

  if (environment === "testnet") {
    if (!ALLOWED_TESTNET_REST_HOSTS.has(restHost)) {
      throw new Error(
        `binance: restBaseUrl host "${restHost}" is not allowed for testnet; expected one of ${[...ALLOWED_TESTNET_REST_HOSTS].join(", ")}`,
      );
    }
    if (!ALLOWED_TESTNET_WS_HOSTS.has(wsHost)) {
      throw new Error(
        `binance: wsBaseUrl host "${wsHost}" is not allowed for testnet; expected one of ${[...ALLOWED_TESTNET_WS_HOSTS].join(", ")}`,
      );
    }
    return;
  }

  if (!ALLOWED_LIVE_REST_HOSTS.has(restHost)) {
    throw new Error(
      `binance: restBaseUrl host "${restHost}" is not allowed for live; expected one of ${[...ALLOWED_LIVE_REST_HOSTS].join(", ")}`,
    );
  }
  if (!ALLOWED_LIVE_WS_HOSTS.has(wsHost)) {
    throw new Error(
      `binance: wsBaseUrl host "${wsHost}" is not allowed for live; expected one of ${[...ALLOWED_LIVE_WS_HOSTS].join(", ")}`,
    );
  }
}
