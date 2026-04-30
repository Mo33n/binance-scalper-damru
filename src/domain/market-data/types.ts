export interface BookLevel {
  readonly price: number;
  readonly qty: number;
}

export interface BookSnapshot {
  readonly symbol: string;
  readonly bids: readonly BookLevel[];
  readonly asks: readonly BookLevel[];
  readonly bestBid?: BookLevel;
  readonly bestAsk?: BookLevel;
  readonly spreadTicks?: number;
  readonly exchangeEventTimeMs?: number;
}

export interface TapeTrade {
  readonly symbol: string;
  readonly tradeId: number;
  readonly price: number;
  readonly quantity: number;
  readonly side: "buy" | "sell";
  readonly eventTimeMs: number;
}

export interface DepthDiffEvent {
  readonly symbol: string;
  readonly firstUpdateId: number; // U
  readonly finalUpdateId: number; // u
  readonly prevFinalUpdateId?: number; // pu
  readonly bids: readonly BookLevel[];
  readonly asks: readonly BookLevel[];
  readonly eventTimeMs?: number;
}
