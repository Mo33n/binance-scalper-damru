#!/usr/bin/env node
/**
 * Conservative scan for accidental secret literals in source and config.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const scanRoots = ["src", "config"];

const suspicious =
  /(?:apiSecret|api_secret|BINANCE_API_SECRET)\s*[:=]\s*['"](?!['"])\S{12,}/i;
const inlineKey =
  /(?:apiKey|BINANCE_API_KEY)\s*[:=]\s*['"](?!['"])\S{20,}/i;

/** @param {string} dir */
function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, files);
    else if (/\.(ts|mts|cts|js|json|md)$/.test(name)) files.push(p);
  }
  return files;
}

let failed = false;
for (const r of scanRoots) {
  const base = join(root, r);
  try {
    statSync(base);
  } catch {
    continue;
  }
  for (const file of walk(base)) {
    const rel = relative(root, file);
    const text = readFileSync(file, "utf8");
    if (suspicious.test(text) || inlineKey.test(text)) {
      console.error(`verify-secrets: suspicious pattern in ${rel}`);
      failed = true;
    }
  }
}

if (failed) {
  process.exit(1);
}
