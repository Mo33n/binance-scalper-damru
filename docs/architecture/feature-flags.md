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
| `quoting.baseOrderQty` | positive number (optional) | omitted | Trading | med | Per-leg size override; else ~5% of `risk.maxAbsQty` convention. |

## `rollout.*`

| JSON path | Type | Default | Owner | Risk | Dependencies / notes |
|-----------|------|---------|-------|------|----------------------|
| `rollout.markoutPromotionWindowMs` | positive int | `86400000` | Quant / risk | low | Rolling window for economics review before size promotion (RFC §17.5 narrative); must be &gt; 0 (see `npm run verify:rollout`). |

## Related risk flags (not under `features`)

Loss caps and inventory rails live under `risk.*` (e.g. `sessionLossCapQuote`, `dailyLossCapQuote`, `maxAbsQty`). See [config/README.md](../../config/README.md) and [promotion-checklist.md](../rollout/promotion-checklist.md).

---

*Last reviewed: 2026-05-01 (added `combinedDepthStream`)*
