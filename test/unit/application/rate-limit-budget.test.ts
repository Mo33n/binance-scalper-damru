import { describe, expect, it } from "vitest";
import { TokenBucket } from "../../../src/application/services/rate-limit-budget.js";

describe("TokenBucket", () => {
  it("delays when bucket empty and refills over time", () => {
    const b = new TokenBucket({ capacity: 10, refillPerSecond: 2 }, 0);
    expect(b.tryAcquire(10, 0)).toBe(true);
    expect(b.tryAcquire(1, 0)).toBe(false);
    expect(b.tryAcquire(1, 500)).toBe(true);
  });

  it("backs off after 429", () => {
    const b = new TokenBucket({ capacity: 10, refillPerSecond: 10 }, 0);
    b.on429(1000, 2);
    expect(b.tryAcquire(1, 1100)).toBe(false);
    expect(b.tryAcquire(1, 2100)).toBe(true);
  });
});
