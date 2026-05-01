import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { runTrader, stopSupervisorForTests } from "../../../src/bootstrap/run-trader.js";

describe("runTrader (SPEC-01)", () => {
  const prevMd = process.env["DAMRU_DISABLE_MARKET_DATA"];

  afterEach(async () => {
    vi.unstubAllGlobals();
    process.exitCode = undefined;
    vi.restoreAllMocks();
    await stopSupervisorForTests();
    process.env["DAMRU_DISABLE_MARKET_DATA"] = prevMd;
  });

  beforeEach(() => {
    process.env["DAMRU_DISABLE_MARKET_DATA"] = "1";
  });

  it("T01: --help short-circuits without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await runTrader(["node", "dist/main.js", "--help"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("T02: mocked exchangeInfo completes bootstrap without exitCode 1", async () => {
    const exchangeInfoFixture = JSON.parse(
      readFileSync(resolve("test/fixtures/binance/exchange-info.sample.json"), "utf8"),
    ) as unknown;
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(exchangeInfoFixture), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    process.env["CONFIG_PATH"] = resolve("config/examples/minimal.json");
    process.env["TRADING_ENV"] = "testnet";

    await runTrader(["node", "dist/main.js"]);

    expect(fetchMock).toHaveBeenCalled();
    expect(process.exitCode).not.toBe(1);
  });

  it("T03: zero accepted symbols sets exitCode 1", async () => {
    const exchangeInfoFixture = JSON.parse(
      readFileSync(resolve("test/fixtures/binance/exchange-info.sample.json"), "utf8"),
    ) as unknown;
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(exchangeInfoFixture), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const base = JSON.parse(readFileSync(resolve("config/examples/minimal.json"), "utf8")) as {
      symbols: string[];
    };
    const tmpCfg = join(tmpdir(), `damru-run-trader-${String(Date.now())}.json`);
    writeFileSync(tmpCfg, JSON.stringify({ ...base, symbols: ["ETHUSDT"] }, null, 2));
    process.env["CONFIG_PATH"] = tmpCfg;
    process.env["TRADING_ENV"] = "testnet";

    try {
      await runTrader(["node", "dist/main.js"]);
      expect(process.exitCode).toBe(1);
    } finally {
      unlinkSync(tmpCfg);
    }
  });
});
