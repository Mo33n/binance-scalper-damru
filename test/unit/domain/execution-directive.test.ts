import { describe, it, expect } from "vitest";
import {
  buildDeRiskExitPlan,
  resolveExecutionDirective,
} from "../../../src/domain/quoting/execution-directive.js";
import type { QuotingInputs } from "../../../src/domain/quoting/types.js";
import type { SymbolExecutionConstraints } from "../../../src/domain/quoting/types.js";

const spec: SymbolExecutionConstraints = {
  symbol: "BTCUSDT",
  tickSize: 0.1,
  stepSize: 0.001,
  minNotional: 5,
  contractSize: 1,
};

const baseHybridInputs = (inventoryMode: QuotingInputs["inventoryMode"]): QuotingInputs => ({
  touch: { bestBid: 50_000, bestAsk: 50_001 },
  toxicityScore: 0,
  toxicityTau: 0.99,
  rvRegime: "normal",
  minSpreadTicks: 5,
  tickSize: spec.tickSize,
  inventoryMode,
  baseOrderQty: 0.05,
});

describe("resolveExecutionDirective", () => {
  it("non-stress returns quote intent", () => {
    const d = resolveExecutionDirective({
      inventoryMode: "normal",
      features: { inventoryDeRiskEnabled: true },
      risk: { deRiskMode: "passive_touch" },
      hybridInputs: baseHybridInputs("normal"),
      symbolNetQty: 0,
      spec,
      touch: { bestBid: 50_000, bestAsk: 50_001 },
    });
    expect(d.kind).toBe("quote");
    if (d.kind === "quote") {
      expect(d.intent.bidPx).toBeDefined();
    }
  });

  it("stress + de-risk enabled + passive_touch yields de_risk sell for long", () => {
    const d = resolveExecutionDirective({
      inventoryMode: "stress",
      features: { inventoryDeRiskEnabled: true },
      risk: { deRiskMode: "passive_touch" },
      hybridInputs: baseHybridInputs("stress"),
      symbolNetQty: 0.5,
      spec,
      touch: { bestBid: 50_000, bestAsk: 50_001 },
    });
    expect(d.kind).toBe("de_risk");
    if (d.kind === "de_risk") {
      expect(d.exit.side).toBe("SELL");
      expect(d.exit.quantity).toBe(0.5);
      expect(d.exit.mode).toBe("passive_touch");
    }
  });

  it("stress + net zero masks hybrid to normal (global breach only)", () => {
    const d = resolveExecutionDirective({
      inventoryMode: "stress",
      features: { inventoryDeRiskEnabled: false },
      risk: { deRiskMode: "passive_touch" },
      hybridInputs: baseHybridInputs("stress"),
      symbolNetQty: 0,
      spec,
      touch: { bestBid: 50_000, bestAsk: 50_001 },
    });
    expect(d.kind).toBe("quote");
    if (d.kind === "quote") {
      expect(d.intent.regime).not.toBe("inventory_stress");
    }
  });
});

describe("buildDeRiskExitPlan", () => {
  it("returns dust when notional below minNotional", () => {
    const r = buildDeRiskExitPlan({
      spec: { ...spec, minNotional: 1_000_000 },
      touch: { bestBid: 1, bestAsk: 1.1 },
      netQty: 0.001,
      mode: "passive_touch",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("dust");
  });
});
