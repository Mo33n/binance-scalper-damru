#!/usr/bin/env node
/**
 * Thin entry — async orchestration in `bootstrap/run-trader.ts` (SPEC-01).
 */

import { runTrader } from "./bootstrap/run-trader.js";
import { STARTUP_EVENTS } from "./shared/startup-events.js";

function parseArgs(argv: string[]): { help: boolean } {
  const help = argv.includes("--help") || argv.includes("-h");
  return { help };
}

export function main(argv: string[]): void {
  const { help } = parseArgs(argv);
  if (help) {
    console.log(STARTUP_EVENTS.helpMode);
    console.log(`Usage: node dist/main.js [--help] [--dry-run] [--stay-alive]

Trading bot entry (RFC: micro-scalping Binance USD-M).
Configure via CONFIG_PATH, TRADING_ENV, and env vars — see config/README.md.

Startup performs Binance exchange bootstrap (exchangeInfo, fees, gates) — requires outbound network.

  --dry-run       Read-only trading mode: no ExecutionService / orders even if API keys are set.
  --stay-alive    Keep the process running after bootstrap (dev); Ctrl+C to exit.
                  Or set DAMRU_STAY_ALIVE=1.
`);
    return;
  }

  console.log(STARTUP_EVENTS.processStart);

  void runTrader(argv).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${STARTUP_EVENTS.failed}: ${msg}`);
    process.exitCode = 1;
  });
}

main(process.argv);
