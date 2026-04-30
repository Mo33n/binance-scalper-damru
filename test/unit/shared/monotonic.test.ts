import { describe, it, expect } from "vitest";
import { monotonicNowMs } from "../../../src/shared/monotonic.js";

describe("monotonicNowMs", () => {
  it("returns non-decreasing values", () => {
    const a = monotonicNowMs();
    const b = monotonicNowMs();
    expect(b).toBeGreaterThanOrEqual(a);
  });
});
