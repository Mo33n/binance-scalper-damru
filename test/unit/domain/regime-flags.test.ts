import { describe, expect, it } from "vitest";
import { detectTrendStress, shouldHaltForBook } from "../../../src/domain/regime/regime-flags.js";

describe("regime flags", () => {
  it("detects stress when drift exceeds threshold", () => {
    expect(detectTrendStress(100, 100.2, { slopeTau: 0.001, maxSpreadTicks: 20, minTopQty: 1 })).toBe(
      "stressed",
    );
  });

  it("halts for wide spread or thin top of book", () => {
    const halt = shouldHaltForBook(
      {
        symbol: "BTCUSDT",
        bids: [{ price: 100, qty: 0.1 }],
        asks: [{ price: 101, qty: 2 }],
        bestBid: { price: 100, qty: 0.1 },
        bestAsk: { price: 101, qty: 2 },
        spreadTicks: 25,
      },
      { slopeTau: 0.001, maxSpreadTicks: 10, minTopQty: 1 },
    );
    expect(halt).toBe(true);
  });
});
