import { describe, it, expect } from "vitest";
import {
  computeHurdleBps,
  computeMakerEdgeBps,
  passesEdgeGate,
} from "../../../../src/domain/liquidity/edge-gate.js";
import type { EffectiveFees } from "../../../../src/infrastructure/binance/types.js";

const fees: EffectiveFees = Object.freeze({
  makerRate: 0.0002,
  takerRate: 0.0005,
  bnbDiscountEnabled: false,
  asOfIso: "2026-01-01T00:00:00.000Z",
});

describe("edge-gate", () => {
  it("computeMakerEdgeBps matches maker rate", () => {
    expect(computeMakerEdgeBps(fees)).toBeCloseTo(2, 5);
  });

  it("passes at wide half-spread vs hurdle", () => {
    const mid = 100;
    const r = passesEdgeGate({
      fees,
      mid,
      bidPx: 99,
      askPx: 101,
      lambdaSigma: 0,
      minEdgeBpsFloor: 0,
    });
    expect(r.hurdleBps).toBeCloseTo(2, 5);
    expect(r.bidHalfSpreadBps).toBeCloseTo(10_000 * ((mid - 99) / mid), 5);
    expect(r.askHalfSpreadBps).toBeCloseTo(10_000 * ((101 - mid) / mid), 5);
    expect(r.ok).toBe(true);
  });

  it("fails when touch collapses inside hurdle", () => {
    const mid = 50_000;
    const r = passesEdgeGate({
      fees,
      mid,
      bidPx: 49_999.5,
      askPx: 50_000.5,
      lambdaSigma: 0,
      minEdgeBpsFloor: 50,
    });
    expect(r.ok).toBe(false);
    expect(r.hurdleBps).toBeCloseTo(50 + 2, 5);
  });

  it("optional sigma increases hurdle via lambdaSigma", () => {
    const h0 = computeHurdleBps({
      fees,
      lambdaSigma: 1,
      sigmaLn: 0,
      minEdgeBpsFloor: 0,
    });
    const h1 = computeHurdleBps({
      fees,
      lambdaSigma: 1,
      sigmaLn: 0.0001,
      minEdgeBpsFloor: 0,
    });
    expect(h1).toBeGreaterThan(h0);
  });
});
