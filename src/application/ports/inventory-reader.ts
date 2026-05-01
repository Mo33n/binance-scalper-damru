import type { InventoryMode } from "../../domain/quoting/types.js";

/** SPEC-06 — ledger-backed view used when building `QuotingInputs`. */
export interface InventoryReader {
  getNetQty(): number;
  getInventoryStressMode(): InventoryMode;
}
