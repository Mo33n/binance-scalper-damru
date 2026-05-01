/**
 * Venue façade — Binance USD-M implementation in Epic B/E.
 * Second implementation: simulator (`infrastructure/simulator`).
 *
 * ADR (SPEC-02): Order placement/cancel stays on **`ExecutionService` + `BinanceRestClient`**
 * for the integration path through MVP. **`ExchangePort`** may remain minimal (`environment` only)
 * for stub/bootstrap compatibility, or gain e.g. **`readonly tag: "stub" | "live"`** later — it MUST NOT
 * duplicate execution methods until a simulator (or other façade) implements the full contract.
 */
export type TradingEnvironment = "testnet" | "live";

export interface ExchangePort {
  readonly environment: TradingEnvironment;
}
