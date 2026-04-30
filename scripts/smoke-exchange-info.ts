#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_TESTNET_REST_BASE_URL } from "../src/infrastructure/binance/constants.js";

const enabled = process.env["TESTNET_SMOKE"] === "1";
if (!enabled) {
  console.log("smoke disabled; set TESTNET_SMOKE=1");
  process.exit(0);
}

const cfgPath = process.env["CONFIG_PATH"] ?? "config/examples/testnet.json";
const parsed = JSON.parse(readFileSync(resolve(cfgPath), "utf8")) as unknown;
let fileRestBase: string | undefined;
if (typeof parsed === "object" && parsed !== null) {
  const binance = (parsed as Record<string, unknown>)["binance"];
  if (typeof binance === "object" && binance !== null) {
    const r = (binance as Record<string, unknown>)["restBaseUrl"];
    if (typeof r === "string") fileRestBase = r;
  }
}
const base = process.env["BINANCE_REST_BASE_URL"] ?? fileRestBase ?? DEFAULT_TESTNET_REST_BASE_URL;

const url = `${base.replace(/\/+$/, "")}/fapi/v1/exchangeInfo`;
const res = await fetch(url);
if (!res.ok) {
  throw new Error(`exchangeInfo smoke failed status=${String(res.status)}`);
}
const json = (await res.json()) as { symbols?: unknown };
const count = Array.isArray(json.symbols) ? json.symbols.length : 0;
console.log(JSON.stringify({ ok: true, endpoint: url, symbolCount: count }, null, 2));
