import type { InventoryReader } from "../ports/inventory-reader.js";
import type { PositionLedger } from "./position-ledger.js";

export function createInventoryReaderForMark(
  ledger: PositionLedger,
  symbol: string,
  markPx: number,
  nowMs: number,
): InventoryReader {
  return {
    getNetQty: () => ledger.getPosition(symbol).netQty,
    getInventoryStressMode: () =>
      ledger.getStressLevel(symbol, markPx, nowMs) === "breach" ? "stress" : "normal",
  };
}
