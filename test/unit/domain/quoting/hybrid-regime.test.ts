import { describe, it, expect } from "vitest";
import { classifyRegime } from "../../../../src/domain/quoting/hybrid-quoting.js";
import type { QuotingInputs } from "../../../../src/domain/quoting/types.js";

function baseInputs(over: Partial<QuotingInputs>): QuotingInputs {
  return {
    touch: { bestBid: 100, bestAsk: 100.1 },
    toxicityScore: 0,
    toxicityTau: 0.9,
    rvRegime: "normal",
    minSpreadTicks: 5,
    tickSize: 0.1,
    inventoryMode: "normal",
    baseOrderQty: 0.01,
    ...over,
  };
}

describe("classifyRegime regimeSplit", () => {
  it("matches legacy toxic when regimeSplit disabled (tight spread only)", () => {
    const legacy = classifyRegime(
      baseInputs({
        touch: { bestBid: 100, bestAsk: 100.05 },
        minSpreadTicks: 5,
      }),
    );
    expect(legacy).toBe("toxic");
  });

  it("flow_only: tight spread alone stays normal", () => {
    const r = classifyRegime(
      baseInputs({
        touch: { bestBid: 100, bestAsk: 100.05 },
        minSpreadTicks: 5,
        regimeSplit: { enabled: true, toxicCombineMode: "flow_only" },
      }),
    );
    expect(r).toBe("normal");
  });

  it("flow_only: high toxicity still toxic", () => {
    const r = classifyRegime(
      baseInputs({
        toxicityScore: 0.95,
        toxicityTau: 0.9,
        regimeSplit: { enabled: true, toxicCombineMode: "flow_only" },
      }),
    );
    expect(r).toBe("toxic");
  });

  it("both: requires flow and microstructure stress", () => {
    const tightOnly = classifyRegime(
      baseInputs({
        touch: { bestBid: 100, bestAsk: 100.05 },
        minSpreadTicks: 5,
        toxicityScore: 0,
        regimeSplit: { enabled: true, toxicCombineMode: "both" },
      }),
    );
    expect(tightOnly).toBe("normal");

    const both = classifyRegime(
      baseInputs({
        touch: { bestBid: 100, bestAsk: 100.05 },
        minSpreadTicks: 5,
        toxicityScore: 0.95,
        toxicityTau: 0.9,
        regimeSplit: { enabled: true, toxicCombineMode: "both" },
      }),
    );
    expect(both).toBe("toxic");
  });
});
