import { describe, it, expect } from "vitest";
import { quotingSchema } from "../../../src/config/schema.js";
import {
  detectTrendStressSample,
  isWrongWayTrendVsInventory,
  regimePolicyUsesT0Cancel,
  regimeThrottleSpreadMult,
  shouldEmitTrendHaltRequest,
} from "../../../src/domain/regime/regime-trend-stress-policy.js";

describe("regime-trend-stress-policy", () => {
  it("regimePolicyUsesT0Cancel: legacy false, others true", () => {
    expect(regimePolicyUsesT0Cancel("legacy")).toBe(false);
    expect(regimePolicyUsesT0Cancel("cancel_throttle")).toBe(true);
    expect(regimePolicyUsesT0Cancel("ladder_mvp")).toBe(true);
    expect(regimePolicyUsesT0Cancel("ladder_full")).toBe(true);
  });

  it("shouldEmitTrendHaltRequest: legacy halts on first sample", () => {
    expect(
      shouldEmitTrendHaltRequest({ policy: "legacy", consecutiveStressedSamples: 1, persistenceN: 3 }),
    ).toBe(true);
    expect(
      shouldEmitTrendHaltRequest({ policy: "legacy", consecutiveStressedSamples: 0, persistenceN: 3 }),
    ).toBe(false);
  });

  it("shouldEmitTrendHaltRequest: non-legacy waits for persistence N", () => {
    expect(
      shouldEmitTrendHaltRequest({
        policy: "cancel_throttle",
        consecutiveStressedSamples: 2,
        persistenceN: 3,
      }),
    ).toBe(false);
    expect(
      shouldEmitTrendHaltRequest({
        policy: "cancel_throttle",
        consecutiveStressedSamples: 3,
        persistenceN: 3,
      }),
    ).toBe(true);
  });

  it("regimeThrottleSpreadMult respects active flag", () => {
    const q = quotingSchema.parse({ regimeTrendThrottleSpreadMult: 2 });
    expect(regimeThrottleSpreadMult(q, false)).toBe(1);
    expect(regimeThrottleSpreadMult(q, true)).toBe(2);
  });

  it("detectTrendStressSample: rv_scaled uses z vs sigma", () => {
    expect(
      detectTrendStressSample({
        lastMid: 100,
        mid: 100.25,
        impulseNormalizer: "rv_scaled",
        rvSigmaLn: 0.1,
        rvZHalt: 2.5,
      }),
    ).toBe("normal");
    expect(
      detectTrendStressSample({
        lastMid: 100,
        mid: 104,
        impulseNormalizer: "rv_scaled",
        rvSigmaLn: 0.01,
        rvZHalt: 2.5,
      }),
    ).toBe("stressed");
  });

  it("detectTrendStressSample: rv_scaled falls back when sigma missing", () => {
    expect(
      detectTrendStressSample({
        lastMid: 100,
        mid: 100.5,
        impulseNormalizer: "rv_scaled",
        rvSigmaLn: undefined,
        rvZHalt: 2.5,
      }),
    ).toBe("stressed");
  });

  it("detectTrendStressSample: none matches percentage tau", () => {
    expect(
      detectTrendStressSample({
        lastMid: 100,
        mid: 100.2,
        impulseNormalizer: "none",
        rvSigmaLn: 0.01,
        rvZHalt: 2.5,
      }),
    ).toBe("normal");
  });

  it("isWrongWayTrendVsInventory", () => {
    expect(isWrongWayTrendVsInventory({ deltaMid: -1, netQty: 1, minAbsQty: 0 })).toBe(true);
    expect(isWrongWayTrendVsInventory({ deltaMid: 1, netQty: 1, minAbsQty: 0 })).toBe(false);
    expect(isWrongWayTrendVsInventory({ deltaMid: -1, netQty: 0, minAbsQty: 0 })).toBe(false);
    expect(isWrongWayTrendVsInventory({ deltaMid: -1, netQty: 0.5, minAbsQty: 1 })).toBe(false);
  });
});
