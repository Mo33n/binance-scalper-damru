# Phase 05 — Signal → hybrid quote → execution + reprice

**Status:** Draft  
**Epic traceability:** Epic D (D1.6 facade), Epic E (E1 hybrid, E2 REST place/cancel, E4 reprice throttles)  
**Prerequisites:** [Phase 04](./phase-04-market-data-runner.md) **Done**.

---

## 1. Objective

Close the **trading loop** on the hot path: periodically (or on events) compute **`QuotingInputs`** from `SignalEngine` + book snapshot + inventory mode (flat at first), run **hybrid quoting** domain to produce `QuoteIntent`, then call **`ExecutionService.placeFromIntent`** when **order-capable** mode; implement **cancel/replace** via `reprice-loop` policies; enforce **staleness pause** and **`liveQuotingEnabled`** + dry-run guards at call site.

---

## 2. In scope / out of scope

### In scope

- Build `QuotingInputs` struct mapping:
  - `toxicityScore` / EWMA from `SignalEngine.getSnapshot()` (or actual API names in code)
  - `touchSpreadTicks` from runner snapshot
  - `minSpreadTicks` from `SymbolSpec` / bootstrap effective min
  - `inventoryMode` default `neutral` until Phase 06 ledger feeds real position
  - Optional `rvRegime` if `features.regimeFlagsEnabled` and RV wired—**if not ready**, pass fixed `normal` with TODO gated by flag **false** default
- Integrate `src/application/services/reprice-loop.ts` (or extract minimal scheduler) with:
  - Minimum interval between REST quote actions (config: add `repriceMinIntervalMs` **or** reuse `heartbeatIntervalMs`—**document trade-off** in schema comment)
  - Debounce rapid book updates (coalesce)
- **First quote path:** `POST_ONLY` maker quotes for bid/ask per `QuoteIntent` mapping from `ExecutionService` (already supports multiple requests per intent—verify).
- **Cancel stale:** before new place, cancel working orders for that symbol side policy—align with `reprice-loop` + `ExecutionService.cancel*` helpers.
- **Guards:**
  - If `getBookStalenessMs()` beyond threshold (new config `maxBookStalenessMs` **or** reuse risk—**add schema field** with default sensible), **skip** place and log `event: "quoting.skipped_stale_book"`.
  - If read-only mode, log `quoting.skipped_read_only` at `debug` once per interval max.

### Out of scope

- User-stream fill reconciliation as **truth** for inventory (Phase 06)—use **flat** inventory here.
- Markout feedback loop (Phase 09).

---

## 3. Dependencies & inputs

- `ExecutionService`, `SymbolSpec`, `EffectiveFees`, hybrid quoting pure functions from `src/domain/quoting/`.
- Runner snapshot API from Phase 04.

---

## 4. Work breakdown (concrete tasks)

### 4.1 Config schema

1. Add `maxBookStalenessMs: z.number().positive()` (or optional with default) to appropriate schema section (likely under `risk` or new `quoting` object—**pick**, document).
2. Add `repriceMinIntervalMs` if not reusing heartbeat—**must** prevent REST storm.

### 4.2 Quoting orchestrator inside runner

3. New internal class `QuotingLoop` or methods on runner:
   - `tickQuoting(nowMonotonicMs): Promise<void>`
4. `tickQuoting` steps:
   a. Guard: read_only → return  
   b. Guard: `liveQuotingEnabled` false → return  
   c. Guard: staleness → return  
   d. Build `QuotingInputs`  
   e. Call domain `computeQuoteIntent` (actual export name from codebase)  
   f. Compare to last working intent hash; if unchanged skip  
   g. Else cancel/replace per reprice policy  
   h. `await execution.placeFromIntent` with try/catch; map errors to structured logs (`quoting.order_error`)

### 4.3 Inventory placeholder

5. Pass `inventoryMode: "neutral"` and zero skew until Phase 06—**single constant** exported for tests.

### 4.4 Tests

6. Golden tests for **domain** already exist—add **orchestrator** tests with fake `ExecutionService` recording calls order: cancel before place when intent changes.
7. Test: staleness guard prevents place.
8. Test: read_only prevents place.

### 4.5 Documentation

9. README “Danger” section: enabling `liveQuotingEnabled` sends **real** orders on testnet/live.
10. DEVELOPERS: env flags recap.

---

## 5. Artifacts

| Path | Change |
|------|--------|
| `src/config/schema.ts` | New thresholds |
| `src/runtime/worker/quoting-orchestrator.ts` | **New** (optional split) |
| `src/runtime/worker/main-thread-symbol-runner.ts` | Wire tick timer |
| `test/unit/runtime/quoting-orchestrator.test.ts` | **New** |

---

## 6. Acceptance criteria

- [ ] With mocks, sequence cancel→place observed when intent changes.
- [ ] With read_only, zero REST order calls.
- [ ] With `liveQuotingEnabled: false`, zero calls even with keys.
- [ ] Staleness skip path covered by test.
- [ ] CI green.

---

## 7. Definition of Done (complete)

1. **Loop exists:** timer or book-driven trigger invokes quoting tick on interval respecting `repriceMinIntervalMs`.
2. **Domain purity preserved:** no Binance imports added under `domain/`.
3. **Execution:** POST_ONLY path used; reduce-only semantics respected when domain emits flatten (if any—likely none in flat inventory phase).
4. **Safety defaults:** cannot accidentally quote on clean clone without explicit config edits + keys.
5. **Logs:** every skip reason has stable `event` enum.
6. **Tests:** orchestrator tests ≥ scenarios in §4.4.
7. **Manual testnet:** operator checklist executed once (document results in PR): small size, verify orders appear, cancel on stop (Phase 03 stop may run cancel-all—coordinate).

---

## 8. Test plan

| Case | Assert |
|------|--------|
| Intent unchanged | no REST |
| Intent changed | cancel/replace order |
| Error mapping | `Retryable` vs `Fatal` logged differently |

---

## 9. Manual smoke (testnet)

1. Enable `liveQuotingEnabled`, small `maxOpenNotionalQuote`, one symbol.
2. Confirm orders rest in UI; stop process; confirm **cancel-all** from Phase 03 + Phase 05 leaves flat.

---

## 10. Non-functional

- **REST weight:** track calls per minute in debug metrics (optional counter for Phase 09).
- **Latency:** avoid synchronous heavy work inside WS callback—move quoting tick to `setImmediate` / micro-queue if measured issue.

---

## 11. Risks

| Risk | Mitigation |
|------|------------|
| Orphan orders on crash | cancel-all on stop (already) + document need for user stream reconcile in Phase 06 |
| REST storm | `repriceMinIntervalMs` + debounce |

---

## 12. Handoff to Phase 06

Quoting orchestrator must accept **injected** `PositionLedger` reader interface for inventory skew and limit checks in next phase without breaking constructor signatures—define `InventoryReader` interface now.

---

## 13. Open questions

- Hedge vs one-way `positionSide`—must match account mode; document assumption or read from exchange in later phase.
