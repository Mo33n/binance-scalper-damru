# Binance scalper damru — config cheat sheet

**Local run & tooling:** see the repo’s [DEVELOPERS.md](../DEVELOPERS.md) (commands, tests, where code lives).

**Binance scalper damru** is a USD-M futures micro-scalping stack: tight spreads, VPIN-ish flow toxicity, hybrid quoting (at-touch vs step back when the tape looks informed), inventory and margin guardrails, and a supervisor model built for “one runner per symbol” without shared mutable order state. This file is where you tell the damru **what** to trade, **where** (testnet vs live), and **how hard** it’s allowed to lean before it has to flatten or shut up.

If you’re new here: everything meaningful flows through **Zod** (`src/config/schema.ts`), gets **deep-merged** in `src/config/load.ts`, and is **frozen** at runtime—no mystery defaults hiding in random modules.

---

## Merge order (the actual pipeline)

1. **Defaults** for `testnet` vs `live` (`TRADING_ENV` / `APP_ENV`) — seeds REST/WS base URLs (hosts are allow-listed against `environment`—no sneaky cross-env URLs).
2. **JSON** from `CONFIG_PATH` — deep-merge for nested objects; **arrays** like `symbols` and `perSymbolOverrides` **replace** wholesale (no accidental half-merges of symbol lists).
3. **Env overrides** — `BINANCE_REST_BASE_URL`, `BINANCE_WS_BASE_URL`, `BINANCE_API_KEY`, `BINANCE_API_SECRET`, `LOG_LEVEL`.

Schema version: **`configSchemaVersion: "1"`** — bump only when you mean it.

---

## Environment contract

- **`environment`**: `testnet` | `live` — drives URL defaults **and** host validation (Binance scalper damru refuses “live” labels on testnet hosts and vice versa).
- **`credentialProfile`** (optional): if set, must match `environment` — stops “oops I labeled testnet keys as prod” class mistakes.
- **`isTestnet`** isn’t stored; it’s **`environment === "testnet"`** everywhere that matters. One codebase, config-only switching.

---

## Rollout / economics gate

- **`rollout.markoutPromotionWindowMs`**: rolling window (ms) for “are we actually making sense after fees?” before you size up. Pair with your team’s rollout / promotion process (`npm run verify:rollout` is one guardrail).

---

## Fees (maker reality check)

- **`binance.feeRefreshIntervalMs`**: how often you intend to refresh effective fee assumptions from the exchange.
- **`binance.feeSafetyBufferBps`**: extra bps cushion in the spread-vs-fee gate so you don’t quote through noise and call it edge.

---

## VPIN bucket + optional RV (the “is flow toxic?” knobs)

- **`risk.vpinBucketVolume`**: volume per bucket (`V*`).
- **`risk.vpinBucketBasis`**: `base` or `quote` — pick one convention per deployment and don’t mix mentally.
- **`risk.vpinEwmaN`**: smoothing for the toxicity score.
- **`risk.vpinStaleFlushMs`**: when to flush a sad, half-filled bucket.
- **`risk.vpinTau`**: threshold that feeds hybrid quoting (above → chill).
- **`risk.rvEnabled`**: optional realized-vol regime filter.
- **`risk.rvTau`**: variance line between “normal” and “stressed” for RV.

---

## Inventory, margin, funding-adjacent risk

- **`risk.maxAbsQty` / `maxAbsNotional`**: per-symbol hard stops in qty and notional.
- **`risk.globalMaxAbsNotional`**: portfolio-ish cap so one symbol doesn’t eat the whole damru.
- **`risk.inventoryEpsilon` + `maxTimeAboveEpsilonMs`**: “you’ve been lugging inventory too long” timer.
- **`risk.warnUtilization` / `criticalUtilization` / `haltUtilization`**: margin utilization bands — halt should feed the kill-switch story, not just a log line.
- **`risk.preFundingFlattenMinutes`**: optional “get small before funding” window (feature-flagged elsewhere; validate on testnet first).

---

## Per-symbol overrides (surgical tweaks)

Optional entries in your `CONFIG_PATH` JSON:

```json
{
  "configSchemaVersion": "1",
  "perSymbolOverrides": [
    {
      "schemaVersion": "1",
      "symbol": "BTCUSDT",
      "effectiveFrom": "2026-05-01T00:00:00.000Z",
      "minSpreadTicks": 6
    }
  ]
}
```

Unknown **`configSchemaVersion`** at the **root** → startup dies loudly (by design).

---

## Secrets (non-negotiable)

Never commit real keys. Local: `.env` or your shell; prod: secret manager + rolling restart after rotation. The app reads **environment variables**, not magic `.env` auto-loading—export or prefix your commands.

---

## Change-control — treat these like live ammo

Reviewers: these fields move PnL and survival, not “just config”:

- `risk.sessionLossCapQuote`, `risk.maxOpenNotionalQuote`
- `risk.maxAbsQty`, `risk.maxAbsNotional`, `risk.globalMaxAbsNotional`, `risk.haltUtilization`
- `symbols`, `features.*`, `credentialProfile`, `rollout.markoutPromotionWindowMs`, `heartbeat*`

**Safe-ish:** one new override with future `effectiveFrom`, caps unchanged.

**Sketchy:** cranking `maxOpenNotionalQuote` and `sessionLossCapQuote` together with no testnet receipts—Binance scalper damru might run, but *you* won’t like the phone call.
