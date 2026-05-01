import { describe, it, expect } from "vitest";
import {
  isRetriableDepthSnapshotError,
  restResyncBackoffMs,
} from "../../../src/infrastructure/binance/depth-resync-policy.js";
import { BinanceRestError } from "../../../src/infrastructure/binance/rest-client.js";

describe("depth-resync-policy", () => {
  it("treats 429 and 5xx as retriable", () => {
    expect(isRetriableDepthSnapshotError(new BinanceRestError("r", 429, ""))).toBe(true);
    expect(isRetriableDepthSnapshotError(new BinanceRestError("r", 503, ""))).toBe(true);
    expect(isRetriableDepthSnapshotError(new BinanceRestError("r", 418, ""))).toBe(false);
  });

  it("treats unknown errors as retriable", () => {
    expect(isRetriableDepthSnapshotError(new Error("network"))).toBe(true);
  });

  it("grows backoff with attempt index", () => {
    const a = restResyncBackoffMs(0);
    const b = restResyncBackoffMs(3);
    expect(b).toBeGreaterThanOrEqual(a);
    expect(restResyncBackoffMs(20)).toBeLessThanOrEqual(35_000);
  });
});
