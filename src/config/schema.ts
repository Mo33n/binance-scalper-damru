import { z } from "zod";

export const CONFIG_SCHEMA_VERSION = "1" as const;

export const featuresSchema = z.object({
  /** When false (default), ExecutionService is not constructed even if API keys exist (SPEC-02). */
  liveQuotingEnabled: z.boolean().default(false),
  markoutFeedbackEnabled: z.boolean().default(false),
  reconciliationIntervalOverrideEnabled: z.boolean().default(false),
  preFundingFlattenEnabled: z.boolean().default(false),
  regimeFlagsEnabled: z.boolean().default(false),
  /** SPEC-08 — isolate each symbol in `worker_threads` (default off until stable). */
  useWorkerThreads: z.boolean().default(false),
});

export const rolloutSchema = z.object({
  /** Rolling window (ms) for economics / markout review before size promotion (RFC §17.5). */
  markoutPromotionWindowMs: z.number().int().positive().default(86_400_000),
});

/** Hybrid quoting cadence + staleness guards (SPEC-05). */
export const quotingSchema = z.object({
  repriceMinIntervalMs: z.number().int().positive().default(250),
  maxBookStalenessMs: z.number().int().positive().default(3000),
  /**
   * Optional override for per-quote leg size (base asset). When omitted, uses 5% of `risk.maxAbsQty`
   * capped by `maxAbsQty` (documented convention — tune via override on live).
   */
  baseOrderQty: z.number().positive().optional(),
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
    warnUtilization: z.number().gt(0).lt(1).default(0.7),
    criticalUtilization: z.number().gt(0).lt(1).default(0.85),
    haltUtilization: z.number().gt(0).lt(1).default(0.95),
    preFundingFlattenMinutes: z.number().int().nonnegative().default(0),
  }),
  features: featuresSchema.default({
    liveQuotingEnabled: false,
    markoutFeedbackEnabled: false,
    reconciliationIntervalOverrideEnabled: false,
    preFundingFlattenEnabled: false,
    regimeFlagsEnabled: false,
    useWorkerThreads: false,
  }),
  rollout: rolloutSchema.default({ markoutPromotionWindowMs: 86_400_000 }),
  quoting: quotingSchema.default({
    repriceMinIntervalMs: 250,
    maxBookStalenessMs: 3000,
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
  });

export type AppConfig = z.infer<typeof appConfigSchema>;
export type PerSymbolConfigEntry = z.infer<typeof perSymbolEntrySchema>;

/** Derived flag: single codebase, config-only env switch (RFC §13.3). */
export function configIsTestnet(cfg: AppConfig): boolean {
  return cfg.environment === "testnet";
}
