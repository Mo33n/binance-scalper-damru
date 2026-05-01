/** Pure quoting types — no I/O (hexagonal domain). */
export type QuoteSide = "buy" | "sell";

/** Venue-agnostic sizing filters (maps from `SymbolSpec` at the application edge). */
export interface SymbolExecutionConstraints {
  readonly symbol: string;
  readonly tickSize: number;
  readonly stepSize: number;
  readonly minNotional: number;
  readonly contractSize: number;
}

export interface Touch {
  readonly bestBid: number;
  readonly bestAsk: number;
}

export type InventoryMode = "normal" | "stress";

/** Neutral posture until SPEC-06 user-stream ledger drives inventory stress. */
export const DEFAULT_INVENTORY_MODE: InventoryMode = "normal";

export type QuotingRegime = "normal" | "toxic" | "inventory_stress";

export type ToxicCombineMode = "any" | "flow_only" | "microstructure_only" | "both";

export type FairValueMode = "touch" | "microprice";

export interface QuotingInputs {
  readonly touch: Touch;
  readonly toxicityScore: number;
  readonly toxicityTau: number;
  readonly rvRegime: "normal" | "stressed";
  readonly minSpreadTicks: number;
  readonly tickSize: number;
  readonly inventoryMode: InventoryMode;
  readonly baseOrderQty: number;
  /**
   * When `regimeSplit.enabled`, `classifyRegime` combines flow vs microstructure toxicity per `toxicCombineMode`.
   * When absent or disabled, behavior matches legacy single-expression toxic classification (`any`).
   */
  readonly regimeSplit?: {
    readonly enabled: boolean;
    readonly toxicCombineMode: ToxicCombineMode;
  };
  /** Optional fair anchor mid (e.g. microprice); used when `fairValueMode === "microprice"`. */
  readonly fairMid?: number;
  readonly fairValueMode?: FairValueMode;
  readonly inventorySkew?: {
    readonly enabled: boolean;
    readonly kappaTicks: number;
    readonly maxShiftTicks?: number;
    readonly netQty: number;
    readonly maxAbsQty: number;
  };
}

export interface QuoteIntent {
  readonly regime: QuotingRegime;
  readonly bidPx?: number;
  readonly askPx?: number;
  readonly bidQty?: number;
  readonly askQty?: number;
  readonly postOnly: boolean;
  readonly reduceOnly: boolean;
  readonly reason: string;
}

export interface FlattenIntent {
  readonly side: QuoteSide;
  readonly quantity: number;
  readonly reduceOnly: true;
  readonly aggressive: true;
  readonly reason: string;
}
