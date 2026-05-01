# Feature flags and rollout knobs

Authoritative schema: [`src/config/schema.ts`](../../src/config/schema.ts). Defaults below match schema **defaults** at last review.

## `features.*`

| JSON path | Type | Default | Owner | Risk | Dependencies / notes |
|-----------|------|---------|-------|------|----------------------|
| `features.liveQuotingEnabled` | boolean | `false` | Trading lead | **high** | Requires valid credentials + order-capable venue; gates `ExecutionService` construction (SPEC-02). |
| `features.markoutFeedbackEnabled` | boolean | `false` | Quant / trading | med | Requires live quoting path; widens spread floor from runner-local markout EWMA (SPEC-09). |
| `features.reconciliationIntervalOverrideEnabled` | boolean | `false` | Ops | low | Reserved / future override hooks; verify usage in code before relying on name alone. |
| `features.preFundingFlattenEnabled` | boolean | `false` | Risk | high | Funding-window flatten behavior—confirm wiring before enabling in production. |
| `features.regimeFlagsEnabled` | boolean | `false` | Trading / risk | med–high | Book/trend/RV-driven `halt_request` → supervisor HALT (SPEC-09); tune thresholds in code or future config. |
| `features.inventoryDeRiskEnabled` | boolean | `false` | Risk / trading | **high** | When `true`, ledger stress maps to reduce-only exit orders (`risk.deRiskMode`); soak on testnet before live (RFC inventory de-risk). |
| `features.useWorkerThreads` | boolean | `false` | Platform | med | Per-symbol `worker_threads`; requires built `dist/` worker entry and env signing keys (SPEC-08). |
| `features.combinedDepthStream` | boolean | `false` | Platform | med | One multiplexed `/stream?streams=…` depth socket for all bootstrap symbols on the **main thread**; must be `false` when `useWorkerThreads` is `true`. |

## Live promotion gate (related)

| JSON path | Type | Default | Owner | Risk | Dependencies / notes |
|-----------|------|---------|-------|------|----------------------|
| `features.liveQuotingEnabled` | boolean | `false` | Trading lead | **high** | **MUST be `true` for live posting** once risk sign-off is complete; keep `false` for read-only / telemetry runs. |

## `quoting.*`

| JSON path | Type | Default | Owner | Risk | Dependencies / notes |
|-----------|------|---------|-------|------|----------------------|
| `quoting.repriceMinIntervalMs` | positive int | `250` | Trading | med | Hybrid quote cadence; lower = more churn and REST load. |
| `quoting.maxBookStalenessMs` | positive int | `3000` | Trading | med | Skip quoting when book older than this (SPEC-05). |
| `quoting.warnLogCooldownMs` | nonnegative int | `60000` | Ops | low | Min gap between quoting warns (`quoting.de_risk_unfillable_dust`, etc.); `0` uses `repriceMinIntervalMs`. First occurrence always logs. |
| `quoting.baseOrderQty` | positive number (optional) | omitted | Trading | med | Per-leg size override; else ~5% of `risk.maxAbsQty` convention. |
| `quoting.regimeTrendStressPolicy` | enum | `legacy` | Risk / trading | **high** | `legacy` = halt-only on regime trip; non-legacy = cancel working + throttle + persistence before `halt_request` (see `docs/rfc/regime-trend-stress-tasks.md`). |
| `quoting.regimeTrendStressPersistenceN` | positive int | `3` | Risk | med | Consecutive trend-stress samples before emitting `halt_request` (non-legacy); book/RV halts stay immediate. |
| `quoting.regimeTrendThrottleSpreadMult` | number ≥ 1 | `1.25` | Trading | med | When regime throttle active, `ceil(baseMinSpreadTicks × mult)` (spread widening). |
| `quoting.regimeTrendInventoryMinQty` | nonnegative | `0` | Risk | med | Min \|netQty\| (base) for wrong-way trend flatten (`ladder_mvp` / `ladder_full`). |
| `quoting.regimeStressClearedMs` | nonnegative int | `0` | Risk | low | Monotonic dwell below trend threshold before clearing throttle/counter; `0` = clear on first calm sample. |
| `quoting.regimeTrendImpulseNormalizer` | enum | `none` | Quant / risk | med | `none` = relative mid drift threshold in code; `rv_scaled` = \|Δln mid\| / σ_ln vs `regimeTrendRvZHalt` when `risk.rvEnabled` (fallback to percentage if σ unavailable). |
| `quoting.regimeTrendRvZHalt` | positive number | `2.5` | Quant / risk | med | z-threshold for RV-scaled trend stress (requires `rv_scaled` + warm RV). |
| `quoting.liquidityEngine` | optional object | omitted | Quant / trading | med–high | Umbrella for RFC liquidity economics (`enabled` defaults `false`): fee-aware edge gate, global portfolio gross pre-trade, regime microstructure/flow split, two-leg placement rollback; nested defaults merge when key present. See `docs/rfc/rfc-liquidity-engine-evolution.md`. |

### `quoting.liquidityEngine.*` (nested)

| JSON path | Type | Default | Notes |
|-----------|------|---------|-------|
| `quoting.liquidityEngine.enabled` | boolean | `false` | Master switch for liquidity-engine economics path (edge gate, portfolio gate wiring, fair value / skew / regime FSM when configured). |
| `quoting.liquidityEngine.useLegacyCancelAllRefresh` | boolean | `true` | **`true`**: `cancelAll` + `placeFromIntent` on each quote refresh (legacy). **`false`**: target book vs `GET /fapi/v1/openOrders` diff + targeted cancel/place (RFC P2); rollback by setting back to `true`. |
| `quoting.liquidityEngine.twoLegSafety.enabled` | boolean | `false` | When placing two maker legs, cancel first leg if second `placeOrder` fails (RFC P0). |
| `quoting.liquidityEngine.regimeFsm.enabled` | boolean | `false` | Liquidity regime state machine (spread multipliers, `OFF` skips quoting). |
| `quoting.liquidityEngine.portfolio.betaCapEnabled` | boolean | `false` | When **`liquidityEngine.enabled`**, scale per-symbol **`risk.maxAbsNotional`** by \(1/\beta\) from **`betaToRef`**, and (with **`enforceGlobal`**) scale global gross by \(\beta\) per symbol (RFC P3). |
| `quoting.liquidityEngine.portfolio.betaToRef` | object | `{}` | Map **symbol → β** vs a reference (e.g. BTC). Missing symbols use β = 1. |

**Merge example (RFC P2 OMS path):** [`config/examples/liquidity-engine-oms-merge.example.json`](../../config/examples/liquidity-engine-oms-merge.example.json) — deep-merge into your deployment JSON under `quoting`.

## `rollout.*`

| JSON path | Type | Default | Owner | Risk | Dependencies / notes |
|-----------|------|---------|-------|------|----------------------|
| `rollout.markoutPromotionWindowMs` | positive int | `86400000` | Quant / risk | low | Rolling window for economics review before size promotion (RFC §17.5 narrative); must be &gt; 0 (see `npm run verify:rollout`). |

## Related risk flags (not under `features`)

Loss caps and inventory rails live under `risk.*` (e.g. `sessionLossCapQuote`, `dailyLossCapQuote`, `maxAbsQty`). See [config/README.md](../../config/README.md) and [promotion-checklist.md](../rollout/promotion-checklist.md).

---

*Last reviewed: 2026-05-01 (`quoting.liquidityEngine`, `useLegacyCancelAllRefresh`; regime trend-stress `quoting.*` knobs)*
