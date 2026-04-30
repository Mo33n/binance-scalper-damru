import { describe, it, expect, vi } from "vitest";
import { BinanceRestClient, BinanceRestError } from "../../../src/infrastructure/binance/rest-client.js";

describe("BinanceRestClient", () => {
  it("returns parsed JSON for success", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })));
    const c = new BinanceRestClient({ baseUrl: "https://example.com", fetchImpl });
    const out = await c.requestJson<{ ok: boolean }>({ path: "/fapi/v1/exchangeInfo" });
    expect(out.ok).toBe(true);
  });

  it("throws BinanceRestError on non-2xx", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response("{\"msg\":\"bad\"}", { status: 429 })));
    const c = new BinanceRestClient({ baseUrl: "https://example.com", fetchImpl });
    await expect(c.requestJson({ path: "/fapi/v1/exchangeInfo" })).rejects.toBeInstanceOf(BinanceRestError);
  });
});
