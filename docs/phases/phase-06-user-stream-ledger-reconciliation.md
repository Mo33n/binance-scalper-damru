# Phase 06 — User stream, position ledger, reconciliation, pre-trade limits

**Status:** Draft  
**Epic traceability:** Epic E (E3 user data stream), Epic F (F1 ledger, F1.2 limits), Epic H (H2 reconciliation skeleton)  
**Prerequisites:** [Phase 05](./phase-05-signal-quote-execution-loop.md) **Done**.

---

## 1. Objective

Make **internal position** and **open order awareness** converge with venue reality: **listenKey** lifecycle, **user WS** connection, normalized **fill** events feeding **`PositionLedger`** with **dedupe**, periodic **`ReconciliationService`** (or equivalent) comparing REST snapshot vs internal state, and **hard blocks** on new risk-increasing orders when `maxAbsQty` / `maxAbsNotional` / global cap would be breached.

---

## 2. In scope / out of scope

### In scope

- REST endpoints for **create listenKey**, **keepalive**, **close** (exact paths per `user-stream.ts` / signed REST already in repo—**wire** into runner lifecycle).
- User WS client using same WS stack as market data (shared patterns).
- Parse events: order trade update, account config, margin if available—**minimum** set to update ledger.
- `PositionLedger.applyFill(normalizedFill)` with dedupe key = exchange trade id + order id composite—**document** dedupe strategy.
- Wire **inventory mode** + skew inputs into Phase 05 `QuotingInputs` from ledger state.
- Pre-trade checks in orchestrator **before** place:
  - `|netQty|` vs `maxAbsQty`
  - `|notional|` vs `maxAbsNotional` and `globalMaxAbsNotional` (global may require supervisor—**MVP:** per-symbol only first, then add portfolio rollup in Phase 07).
- Reconciliation timer: interval from config (new `reconciliationIntervalMs` **or** feature `reconciliationIntervalOverrideEnabled` behavior per epic—**align with existing schema flags**).
- On `ReconcileRequired` classification: log + set `internalHalt` flag on runner to stop new quotes until cleared (manual or next successful reconcile—**document policy**).

### Out of scope

- Full H2 margin REST matrix (implement minimal: position endpoint or account endpoint per existing `reconciliation.ts` capabilities).
- Cross-symbol portfolio net in Phase 06 if deferred—**explicitly** list in DoD if punted to Phase 07.

---

## 3. Dependencies & inputs

- `ExecutionService` / credentials for signed REST.
- Existing parsers in `src/infrastructure/binance/user-stream.ts`.
- Existing `PositionLedger`, `ReconciliationService` classes.

---

## 4. Work breakdown (concrete tasks)

### 4.1 listenKey lifecycle

1. On runner `start` after market data stable (define gate: e.g. first book snapshot received OR timeout—document), call create listenKey.
2. Schedule keepalive at Binance-required interval minus safety margin (e.g. 30m key → refresh at 25m).
3. On `stop`, close listenKey **best-effort** then close user WS.
4. Handle **401/invalid key** paths: structured fatal log + halt quoting.

### 4.2 User WS

5. Connect to user WS URL with listenKey; reconnect with backoff on disconnect **with** listenKey refresh if expired.
6. Map raw messages to internal `UserStreamEvent` union (reuse types).

### 4.3 Ledger

7. Subscribe handler: on fill-like events, call ledger; update `inventoryMode` for quoting (`neutral|long_stress|short_stress` per domain rules).
8. Expose `getInventoryReader(): InventoryReader` to Phase 05 orchestrator (retrofit interface from Phase 05 handoff).

### 4.4 Limits

9. Implement `canAddRisk(side, qty, price): { ok: boolean; reason?: string }` using ledger + config caps.
10. Call from orchestrator immediately before `placeFromIntent`; if false, log `quoting.risk_blocked`.

### 4.5 Reconciliation

11. Instantiate `ReconciliationService` with required deps (fill in from existing constructor).
12. `setInterval` reconcile; on mismatch beyond tolerance: set halt flag + emit `event: "reconcile.mismatch"`.
13. Unit tests with fixtures for fill sequences + reconcile outcomes.

### 4.6 Tests

14. Dedupe: duplicate fill event does not change net twice.
15. Limit block: attempted add when at cap → no `placeOrder` call (mock).

### 4.7 Documentation

16. `docs/architecture/user-stream.md` or section in `src/infrastructure/binance/user-stream.ts` header: lifecycle diagram in ASCII.

---

## 5. Artifacts

| Path | Change |
|------|--------|
| `src/runtime/worker/user-stream-lifecycle.ts` | **New** (optional) |
| `src/runtime/worker/main-thread-symbol-runner.ts` | Wire user WS + timers |
| `src/config/schema.ts` | Any missing intervals |
| `test/unit/runtime/user-stream-ledger.test.ts` | **New** |

---

## 6. Acceptance criteria

- [ ] listenKey created and refreshed under fake clock test OR integration mock.
- [ ] Ledger net qty matches fixture fill sequence.
- [ ] Risk block prevents place when at cap (test).
- [ ] Reconcile mismatch sets halt + stops new orders in test.
- [ ] CI green.

---

## 7. Definition of Done (complete)

1. **User stream:** connect, reconnect, stop without orphan timers; listenKey closed on shutdown path.
2. **Ledger:** authoritative for **fills received**; dedupe proven.
3. **Quoting integration:** inventory stress affects `QuotingInputs` per domain tests.
4. **Limits:** enforced on every intended place; symmetric for bid/ask adds.
5. **Reconciliation:** periodic run; mismatch behavior documented and tested.
6. **Security:** listenKey never logged at `info` (mask or omit); only `event: "userstream.listenkey.created"` with non-sensitive metadata.
7. **Failure modes:** auth errors halt quoting with clear operator message.
8. **Docs:** lifecycle doc complete.
9. **Manual testnet:** run 10 minutes, compare UI position vs logs at end (operator sign-off in PR).

---

## 8. Test plan

| Layer | Cases |
|-------|--------|
| Unit | Dedupe, limit math, halt flag |
| Integration | Mock user stream json sequence |
| Manual | Testnet keys, small qty fills |

---

## 9. Manual smoke

1. Place + fill small trade manually outside bot, ensure ledger update path doesn't crash if event types vary—**optional**.
2. Bot-run: verify fills update internal metrics logs.

---

## 10. Non-functional

- **Timer caps:** max concurrent reconcile calls = 1 (re-entrancy guard).
- **Memory:** user stream queue bounded similarly to tape.

---

## 11. Risks

| Risk | Mitigation |
|------|------------|
| Hedge vs one-way mismatch | Detect ACCOUNT_UPDATE fields; assert config |
| Stale listenKey | proactive refresh |

---

## 12. Handoff to Phase 07

Supervisor needs per-symbol **halt** reasons and **aggregate** risk for global cap—expose events on a **bus** interface from runner (`on(event, cb)`) or aggregate in supervisor by polling—**choose** in Phase 07 design; Phase 06 should emit structured `risk.*` / `reconcile.*` events for supervisor subscription.

---

## 13. Open questions

- Portfolio `globalMaxAbsNotional` enforcement location—runner vs supervisor—**decide** before Phase 07.
