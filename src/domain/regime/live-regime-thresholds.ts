import type { RegimeConfig } from "./regime-flags.js";

/** Defaults for `features.regimeFlagsEnabled` (tune via future config if needed). */
export const DEFAULT_REGIME_BOOK_HALT: RegimeConfig = {
  slopeTau: 0.001,
  maxSpreadTicks: 400,
  minTopQty: 0,
};

/** Consecutive mid drift — uses `slopeTau` only from `RegimeConfig`. */
export const DEFAULT_REGIME_TREND_STRESS: RegimeConfig = {
  slopeTau: 0.0025,
  maxSpreadTicks: 99_999,
  minTopQty: 0,
};
