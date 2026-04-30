#!/usr/bin/env node
import { resolve } from "node:path";
import { loadConfig } from "../src/config/load.js";

const cfgPath = resolve(process.env["ROLLOUT_CONFIG_PATH"] ?? "config/examples/small-live.json");
process.env["CONFIG_PATH"] = cfgPath;
process.env["TRADING_ENV"] = "live";

const cfg = loadConfig();

if (cfg.environment !== "live") {
  throw new Error(`verify:rollout expected live environment, got ${cfg.environment}`);
}
if ((cfg.credentialProfile ?? cfg.environment) !== "live") {
  throw new Error("verify:rollout expected credentialProfile=live");
}
if (cfg.rollout.markoutPromotionWindowMs <= 0) {
  throw new Error("verify:rollout markoutPromotionWindowMs must be > 0");
}
if (cfg.risk.maxOpenNotionalQuote > 1_000) {
  throw new Error(
    `verify:rollout small-live maxOpenNotionalQuote too high: ${String(cfg.risk.maxOpenNotionalQuote)}`,
  );
}

console.log(
  JSON.stringify(
    {
      ok: true,
      configPath: cfgPath,
      environment: cfg.environment,
      credentialProfile: cfg.credentialProfile ?? cfg.environment,
      maxOpenNotionalQuote: cfg.risk.maxOpenNotionalQuote,
      markoutPromotionWindowMs: cfg.rollout.markoutPromotionWindowMs,
    },
    null,
    2,
  ),
);
