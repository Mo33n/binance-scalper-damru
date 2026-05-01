import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../../../src/config/load.js";
import { createTradingVenueHandles, TRADING_MODE_EVENT } from "../../../src/bootstrap/venue-factory.js";
import type { LoggerPort } from "../../../src/application/ports/logger-port.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const minimalPath = resolve(__dirname, "../../../config/examples/minimal.json");

function makeLog(): LoggerPort & { readonly infoMock: ReturnType<typeof vi.fn> } {
  const infoMock = vi.fn();
  const warnMock = vi.fn();
  const errorMock = vi.fn();
  const log: LoggerPort & { readonly infoMock: ReturnType<typeof vi.fn> } = {
    debug: vi.fn(),
    info: infoMock,
    warn: warnMock,
    error: errorMock,
    child(): LoggerPort {
      return log;
    },
    infoMock,
  };
  return log;
}

describe("createTradingVenueHandles (SPEC-02)", () => {
  const prev = { ...process.env };

  beforeEach(() => {
    process.env = { ...prev };
    delete process.env["BINANCE_API_KEY"];
    delete process.env["BINANCE_API_SECRET"];
  });

  afterEach(() => {
    process.env = { ...prev };
  });

  it("T01: no credentials → read_only, no_credentials", () => {
    process.env["CONFIG_PATH"] = minimalPath;
    process.env["TRADING_ENV"] = "testnet";
    const cfg = loadConfig();
    const log = makeLog();
    const v = createTradingVenueHandles({ cfg, log, argv: [] });
    expect(v.mode).toBe("read_only");
    expect(v.execution).toBeUndefined();
    expect(v.modeReasons).toContain("no_credentials");
    expect(log.infoMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: TRADING_MODE_EVENT, mode: "read_only" }),
      "trading.mode.selected",
    );
  });

  it("T02: creds + --dry-run → read_only, dry_run", () => {
    process.env["CONFIG_PATH"] = minimalPath;
    process.env["TRADING_ENV"] = "testnet";
    process.env["BINANCE_API_KEY"] = "test-key";
    process.env["BINANCE_API_SECRET"] = "test-secret";
    const cfg = loadConfig();
    const log = makeLog();
    const v = createTradingVenueHandles({ cfg, log, argv: ["node", "dist/main.js", "--dry-run"] });
    expect(v.mode).toBe("read_only");
    expect(v.execution).toBeUndefined();
    expect(v.modeReasons).toContain("dry_run");
  });

  it("T03: creds + liveQuotingEnabled false → read_only, live_quoting_disabled", () => {
    process.env["CONFIG_PATH"] = minimalPath;
    process.env["TRADING_ENV"] = "testnet";
    process.env["BINANCE_API_KEY"] = "test-key";
    process.env["BINANCE_API_SECRET"] = "test-secret";
    const cfg = loadConfig();
    expect(cfg.features.liveQuotingEnabled).toBe(false);
    const log = makeLog();
    const v = createTradingVenueHandles({ cfg, log, argv: [] });
    expect(v.mode).toBe("read_only");
    expect(v.execution).toBeUndefined();
    expect(v.modeReasons).toContain("live_quoting_disabled");
  });

  it("T04: creds + liveQuotingEnabled true + no dry-run → order_capable, execution defined", () => {
    const base = JSON.parse(readFileSync(minimalPath, "utf8")) as Record<string, unknown>;
    const tmpCfg = join(tmpdir(), `damru-venue-factory-${String(Date.now())}.json`);
    writeFileSync(
      tmpCfg,
      JSON.stringify(
        {
          ...base,
          features: {
            ...(base["features"] as Record<string, unknown>),
            liveQuotingEnabled: true,
          },
        },
        null,
        2,
      ),
    );
    process.env["CONFIG_PATH"] = tmpCfg;
    process.env["TRADING_ENV"] = "testnet";
    process.env["BINANCE_API_KEY"] = "test-key";
    process.env["BINANCE_API_SECRET"] = "test-secret";

    try {
      const cfg = loadConfig();
      const log = makeLog();
      const v = createTradingVenueHandles({ cfg, log, argv: [] });
      expect(v.mode).toBe("order_capable");
      expect(v.execution).toBeDefined();
      expect(v.modeReasons).toContain("ready");
      expect(log.infoMock).toHaveBeenCalledWith(
        expect.objectContaining({ event: TRADING_MODE_EVENT, mode: "order_capable" }),
        "trading.mode.selected",
      );
    } finally {
      unlinkSync(tmpCfg);
    }
  });
});
