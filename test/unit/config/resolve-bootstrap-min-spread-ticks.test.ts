import { describe, expect, it } from "vitest";
import { resolveBootstrapMinSpreadTicks } from "../../../src/config/resolve-bootstrap-min-spread-ticks.js";
import type { AppConfig } from "../../../src/config/schema.js";

function makeCfg(
  defaultMinSpreadTicks: number,
  perSymbolOverrides: AppConfig["perSymbolOverrides"],
): AppConfig {
  return {
    risk: { defaultMinSpreadTicks } as AppConfig["risk"],
    perSymbolOverrides,
  } as AppConfig;
}

describe("resolveBootstrapMinSpreadTicks", () => {
  it("falls back to risk.defaultMinSpreadTicks", () => {
    expect(resolveBootstrapMinSpreadTicks(makeCfg(5, []), "BTCUSDT")).toBe(5);
  });

  it("uses perSymbolOverrides.minSpreadTicks when set", () => {
    expect(
      resolveBootstrapMinSpreadTicks(
        makeCfg(5, [{ schemaVersion: "1", symbol: "BTCUSDT", minSpreadTicks: 12 }]),
        "BTCUSDT",
      ),
    ).toBe(12);
  });

  it("last matching override wins", () => {
    expect(
      resolveBootstrapMinSpreadTicks(
        makeCfg(5, [
          { schemaVersion: "1", symbol: "BTCUSDT", minSpreadTicks: 8 },
          { schemaVersion: "1", symbol: "BTCUSDT", minSpreadTicks: 9 },
        ]),
        "BTCUSDT",
      ),
    ).toBe(9);
  });
});
