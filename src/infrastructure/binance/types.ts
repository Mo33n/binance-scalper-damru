export interface SymbolSpec {
  readonly symbol: string;
  readonly status: string;
  readonly contractType?: string;
  readonly tickSize: number;
  readonly stepSize: number;
  readonly minNotional: number;
  readonly contractSize: number;
}

export interface ExchangeBootstrapResult {
  readonly accepted: readonly SymbolSpec[];
  readonly rejected: readonly {
    symbol: string;
    reason: "NOT_LISTED" | "NOT_TRADING" | "INVALID_FILTERS";
    message: string;
  }[];
}

export interface FeeSchedule {
  readonly symbol?: string;
  readonly makerRate: number;
  readonly takerRate: number;
}

export interface EffectiveFees {
  readonly makerRate: number;
  readonly takerRate: number;
  readonly bnbDiscountEnabled: boolean;
  readonly asOfIso: string;
}

export interface LeverageBracket {
  readonly notionalCap: number;
  readonly initialLeverage: number;
}
