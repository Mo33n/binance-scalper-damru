import { z } from "zod";
import type { AppConfig } from "../../config/schema.js";
import type { BootstrapSymbolDecision } from "../../application/services/bootstrap-exchange.js";
import type { EffectiveFees, SymbolSpec } from "../../infrastructure/binance/types.js";

export const WORKER_BOOTSTRAP_V = 1 as const;

const symbolSpecSchema = z.object({
  symbol: z.string(),
  status: z.string(),
  contractType: z.string().optional(),
  tickSize: z.number(),
  stepSize: z.number(),
  minNotional: z.number(),
  contractSize: z.number(),
});

const feesSchema = z.object({
  makerRate: z.number(),
  takerRate: z.number(),
  bnbDiscountEnabled: z.boolean(),
  asOfIso: z.string(),
  symbol: z.string().optional(),
});

const decisionSchema = z.object({
  symbol: z.string(),
  status: z.enum(["accepted", "rejected"]),
  reason: z.string().optional(),
  effectiveMinSpreadTicks: z.number().optional(),
  chosenLeverage: z.number().optional(),
});

export const workerBootstrapPayloadSchema = z.object({
  v: z.literal(WORKER_BOOTSTRAP_V),
  workerId: z.string().min(1),
  symbol: z.string().min(1),
  spec: symbolSpecSchema,
  /** RFC X3 — parent-fetched USD-M position + mark (workers have no signing keys). */
  initialPosition: z
    .object({
      netQty: z.number().finite(),
      markPrice: z.number().finite().nonnegative(),
    })
    .optional(),
  configSubset: z.object({
    binance: z.object({
      restBaseUrl: z.string().url(),
      wsBaseUrl: z.string().url(),
      feeRefreshIntervalMs: z.number(),
      feeSafetyBufferBps: z.number(),
      maxConcurrentDepthSnapshots: z.number().int().positive().max(32).default(2),
      depthSnapshotMinIntervalMs: z.number().int().nonnegative().default(100),
    }),
    /** Parent-built plain JSON; validated structurally on parent — worker trusts after zod shell parse. */
    risk: z.any(),
    quoting: z.any(),
    features: z.any(),
    heartbeatIntervalMs: z.number().int().positive(),
    logLevel: z.enum(["debug", "info", "warn", "error"]),
    environment: z.enum(["testnet", "live"]),
  }),
  fees: feesSchema,
  decisions: z.array(decisionSchema),
});

export type WorkerBootstrapPayloadV1 = Omit<
  z.infer<typeof workerBootstrapPayloadSchema>,
  "spec" | "configSubset" | "fees" | "decisions"
> & {
  readonly spec: SymbolSpec;
  readonly fees: EffectiveFees;
  readonly decisions: readonly BootstrapSymbolDecision[];
  readonly initialPosition?: { readonly netQty: number; readonly markPrice: number };
  readonly configSubset: {
    readonly binance: AppConfig["binance"];
    readonly risk: AppConfig["risk"];
    readonly quoting: AppConfig["quoting"];
    readonly features: AppConfig["features"];
    readonly heartbeatIntervalMs: number;
    readonly logLevel: AppConfig["logLevel"];
    readonly environment: AppConfig["environment"];
  };
};

export function parseWorkerBootstrapPayload(raw: unknown): WorkerBootstrapPayloadV1 {
  const r = workerBootstrapPayloadSchema.safeParse(raw);
  if (!r.success) {
    throw new Error(`worker_bootstrap_invalid: ${r.error.message}`);
  }
  return r.data as WorkerBootstrapPayloadV1;
}

export function buildWorkerBootstrapPayload(input: {
  readonly workerId: string;
  readonly symbol: string;
  readonly spec: SymbolSpec;
  readonly sessionConfig: AppConfig;
  readonly fees: EffectiveFees;
  readonly decisions: readonly BootstrapSymbolDecision[];
  readonly initialPosition?: { readonly netQty: number; readonly markPrice: number };
}): WorkerBootstrapPayloadV1 {
  const c = input.sessionConfig;
  return {
    v: WORKER_BOOTSTRAP_V,
    workerId: input.workerId,
    symbol: input.symbol,
    spec: input.spec,
    ...(input.initialPosition !== undefined ? { initialPosition: input.initialPosition } : {}),
    configSubset: {
      binance: c.binance,
      risk: c.risk,
      quoting: c.quoting,
      features: c.features,
      heartbeatIntervalMs: c.heartbeatIntervalMs,
      logLevel: c.logLevel,
      environment: c.environment,
    },
    fees: input.fees,
    decisions: [...input.decisions],
  };
}
