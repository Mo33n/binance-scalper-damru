import type { FillEvent } from "../../infrastructure/binance/user-stream.js";
import { parseUserStreamEvent } from "../../infrastructure/binance/user-stream.js";
import type { PositionLedger } from "./position-ledger.js";

/** Routes parsed USD-M user-stream payloads into per-symbol ledgers (dedupe inside `applyFill`). */
export function routeUserStreamJsonToLedgers(
  raw: Record<string, unknown>,
  symbolLedgers: ReadonlyMap<string, PositionLedger>,
  nowMs: number,
): FillEvent | undefined {
  const evt = parseUserStreamEvent(raw);
  if (evt?.kind !== "fill") return undefined;
  const ledger = symbolLedgers.get(evt.fill.symbol);
  ledger?.applyFill(evt.fill, nowMs);
  return evt.fill;
}
