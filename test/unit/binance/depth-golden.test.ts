import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseDepthStreamMessage } from "../../../src/infrastructure/binance/depth-stream-parse.js";
import { DepthOrderBook } from "../../../src/infrastructure/binance/depth-order-book.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "../../fixtures/depth");

describe("depth golden fixtures", () => {
  const sym = "BTCUSDT";

  it("minimal-diff applies after snapshot bridge", () => {
    const raw = readFileSync(join(fixtures, "minimal-diff.json"), "utf8");
    const r = parseDepthStreamMessage(sym, raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const b = new DepthOrderBook(sym, 0.1);
    b.applySnapshot({
      lastUpdateId: 100,
      bids: [["50000", "1"]],
      asks: [["50000.1", "1"]],
    });
    const out = b.applyDiff(r.event);
    expect(out.kind).toBe("updated");
    if (out.kind === "updated") expect(out.snapshot.bestBid?.qty).toBe(2);
  });

  it("gap-steady-diff flags sequence gap after bridge", () => {
    const raw = readFileSync(join(fixtures, "gap-steady-diff.json"), "utf8");
    const r = parseDepthStreamMessage(sym, raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const b = new DepthOrderBook(sym, 0.1);
    b.applySnapshot({
      lastUpdateId: 100,
      bids: [["50000", "1"]],
      asks: [["50000.1", "1"]],
    });
    b.applyDiff({
      symbol: sym,
      firstUpdateId: 99,
      finalUpdateId: 101,
      prevFinalUpdateId: 98,
      bids: [],
      asks: [],
    });
    const out = b.applyDiff(r.event);
    expect(out.kind).toBe("gap");
    if (out.kind === "gap") expect(out.reason).toBe("gap_sequence_break");
  });
});
