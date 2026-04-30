export interface ClosedBucket {
  readonly index: number;
  readonly buyVolume: number;
  readonly sellVolume: number;
  readonly imbalance: number;
}

export interface ToxicitySnapshot {
  readonly bucketIndex: number;
  readonly lastImbalance: number;
  readonly toxicityScore: number;
  readonly totalBuyVolume: number;
  readonly totalSellVolume: number;
  readonly staleFlushCount: number;
}

export type VolumeBasis = "base" | "quote";

export interface VpinConfig {
  readonly targetBucketVolume: number;
  readonly basis: VolumeBasis;
  readonly ewmaN: number;
  readonly staleFlushMs: number;
  readonly epsilon?: number;
}

export type RvRegime = "normal" | "stressed";

export interface QuotingInputs {
  readonly toxicityScore: number;
  readonly rvRegime: RvRegime;
  readonly touchSpreadTicks?: number;
}
