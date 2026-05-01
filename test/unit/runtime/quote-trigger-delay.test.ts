import { describe, it, expect } from "vitest";
import { computeQuoteTriggerDelayMs } from "../../../src/runtime/worker/symbol-loop.js";

describe("computeQuoteTriggerDelayMs (P1.6)", () => {
  it("waits remaining floor after partial elapsed", () => {
    expect(computeQuoteTriggerDelayMs(250, 50)).toBe(200);
  });

  it("returns 0 when elapsed exceeds floor", () => {
    expect(computeQuoteTriggerDelayMs(250, 300)).toBe(0);
  });
});
