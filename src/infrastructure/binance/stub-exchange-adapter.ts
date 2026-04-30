import type { ExchangePort, TradingEnvironment } from "../../application/ports/exchange-port.js";

/** Placeholder adapter until real Binance + simulator exist (Epic B/E). */
export function createStubExchangeAdapter(environment: TradingEnvironment): ExchangePort {
  return { environment };
}
