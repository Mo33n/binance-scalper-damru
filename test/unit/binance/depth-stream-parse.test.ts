import { describe, it, expect } from "vitest";
import {
  DEFAULT_MAX_DEPTH_FRAME_BYTES,
  parseDepthStreamMessage,
} from "../../../src/infrastructure/binance/depth-stream-parse.js";

describe("parseDepthStreamMessage", () => {
  const sym = "BTCUSDT";

  it("parses raw diff", () => {
    const text = JSON.stringify({
      U: 1,
      u: 2,
      b: [["100", "1"]],
      a: [["101", "2"]],
      E: 123,
    });
    const r = parseDepthStreamMessage(sym, text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.symbol).toBe(sym);
    expect(r.event.firstUpdateId).toBe(1);
    expect(r.event.finalUpdateId).toBe(2);
    expect(r.event.eventTimeMs).toBe(123);
    expect(r.event.bids).toEqual([{ price: 100, qty: 1 }]);
    expect(r.event.asks).toEqual([{ price: 101, qty: 2 }]);
  });

  it("unwraps combined-stream envelope", () => {
    const inner = { U: 5, u: 6, b: [], a: [["200", "0.5"]] };
    const text = JSON.stringify({ data: inner });
    const r = parseDepthStreamMessage(sym, text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.asks).toEqual([{ price: 200, qty: 0.5 }]);
  });

  it("rejects oversized frames", () => {
    const huge = "x".repeat(DEFAULT_MAX_DEPTH_FRAME_BYTES + 1);
    const r = parseDepthStreamMessage(sym, huge);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("oversized");
  });

  it("rejects invalid json", () => {
    const r = parseDepthStreamMessage(sym, "{");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("json");
  });

  it("rejects non-object payload", () => {
    const r = parseDepthStreamMessage(sym, "[]");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("shape");
  });

  it("rejects non-finite sequence ids (JSON allows huge exponents → Infinity)", () => {
    const text = '{"U":1e400,"u":1,"b":[],"a":[]}';
    const r = parseDepthStreamMessage(sym, text);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("sequence_ids");
  });

  it("skips bad level rows but keeps good ones", () => {
    const text = JSON.stringify({
      U: 1,
      u: 1,
      b: [
        ["1", "1"],
        ["bad", "1"],
      ],
      a: [["2", "x"]],
    });
    const r = parseDepthStreamMessage(sym, text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.bids).toEqual([{ price: 1, qty: 1 }]);
    expect(r.event.asks).toEqual([]);
  });
  it("maps clean Binance-style payloads including pu and E", () => {
    const sym = "ETHUSDT";
    const text = JSON.stringify({
      U: 10,
      u: 11,
      pu: 9,
      b: [["3000", "0.1"]],
      a: [["3001", "0.2"]],
      E: 999,
    });
    const r = parseDepthStreamMessage(sym, text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.symbol).toBe(sym);
    expect(r.event.prevFinalUpdateId).toBe(9);
    expect(r.event.eventTimeMs).toBe(999);
    expect(r.event.bids[0]).toEqual({ price: 3000, qty: 0.1 });
  });
});
