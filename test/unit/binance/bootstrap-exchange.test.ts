import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { bootstrapExchangeContext } from "../../../src/application/services/bootstrap-exchange.js";
import type { LoggerPort } from "../../../src/application/ports/logger-port.js";
import { loadConfig } from "../../../src/config/load.js";

describe("bootstrapExchangeContext", () => {
  it("accepts trading symbol and rejects non-trading/not-listed", async () => {
    const exchangeInfoFixture = JSON.parse(
      readFileSync(resolve("test/fixtures/binance/exchange-info.sample.json"), "utf8"),
    ) as unknown;
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(exchangeInfoFixture), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchImpl);
    process.env["CONFIG_PATH"] = resolve("config/examples/minimal.json");
    const cfg = loadConfig();
    const cfgWithSymbols = { ...cfg, symbols: ["BTCUSDT", "ETHUSDT", "UNKNOWN"] };
    const logs: unknown[] = [];
    const log: LoggerPort = {
      debug(meta) {
        logs.push(meta);
      },
      info(meta) {
        logs.push(meta);
      },
      warn(meta) {
        logs.push(meta);
      },
      error(meta) {
        logs.push(meta);
      },
      child() {
        return this;
      },
    };

    const ctx = await bootstrapExchangeContext(cfgWithSymbols, log);
    expect(ctx.symbols.map((s) => s.symbol)).toEqual(["BTCUSDT"]);
    expect(ctx.decisions.some((d) => d.status === "rejected" && d.symbol === "ETHUSDT")).toBe(true);
    expect(ctx.decisions.some((d) => d.status === "rejected" && d.symbol === "UNKNOWN")).toBe(true);
    vi.unstubAllGlobals();
  });
});
