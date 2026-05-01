import { describe, expect, it } from "vitest";
import { demuxCombinedDepthFrames } from "../../../src/infrastructure/binance/depth-stream-parse.js";

describe("demuxCombinedDepthFrames (P6 / C9)", () => {
  it("demuxes a single combined envelope", () => {
    const text = JSON.stringify({
      stream: "btcusdt@depth",
      data: { U: 1, u: 2, b: [], a: [], E: 100 },
    });
    const r = demuxCombinedDepthFrames(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items).toHaveLength(1);
    expect(r.items[0]?.symbol).toBe("BTCUSDT");
    expect(r.items[0]?.frameText).toContain("btcusdt@depth");
  });

  it("sorts same-batch events by (finalUpdateId, firstUpdateId) before demux (P6.2)", () => {
    const text = JSON.stringify([
      { stream: "ethusdt@depth", data: { U: 1, u: 5, b: [], a: [], E: 300 } },
      { stream: "btcusdt@depth", data: { U: 1, u: 2, b: [], a: [], E: 100 } },
    ]);
    const r = demuxCombinedDepthFrames(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items.map((x) => x.symbol)).toEqual(["BTCUSDT", "ETHUSDT"]);
  });

  it("rejects oversized frames", () => {
    const r = demuxCombinedDepthFrames("x".repeat(3 * 1024 * 1024));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("oversized");
  });
});
