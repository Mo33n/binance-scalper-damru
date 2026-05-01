import { z } from "zod";

export const CONFIG_SCHEMA_VERSION = "1" as const;

export const featuresSchema = z.object({
  /** When false (default), ExecutionService is not constructed even if API keys exist (SPEC-02). */
  liveQuotingEnabled: z.boolean().default(false),
  markoutFeedbackEnabled: z.boolean().default(false),
  reconciliationIntervalOverrideEnabled: z.boolean().default(false),
  preFundingFlattenEnabled: z.boolean().default(false),
  regimeFlagsEnabled: z.boolean().default(false),
  /** RFC — inventory de-risk: reduce-only exits when ledger stress (default off until soak). */
  inventoryDeRiskEnabled: z.boolean().default(false),
  /** SPEC-08 — isolate each symbol in `worker_threads` (default off until stable). */
  useWorkerThreads: z.boolean().default(false),
  /**
   * Multiplex USD-M `@depth` over one `/stream?streams=...` socket (main thread only).
   * Incompatible with `useWorkerThreads` (validated in `superRefine`).
   */
  combinedDepthStream: z.boolean().default(false),
});

export const rolloutSchema = z.object({
  /** Rolling window (ms) for economics / markout review before size promotion (RFC §17.5). */
  markoutPromotionWindowMs: z.number().int().positive().default(86_400_000),
});

/**
 * RFC — liquidity engine umbrella (`liquidity-engine-evolution`): economics, portfolio gross,
 * regime-input split, two-leg placement. When omitted from config, liquidity engine features are off.
 */
export const liquidityEngineEdgeSchema = z.object({
  enforce: z.boolean().default(false),
  shadowOnly: z.boolean().default(false),
  lambdaSigma: z.number().finite().nonnegative().default(0),
  minEdgeBpsFloor: z.number().finite().nonnegative().default(0),
});

export const liquidityEngineSchema = z.object({
  enabled: z.boolean().default(false),
  /**
   * When `false` with `enabled`, refresh quotes via target-book vs `openOrders` diff (RFC P2).
   * When `true` (default), keep cancel-all + full replace (`cancelAll` + `placeFromIntent`).
   */
  useLegacyCancelAllRefresh: z.boolean().default(true),
  edge: liquidityEngineEdgeSchema.default({
    enforce: false,
    shadowOnly: false,
    lambdaSigma: 0,
    minEdgeBpsFloor: 0,
  }),
  portfolio: z
    .object({
      enforceGlobal: z.boolean().default(false),
      /** RFC P3 — scale per-symbol notional cap and (with `enforceGlobal`) gross by β vs ref asset. */
      betaCapEnabled: z.boolean().default(false),
      /** Symbol → β vs reference (e.g. BTC). Omitted symbols default to 1. */
      betaToRef: z.record(z.string().min(1), z.number().finite().positive()).default({}),
    })
    .default({ enforceGlobal: false, betaCapEnabled: false, betaToRef: {} }),
  regimeSplit: z
    .object({
      enabled: z.boolean().default(false),
      toxicCombineMode: z
        .enum(["any", "flow_only", "microstructure_only", "both"])
        .default("any"),
    })
    .default({ enabled: false, toxicCombineMode: "any" }),
  twoLegSafety: z
    .object({
      enabled: z.boolean().default(false),
    })
    .default({ enabled: false }),
  fairValue: z
    .object({
      mode: z.enum(["touch", "microprice"]).default("touch"),
    })
    .default({ mode: "touch" }),
  inventorySkew: z
    .object({
      enabled: z.boolean().default(false),
      kappaTicks: z.number().finite().nonnegative().default(0),
      maxShiftTicks: z.number().finite().nonnegative().optional(),
    })
    .default({ enabled: false, kappaTicks: 0 }),
  regimeFsm: z
    .object({
      enabled: z.boolean().default(false),
      hysteresisSamples: z.number().int().positive().default(3),
      defensiveSpreadMult: z.number().finite().gte(1).default(1.25),
      reduceSpreadMult: z.number().finite().gte(1).default(1.5),
      pausedSpreadMult: z.number().finite().gte(1).default(2),
      flowDefensiveThreshold: z.number().finite().min(0).max(1).default(0.65),
      microDefensiveThreshold: z.number().finite().min(0).max(1).default(0.5),
      inventoryReduceThreshold: z.number().finite().min(0).max(1).default(0.75),
      flowOffThreshold: z.number().finite().min(0).max(1).default(0.95),
    })
    .default({
      enabled: false,
      hysteresisSamples: 3,
      defensiveSpreadMult: 1.25,
      reduceSpreadMult: 1.5,
      pausedSpreadMult: 2,
      flowDefensiveThreshold: 0.65,
      microDefensiveThreshold: 0.5,
      inventoryReduceThreshold: 0.75,
      flowOffThreshold: 0.95,
    }),
  quoteTriggers: z
    .object({
      enabled: z.boolean().default(false),
      epsilonTicks: z.number().finite().positive().default(1),
    })
    .default({ enabled: false, epsilonTicks: 1 }),
});

export type LiquidityEngineConfig = z.infer<typeof liquidityEngineSchema>;

/** Hybrid quoting cadence + staleness guards (SPEC-05). */
export const quotingSchema = z.object({
  repriceMinIntervalMs: z.number().int().positive().default(250),
  maxBookStalenessMs: z.number().int().positive().default(3000),
  /**
   * Min wall-clock gap between quoting orchestrator warns (`quoting.de_risk_suppressed`, `quoting.de_risk_unfillable_dust`, …).
   * `0` = use `repriceMinIntervalMs` (legacy, can be noisy at fast repricing).
   */
  warnLogCooldownMs: z.number().int().nonnegative().default(60_000),
  /**
   * Optional override for per-quote leg size (base asset). When omitted, uses 5% of `risk.maxAbsQty`
   * capped by `maxAbsQty` (documented convention — tune via override on live).
   */
  baseOrderQty: z.number().positive().optional(),
  /**
   * Regime trend-stress escalation (RFC `regime-trend-stress-tasks.md`).
   * `legacy` = halt_request on first trend/book/RV trip only (no auto cancel-all).
   */
  regimeTrendStressPolicy: z
    .enum(["legacy", "cancel_throttle", "ladder_mvp", "ladder_full"])
    .default("legacy"),
  /** Consecutive stressed trend samples before emitting halt_request (non-legacy policies). Book/RV still halt immediately. */
  regimeTrendStressPersistenceN: z.number().int().positive().default(3),
  /** When regime throttle active, effective min spread ticks ≈ ceil(base × mult). 1 = no widening. */
  regimeTrendThrottleSpreadMult: z.number().finite().gte(1).default(1.25),
  /** Minimum |netQty| (base) to treat wrong-way trend as inventory-flatten candidate (`ladder_*`). */
  regimeTrendInventoryMinQty: z.number().nonnegative().default(0),
  /**
   * After mid returns below trend threshold, dwell this long (monotonic ms) before clearing throttle / consecutive counter.
   * 0 = clear on first non-stressed sample.
   */
  regimeStressClearedMs: z.number().int().nonnegative().default(0),
  /** `none` = relative mid step (`DEFAULT_REGIME_TREND_STRESS`); `rv_scaled` = |Δln mid| / σ when RV EWMA σ available (`risk.rvEnabled`). */
  regimeTrendImpulseNormalizer: z.enum(["none", "rv_scaled"]).default("none"),
  /** Halt threshold on normalized impulse z when `regimeTrendImpulseNormalizer` is `rv_scaled`. */
  regimeTrendRvZHalt: z.number().positive().default(2.5),
  /** Optional nested defaults merge when `liquidityEngine` key is present (even `{}`). */
  liquidityEngine: liquidityEngineSchema.optional(),
});

const perSymbolEntrySchema = z.object({
  schemaVersion: z.literal("1").default("1"),
  symbol: z.string().min(1),
  effectiveFrom: z.string().optional(),
  minSpreadTicks: z.number().int().positive().optional(),
});

export const appConfigSchema = z
  .object({
  configSchemaVersion: z.literal(CONFIG_SCHEMA_VERSION),
  environment: z.enum(["testnet", "live"]),
  /** When set, must equal `environment` (guards accidental live process with testnet credential profile). */
  credentialProfile: z.enum(["testnet", "live"]).optional(),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  binance: z.object({
    restBaseUrl: z.string().url(),
    wsBaseUrl: z.string().url(),
    feeRefreshIntervalMs: z.number().positive().default(86_400_000),
    feeSafetyBufferBps: z.number().nonnegative().default(1),
    /**
     * Process-wide limit on concurrent REST `/fapi/v1/depth` snapshot fetches (multi-symbol 429 mitigation).
     */
    maxConcurrentDepthSnapshots: z.number().int().positive().max(32).default(2),
    /**
     * Minimum wall-clock gap between *starting* depth snapshots on the shared gate (0 = no extra spacing).
     */
    depthSnapshotMinIntervalMs: z.number().int().nonnegative().default(100),
  }),
  symbols: z.array(z.string().min(1)),
  risk: z.object({
    sessionLossCapQuote: z.number().positive(),
    /** Optional separate daily cap; defaults to `sessionLossCapQuote` when omitted (SPEC-09 loss guard). */
    dailyLossCapQuote: z.number().positive().optional(),
    maxOpenNotionalQuote: z.number().positive(),
    defaultMinSpreadTicks: z.number().int().positive().default(5),
    maxDesiredLeverage: z.number().int().positive().default(50),
    riskMaxLeverage: z.number().int().positive().default(20),
    vpinBucketVolume: z.number().positive().default(1),
    vpinBucketBasis: z.enum(["base", "quote"]).default("base"),
    vpinEwmaN: z.number().int().positive().default(5),
    vpinStaleFlushMs: z.number().positive().default(60_000),
    vpinTau: z.number().gt(0).lt(1).default(0.6),
    rvEnabled: z.boolean().default(false),
    rvTau: z.number().positive().default(0.0005),
    maxAbsQty: z.number().positive().default(1),
    maxAbsNotional: z.number().positive().default(10_000),
    globalMaxAbsNotional: z.number().positive().default(25_000),
    inventoryEpsilon: z.number().nonnegative().default(0),
    maxTimeAboveEpsilonMs: z.number().positive().default(60_000),
    /** Minimum wall-clock gap between `risk.limit_breach` logs for the same metric/symbol; `0` logs every evaluation. */
    riskLimitBreachLogCooldownMs: z.number().int().nonnegative().default(60_000),
    warnUtilization: z.number().gt(0).lt(1).default(0.7),
    criticalUtilization: z.number().gt(0).lt(1).default(0.85),
    haltUtilization: z.number().gt(0).lt(1).default(0.95),
    preFundingFlattenMinutes: z.number().int().nonnegative().default(0),
    /** RFC — when `features.inventoryDeRiskEnabled`, controls automated exit style; `off` logs suppression and skips cancel/replace de-risk. */
    deRiskMode: z.enum(["off", "passive_touch", "ioc_touch"]).default("passive_touch"),
    /**
     * When true with inventory de-risk: only place reduce-only exit if touch exit improves vs `avgEntryPrice`
     * by at least `deRiskMinProfitTicks` (long: best ask ≥ avg + n×tick; short: best bid ≤ avg − n×tick).
     */
    deRiskProfitOnly: z.boolean().default(false),
    /** Minimum favorable ticks vs avg entry before automated de-risk may fire (ignored when `deRiskProfitOnly` is false). */
    deRiskMinProfitTicks: z.number().int().nonnegative().default(0),
  }),
  features: featuresSchema.default({
    liveQuotingEnabled: false,
    markoutFeedbackEnabled: false,
    reconciliationIntervalOverrideEnabled: false,
    preFundingFlattenEnabled: false,
    regimeFlagsEnabled: false,
    inventoryDeRiskEnabled: false,
    useWorkerThreads: false,
    combinedDepthStream: false,
  }),
  rollout: rolloutSchema.default({ markoutPromotionWindowMs: 86_400_000 }),
  quoting: quotingSchema.default({
    repriceMinIntervalMs: 250,
    maxBookStalenessMs: 3000,
    warnLogCooldownMs: 60_000,
    regimeTrendStressPolicy: "legacy",
    regimeTrendStressPersistenceN: 3,
    regimeTrendThrottleSpreadMult: 1.25,
    regimeTrendInventoryMinQty: 0,
    regimeStressClearedMs: 0,
    regimeTrendImpulseNormalizer: "none",
    regimeTrendRvZHalt: 2.5,
  }),
  credentials: z
    .object({
      apiKey: z.string().optional(),
      apiSecret: z.string().optional(),
    })
    .default({}),
  heartbeatIntervalMs: z.number().positive().default(5000),
  heartbeatMissThreshold: z.number().int().positive().default(3),
  /** Ledger vs REST position check interval (SPEC-06); open-order parity deferred. */
  reconciliationIntervalMs: z.number().int().positive().default(60_000),
  perSymbolOverrides: z.array(perSymbolEntrySchema).default([]),
})
  .superRefine((data, ctx) => {
    if (data.credentialProfile !== undefined && data.credentialProfile !== data.environment) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "credentialProfile must match environment (prevents mixing live trading with a testnet credential profile label)",
        path: ["credentialProfile"],
      });
    }
    if (data.features.combinedDepthStream && data.features.useWorkerThreads) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "combinedDepthStream is not supported with useWorkerThreads (each worker needs its own depth transport)",
        path: ["features", "combinedDepthStream"],
      });
    }
  });

export type AppConfig = z.infer<typeof appConfigSchema>;
export type PerSymbolConfigEntry = z.infer<typeof perSymbolEntrySchema>;

/** Derived flag: single codebase, config-only env switch (RFC §13.3). */
export function configIsTestnet(cfg: AppConfig): boolean {
  return cfg.environment === "testnet";
}
