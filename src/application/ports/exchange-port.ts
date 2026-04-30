/**
 * Venue façade — Binance USD-M implementation in Epic B/E.
 * Second implementation: simulator (`infrastructure/simulator`).
 */
export type TradingEnvironment = "testnet" | "live";

export interface ExchangePort {
  readonly environment: TradingEnvironment;
}
