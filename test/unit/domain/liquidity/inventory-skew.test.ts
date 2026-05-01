import { describe, it, expect } from "vitest";
import { applyInventorySkew } from "../../../../src/domain/liquidity/inventory-skew.js";

describe("inventory-skew", () => {
  it("zero skew when flat", () => {
    const r = applyInventorySkew({
      netQty: 0,
      maxAbsQty: 1,
      kappaTicks: 2,
      tickSize: 0.5,
      bidPx: 100,
      askPx: 101,
    });
    expect(r.bidPx).toBe(100);
    expect(r.askPx).toBe(101);
  });

  it("long inventory shifts both sides down", () => {
    const r = applyInventorySkew({
      netQty: 1,
      maxAbsQty: 1,
      kappaTicks: 4,
      tickSize: 0.5,
      bidPx: 100,
      askPx: 101,
    });
    expect(r.bidPx).toBeLessThan(100);
    expect(r.askPx).toBeLessThan(101);
    expect(100 - r.bidPx).toBeCloseTo(101 - r.askPx, 10);
  });

  it("respects maxShiftTicks", () => {
    const r = applyInventorySkew({
      netQty: 1,
      maxAbsQty: 1,
      kappaTicks: 100,
      tickSize: 1,
      bidPx: 100,
      askPx: 102,
      maxShiftTicks: 2,
    });
    expect(100 - r.bidPx).toBeLessThanOrEqual(2);
  });
});
