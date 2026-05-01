import { TokenBucket, type TokenBucketConfig } from "./rate-limit-budget.js";
import {
  BinanceRestClient,
  BinanceRestError,
  type JsonRequest,
  type RestClientOptions,
} from "../../infrastructure/binance/rest-client.js";

/** Conservative default; tune via config later if needed. */
export const DEFAULT_BINANCE_REST_TOKEN_BUCKET: TokenBucketConfig = {
  capacity: 40,
  refillPerSecond: 12,
};

/**
 * SPEC-09 §2 — token-bucket gate on `requestJson` (orders, user-stream listenKey, reconcile).
 * HTTP 429 from Binance triggers bucket backoff via `on429`.
 */
export class RateLimitedBinanceRestClient extends BinanceRestClient {
  private readonly bucket: TokenBucket;
  private readonly mono: () => number;

  constructor(opts: RestClientOptions, bucketCfg: TokenBucketConfig, mono: () => number) {
    super(opts);
    this.bucket = new TokenBucket(bucketCfg, mono());
    this.mono = mono;
  }

  override async requestJson<T>(req: JsonRequest): Promise<T> {
    const now = this.mono();
    if (!this.bucket.tryAcquire(1, now)) {
      throw new BinanceRestError("rate_limit_budget_exceeded", 429, "");
    }
    try {
      return await super.requestJson<T>(req);
    } catch (err) {
      if (err instanceof BinanceRestError && err.status === 429) {
        this.bucket.on429(this.mono(), 0);
      }
      throw err;
    }
  }
}

export function createRateLimitedBinanceRestClient(
  opts: RestClientOptions,
  mono: () => number,
  bucketCfg: TokenBucketConfig = DEFAULT_BINANCE_REST_TOKEN_BUCKET,
): BinanceRestClient {
  return new RateLimitedBinanceRestClient(opts, bucketCfg, mono);
}
