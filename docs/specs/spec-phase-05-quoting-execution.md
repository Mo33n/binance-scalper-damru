# SPEC-05 — Quoting orchestrator + execution loop (technical)

**Phase:** 05  
**Prerequisites:** SPEC-04 (`QuotingSnapshot`, halted flag, `venue.execution`).

---

## 1. Purpose

Drive **`ExecutionService.placeFromIntent`** from **hybrid quoting** domain on a **bounded cadence**, with cancel/replace policy, staleness guard, and mode guards (`read_only`, `liveQuotingEnabled`, `halted`).

---

## 2. Configuration (normative additions)

**File:** `src/config/schema.ts`

Add under **`risk`** or new **`quoting`** object — **pick one** (recommend `quoting` sibling to `risk` for clarity):

```typescript
const quotingSchema = z.object({
  repriceMinIntervalMs: z.number().int().positive().default(250),
  maxBookStalenessMs: z.number().int().positive().default(3000),
});
```

Wire defaults in schema merge; update **all** `config/examples/*.json`.

### 2.1 Regime trend stress (`quoting.*`, RFC)

Normative additions (see `src/config/schema.ts` → `quotingSchema`):

| Field | Role |
|-------|------|
| `regimeTrendStressPolicy` | `legacy` vs escalation policies (`cancel_throttle`, `ladder_mvp`, `ladder_full`). |
| `regimeTrendStressPersistenceN` | Consecutive stressed trend samples before `halt_request` (non-legacy). |
| `regimeTrendThrottleSpreadMult` | Widens resolved min spread ticks while throttle active. |
| `regimeTrendInventoryMinQty` | Wrong-way flatten gate vs ledger. |
| `regimeStressClearedMs` | Hysteresis after trend calms. |
| `regimeTrendImpulseNormalizer` | `none` → percentage drift (`DEFAULT_REGIME_TREND_STRESS`); `rv_scaled` → \|Δln mid\| / σ_ln vs `regimeTrendRvZHalt` when `risk.rvEnabled` and σ warm. |

Implemented in **`SymbolLoopRuntime.maybeEmitRegimeHaltAsync`** + **`Supervisor.haltQuotingForSymbol`** (SPEC-07 / SPEC-09).

---

## 3. Domain integration points

**Read existing exports:**

- `src/domain/quoting/hybrid-quoting.ts` — function(s) producing `QuoteIntent` from inputs.
- `src/domain/quoting/types.ts` — `QuoteIntent`, enums.

**Orchestrator MUST:**

1. Build **`QuotingInputs`** matching hybrid function signature — if domain uses different name (`HybridQuotingInputs`), **alias in spec implementation** to match file.

2. Until SPEC-06: **`inventoryMode`** = neutral constant; **`position`** zero — single exported `DEFAULT_INVENTORY_CONTEXT`.

---

## 4. Module: `QuotingOrchestrator`

**File:** `src/application/services/quoting-orchestrator.ts` (new)

### 4.1 Constructor

```typescript
export class QuotingOrchestrator {
  constructor(deps: {
    readonly log: LoggerPort;
    readonly execution: ExecutionService | undefined;
    readonly spec: SymbolSpec;
    readonly fees: EffectiveFees;
    readonly cfg: Pick<AppConfig, "risk" | "quoting" | "features">;
    readonly getSnapshot: () => QuotingSnapshot;
    readonly isHalted: () => boolean;
    readonly monotonicNowMs: () => number;
  }) {}
}
```

### 4.2 Method

```typescript
async tick(): Promise<void>;
```

### 4.3 `tick()` algorithm (normative)

1. If `deps.execution === undefined`: log at **debug** `event: "quoting.skip"` reason `read_only` — **max once per `repriceMinIntervalMs`** using internal `lastSkipLogMs`.

2. If `!deps.cfg.features.liveQuotingEnabled`: skip (same rate limit).

3. If `deps.isHalted()`: skip reason `halted`.

4. Compute `snapshot = getSnapshot()`.

5. If `snapshot.readModel.quotingPausedForBookResync` OR `stalenessMs > cfg.quoting.maxBookStalenessMs`: skip reason `stale_book` at info.

6. Build **`domain/quoting/types.QuotingInputs`** (full shape — not only `SignalEngine.getQuotingInputs()`):

   | Field | Source |
   |--------|--------|
   | `touch.bestBid` / `touch.bestAsk` | Market read model best bid/ask (numbers); MUST NOT quote if either missing |
   | `toxicityScore` | `signalEngine.getSnapshot().toxicityScore` |
   | `toxicityTau` | `cfg.risk.vpinTau` |
   | `rvRegime` | `signalEngine` RV regime or `"normal"` if RV disabled |
   | `minSpreadTicks` | `effectiveMinSpreadTicks` from `BootstrapSymbolDecision` for this symbol, else `cfg.risk.defaultMinSpreadTicks` — **resolve in runner from `bootstrap.decisions`** |
   | `tickSize` | `spec.tickSize` |
   | `inventoryMode` | SPEC-05 default `"normal"`; SPEC-06 replaces from ledger |
   | `baseOrderQty` | **New config** `quoting.baseOrderQty` per symbol or global — add `risk.maxQuoteQty` alias OR use existing field from schema — **implementer MUST pick existing risk field** (e.g. derive from `maxAbsQty` fraction) and document in PR |

7. Call **`buildHybridQuoteIntent`** from `src/domain/quoting/hybrid-quoting.ts` → `QuoteIntent`.

8. **Hash intent** (stable JSON stringify of prices/qty/sides) — if equals `lastIntentHash`, return.

9. **Cancel/replace:** If previous working orders tracked internally OR always blind cancel-all before place — **choose minimal MVP:** `await execution.cancelAll(spec.symbol)` then `await execution.placeFromIntent(spec, intent)` **only if** intent non-null and sides require posting — align with `ExecutionService.placeFromIntent` behavior (read implementation: may place multiple legs).

10. Catch errors → map via existing order error mapper → log `quoting.order_error` with `{ action, code }` fields safe.

### 4.4 Scheduling

**Inside runner:** `setInterval(() => void orchestrator.tick().catch(...), cfg.quoting.repriceMinIntervalMs)` — separate from heartbeat interval OR derive from heartbeat — **MUST use `repriceMinIntervalMs`** per schema.

---

## 5. State on runner

Track **`lastIntentHash: string | undefined`** per symbol in `RunnerInternals`.

---

## 6. Logging contract

| `event` | Level | Notes |
|---------|-------|-------|
| `quoting.skip` | debug/info | include `reason` enum |
| `quoting.order_error` | warn | no secrets |

---

## 7. Test specification

| ID | Scenario | Assert |
|----|----------|--------|
| T01 | read_only | zero `placeFromIntent` calls |
| T02 | stale book | skip |
| T03 | intent unchanged | no REST |
| T04 | intent changed | cancelAll before place order (spy order) |

Use mocked `ExecutionService`.

---

## 8. Definition of Done

- [ ] Testnet manual: orders appear when flags true
- [ ] Default examples remain safe (`liveQuotingEnabled: false`)

---

## 9. Handoff to SPEC-06

Replace `DEFAULT_INVENTORY_CONTEXT` with **`PositionLedger` reader** interface:

```typescript
export interface InventoryReader {
  getNetQty(): number;
  getInventoryStressMode(): InventoryMode; // domain enum name TBD
}
```

Inject `getInventoryReader` into orchestrator constructor.

---

## 10. Liquidity engine evolution (RFC addendum)

Normative behavior when **`quoting.liquidityEngine`** is present and **`enabled: true`** (see **`src/config/schema.ts`**, **`docs/architecture/feature-flags.md`**, **`docs/rfc/rfc-liquidity-engine-evolution.md`**).

| Mechanism | Config | Orchestrator / execution behavior |
|-----------|--------|-----------------------------------|
| Edge gate | `liquidityEngine.edge.*` (`enforce`, `shadowOnly`, `lambdaSigma`, `minEdgeBpsFloor`) | **`passesEdgeGate`** vs maker fees + optional σ hurdle; if **`enforce`** and not OK → skip place (**`liquidity.edge_blocked`**); if **`shadowOnly`** → log **`liquidity.edge_blocked`** with `shadow: true` and still place. |
| Portfolio gross | `liquidityEngine.portfolio.enforceGlobal`, optional **`betaCapEnabled`** + **`betaToRef`** | **`evaluateGlobalPortfolioGate`** vs **`risk.globalMaxAbsNotional`**; β-weighted gross when **`betaCapEnabled`**. Block → **`liquidity.portfolio_blocked`**. Per-symbol leg cap uses **`effectiveMaxAbsNotional`** when β cap on (**`canPlaceQuoteIntent`**). |
| Two-leg safety | `liquidityEngine.twoLegSafety.enabled` | **`ExecutionService.placeNormalizedRequests`**: smaller-notional leg first; on second **`placeOrder`** failure → **`cancelOrder`** first leg (**`liquidity.two_leg_rollback`**). |
| Regime FSM | `liquidityEngine.regimeFsm.*` | Widens **`minSpreadTicks`** via state multiplier; **`OFF`** → skip quoting (**`liquidity.regime_off`**); transitions → **`liquidity.regime_transition`**. |
| Fair value / skew | `fairValue.mode`, `inventorySkew.*` | Anchors hybrid inputs (microprice, skewed prices). |
| Quote refresh | `useLegacyCancelAllRefresh` (default **`true`**) | **`false`**: **`listOpenOrders`** + **`diffTargetVsWorking`** + **`executePlacementPlan`** (debug **`liquidity.oms_diff`**). **`true`**: **`cancelAll`** + **`placeFromIntent`** (legacy full replace). |
| Markout samples | (markout + FSM) | Debug **`liquidity.markout_sample`** may include **`liquidityRegimeState`** when regime FSM + markout feedback both active. |

Cancel/replace step (§4.3 item 9) is superseded by the refresh row above when OMS diff is enabled.

---

## 11. Structured events (liquidity — non-secret payloads)

| `event` | Typical level |
|---------|----------------|
| `liquidity.edge_blocked` | warn / info |
| `liquidity.portfolio_blocked` | warn |
| `liquidity.two_leg_rollback` | error |
| `liquidity.regime_transition` / `liquidity.regime_off` | info / warn |
| `liquidity.oms_diff` | debug |
| `liquidity.markout_sample` | debug |

Include **`symbol`**, **`liquidityEngineVersion`** (`p0`–`p3`) where emitted.
