import { describe, expect, it, vi } from "vitest";
import type { TokenBucketConfig } from "../../../src/application/services/rate-limit-budget.js";
import {
  RateLimitedBinanceRestClient,
} from "../../../src/application/services/rate-limited-binance-rest-client.js";
import { BinanceRestError } from "../../../src/infrastructure/binance/rest-client.js";

describe("RateLimitedBinanceRestClient (SPEC-09 T01)", () => {
  it("blocks a burst when bucket capacity is exhausted", async () => {
    let t = 0;
    const mono = () => t;
    const bucket: TokenBucketConfig = { capacity: 1, refillPerSecond: 0 };
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })));
    const client = new RateLimitedBinanceRestClient(
      { baseUrl: "https://example.com", fetchImpl },
      bucket,
      mono,
    );
    await expect(client.requestJson<{ ok: boolean }>({ path: "/x" })).resolves.toEqual({ ok: true });
    await expect(client.requestJson({ path: "/y" })).rejects.toMatchObject({
      name: "BinanceRestError",
      status: 429,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("invokes bucket backoff on HTTP 429 from upstream", async () => {
    let t = 0;
    const mono = () => t;
    const bucket: TokenBucketConfig = { capacity: 10, refillPerSecond: 0 };
    const fetch429 = vi.fn(() => Promise.resolve(new Response("{}", { status: 429 })));
    const client = new RateLimitedBinanceRestClient(
      { baseUrl: "https://example.com", fetchImpl: fetch429 },
      bucket,
      mono,
    );
    await expect(client.requestJson({ path: "/z" })).rejects.toBeInstanceOf(BinanceRestError);
    t = 100;
    await expect(client.requestJson({ path: "/z" })).rejects.toMatchObject({ status: 429 });
    expect(fetch429).toHaveBeenCalledTimes(1);
  });
});
