/** Liquidity regime states (RFC §4.3.2 MVP subset). */
export type LiquidityRegimeState = "COLLECT" | "DEFENSIVE" | "REDUCE" | "PAUSED" | "OFF";

export interface RegimeFsmMemory {
  readonly stressStreak: number;
  readonly calmStreak: number;
}

export interface RegimeFsmConfig {
  readonly hysteresisSamples: number;
  readonly defensiveSpreadMult: number;
  readonly reduceSpreadMult: number;
  readonly pausedSpreadMult: number;
  readonly flowDefensiveThreshold: number;
  readonly microDefensiveThreshold: number;
  readonly inventoryReduceThreshold: number;
  readonly flowOffThreshold: number;
}

const INITIAL_MEMORY: RegimeFsmMemory = Object.freeze({ stressStreak: 0, calmStreak: 0 });

export function initialRegimeFsmMemory(): RegimeFsmMemory {
  return { ...INITIAL_MEMORY };
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x;
}

/**
 * Pure transition with hysteresis on DEFENSIVE ↔ COLLECT.
 * OFF / REDUCE are immediate from thresholds when conditions hold.
 * PAUSED reserved (unused in MVP — enum kept for logs / forward compatibility).
 */
export function stepLiquidityRegimeFsm(args: {
  readonly prevState: LiquidityRegimeState;
  readonly memory: RegimeFsmMemory;
  readonly flowScore: number;
  readonly microstructureScore: number;
  readonly inventoryNormalized: number;
  readonly config: RegimeFsmConfig;
}): {
  readonly state: LiquidityRegimeState;
  readonly memory: RegimeFsmMemory;
  readonly transitionReason?: string;
} {
  const cfg = args.config;
  const flow = clamp01(args.flowScore);
  const micro = clamp01(args.microstructureScore);
  const inv = clamp01(args.inventoryNormalized);
  const h = Math.max(1, Math.floor(cfg.hysteresisSamples));

  if (flow >= cfg.flowOffThreshold) {
    return {
      state: "OFF",
      memory: { stressStreak: 0, calmStreak: 0 },
      transitionReason: "flow_off_threshold",
    };
  }

  if (inv >= cfg.inventoryReduceThreshold) {
    return {
      state: "REDUCE",
      memory: { stressStreak: 0, calmStreak: 0 },
      transitionReason: "inventory_reduce_threshold",
    };
  }

  const stressed = flow >= cfg.flowDefensiveThreshold || micro >= cfg.microDefensiveThreshold;

  let stressStreak = args.memory.stressStreak;
  let calmStreak = args.memory.calmStreak;

  if (stressed) {
    stressStreak += 1;
    calmStreak = 0;
  } else {
    calmStreak += 1;
    stressStreak = 0;
  }

  let nextState: LiquidityRegimeState = "COLLECT";
  let reason: string | undefined;

  const prev = args.prevState;
  if (prev === "OFF" || prev === "REDUCE") {
    nextState = "COLLECT";
    reason = prev === "OFF" ? "recover_from_off" : "recover_from_reduce";
  } else if (prev === "DEFENSIVE") {
    if (calmStreak >= h) {
      nextState = "COLLECT";
      reason = "collect_hysteresis";
    } else {
      nextState = "DEFENSIVE";
    }
  } else {
    /* COLLECT or PAUSED — treat PAUSED as COLLECT for MVP */
    if (stressStreak >= h) {
      nextState = "DEFENSIVE";
      reason = "defensive_hysteresis";
    } else {
      nextState = "COLLECT";
    }
  }

  return {
    state: nextState,
    memory: { stressStreak, calmStreak },
    ...(reason !== undefined ? { transitionReason: reason } : {}),
  };
}

/** Spread multiplier from liquidity regime (combined with trend-stress mult in orchestrator). */
export function liquidityRegimeSpreadMultiplier(
  state: LiquidityRegimeState,
  cfg: Pick<RegimeFsmConfig, "defensiveSpreadMult" | "reduceSpreadMult" | "pausedSpreadMult">,
): number {
  switch (state) {
    case "DEFENSIVE":
      return cfg.defensiveSpreadMult;
    case "REDUCE":
      return cfg.reduceSpreadMult;
    case "PAUSED":
      return cfg.pausedSpreadMult;
    default:
      return 1;
  }
}
