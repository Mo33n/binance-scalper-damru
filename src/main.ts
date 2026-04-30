#!/usr/bin/env node
/**
 * Thin entry — composition lives in `bootstrap/composition.ts`.
 */

import { createAppContext, logStartupConfig } from "./bootstrap/composition.js";
import { STARTUP_EVENTS } from "./shared/startup-events.js";

function parseArgs(argv: string[]): { help: boolean } {
  const help = argv.includes("--help") || argv.includes("-h");
  return { help };
}

export function main(argv: string[]): void {
  const { help } = parseArgs(argv);
  if (help) {
    console.log(STARTUP_EVENTS.helpMode);
    console.log(`Usage: node dist/main.js [--help]

Trading bot entry (RFC: micro-scalping Binance USD-M).
Configure via CONFIG_PATH, TRADING_ENV, and env vars — see config/README.md.
`);
    return;
  }

  try {
    console.log(STARTUP_EVENTS.processStart);
    const ctx = createAppContext();
    logStartupConfig(ctx.log, ctx.config);
    ctx.log.info({ event: STARTUP_EVENTS.ready, exchange: ctx.exchange.environment }, "bootstrap.ready");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${STARTUP_EVENTS.failed}: ${msg}`);
    process.exitCode = 1;
  }
}

main(process.argv);
