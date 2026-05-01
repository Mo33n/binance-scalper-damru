import { describe, it, expect } from "vitest";
import {
  initialRegimeFsmMemory,
  stepLiquidityRegimeFsm,
} from "../../../../src/domain/liquidity/regime-state-machine.js";

const cfg = {
  hysteresisSamples: 3,
  defensiveSpreadMult: 1.25,
  reduceSpreadMult: 1.5,
  pausedSpreadMult: 2,
  flowDefensiveThreshold: 0.6,
  microDefensiveThreshold: 0.5,
  inventoryReduceThreshold: 0.9,
  flowOffThreshold: 0.99,
} as const;

describe("stepLiquidityRegimeFsm", () => {
  it("does not enter DEFENSIVE until hysteresis samples", () => {
    let mem = initialRegimeFsmMemory();
    let state: "COLLECT" | "DEFENSIVE" | "REDUCE" | "PAUSED" | "OFF" = "COLLECT";
    for (let i = 0; i < 2; i++) {
      const o = stepLiquidityRegimeFsm({
        prevState: state,
        memory: mem,
        flowScore: 0.9,
        microstructureScore: 0,
        inventoryNormalized: 0,
        config: cfg,
      });
      mem = o.memory;
      state = o.state;
      expect(state).toBe("COLLECT");
    }
    const o3 = stepLiquidityRegimeFsm({
      prevState: state,
      memory: mem,
      flowScore: 0.9,
      microstructureScore: 0,
      inventoryNormalized: 0,
      config: cfg,
    });
    expect(o3.state).toBe("DEFENSIVE");
    expect(o3.transitionReason).toBe("defensive_hysteresis");
  });

  it("OFF is immediate at flow threshold", () => {
    const o = stepLiquidityRegimeFsm({
      prevState: "COLLECT",
      memory: initialRegimeFsmMemory(),
      flowScore: 1,
      microstructureScore: 0,
      inventoryNormalized: 0,
      config: cfg,
    });
    expect(o.state).toBe("OFF");
    expect(o.transitionReason).toBe("flow_off_threshold");
  });
});
