/** Pure quoting types — no I/O (hexagonal domain). */
export type QuoteSide = "buy" | "sell";

export interface Touch {
  readonly bestBid: number;
  readonly bestAsk: number;
}

export type InventoryMode = "normal" | "stress";

/** Neutral posture until SPEC-06 user-stream ledger drives inventory stress. */
export const DEFAULT_INVENTORY_MODE: InventoryMode = "normal";

export type QuotingRegime = "normal" | "toxic" | "inventory_stress";

export interface QuotingInputs {
  readonly touch: Touch;
  readonly toxicityScore: number;
  readonly toxicityTau: number;
  readonly rvRegime: "normal" | "stressed";
  readonly minSpreadTicks: number;
  readonly tickSize: number;
  readonly inventoryMode: InventoryMode;
  readonly baseOrderQty: number;
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
