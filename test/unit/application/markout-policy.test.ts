import { describe, expect, it } from "vitest";
import type { MarkoutTracker } from "../../../src/application/services/markout-tracker.js";
import { EwmaMarkoutPolicy } from "../../../src/application/services/markout-policy.js";

describe("EwmaMarkoutPolicy", () => {
  it("returns maxExtraTicks when EWMA is worse than adverse threshold", () => {
    const tracker = { getEwma: () => -50 } as Pick<MarkoutTracker, "getEwma"> as MarkoutTracker;
    const p = new EwmaMarkoutPolicy(tracker, {
      tickSize: 0.1,
      adverseEwmaTicks: 2,
      maxExtraTicks: 3,
    });
    expect(p.widenSpreadTicks()).toBe(3);
  });

  it("returns 0 when EWMA is above threshold", () => {
    const tracker = { getEwma: () => 0 } as Pick<MarkoutTracker, "getEwma"> as MarkoutTracker;
    const p = new EwmaMarkoutPolicy(tracker, {
      tickSize: 0.1,
      adverseEwmaTicks: 2,
      maxExtraTicks: 3,
    });
    expect(p.widenSpreadTicks()).toBe(0);
  });
});
