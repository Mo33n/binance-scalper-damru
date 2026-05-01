import type { AppConfig } from "./schema.js";

/**
 * Spread floor passed into {@link evaluateSpreadFloor} during bootstrap.
 * Last `perSymbolOverrides` entry with matching `symbol` and defined `minSpreadTicks` wins.
 */
export function resolveBootstrapMinSpreadTicks(cfg: AppConfig, symbol: string): number {
  let ticks = cfg.risk.defaultMinSpreadTicks;
  for (const e of cfg.perSymbolOverrides) {
    if (e.symbol === symbol && e.minSpreadTicks !== undefined) {
      ticks = e.minSpreadTicks;
    }
  }
  return ticks;
}
