import type { LoggerPort } from "../ports/logger-port.js";
import type { PositionLedger } from "./position-ledger.js";

/** Position-only MVP (SPEC-06): open-order parity deferred until local order registry exists. */
export async function reconcileLedgerPositionsVsExchange(args: {
  readonly symbols: readonly string[];
  readonly ledger: PositionLedger;
  readonly fetchNetQty: (symbol: string) => Promise<number>;
  readonly log: LoggerPort;
  readonly requestQuotingHalt: (symbol: string) => void;
}): Promise<void> {
  for (const symbol of args.symbols) {
    let exchangeQty: number;
    try {
      exchangeQty = await args.fetchNetQty(symbol);
    } catch {
      args.log.warn({ event: "reconcile.fetch_failed", symbol }, "reconcile.fetch_failed");
      continue;
    }
    const localQty = args.ledger.getPosition(symbol).netQty;
    if (Math.abs(exchangeQty - localQty) <= 1e-8) continue;
    args.log.warn(
      { event: "reconcile.mismatch", symbol, delta: exchangeQty - localQty },
      "reconcile.mismatch",
    );
    args.requestQuotingHalt(symbol);
  }
}
