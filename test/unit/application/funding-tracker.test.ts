import { describe, expect, it } from "vitest";
import { FundingTracker } from "../../../src/application/services/funding-tracker.js";

describe("FundingTracker", () => {
  it("accumulates funding with sign convention preserved", () => {
    const tracker = new FundingTracker();
    tracker.onFunding({ symbol: "BTCUSDT", fundingQuote: -1.2, timestampMs: 1 });
    tracker.onFunding({ symbol: "BTCUSDT", fundingQuote: 0.3, timestampMs: 2 });
    tracker.onFunding({ symbol: "ETHUSDT", fundingQuote: 0.5, timestampMs: 3 });

    const summary = tracker.getFundingSummary();
    expect(summary.bySymbol["BTCUSDT"]).toBeCloseTo(-0.9);
    expect(summary.bySymbol["ETHUSDT"]).toBeCloseTo(0.5);
    expect(summary.totalFundingQuote).toBeCloseTo(-0.4);
  });
});
