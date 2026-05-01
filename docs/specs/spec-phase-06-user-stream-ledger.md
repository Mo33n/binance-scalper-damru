# SPEC-06 — User stream, ledger, reconciliation, pre-trade limits (technical)

**Phase:** 06  
**Prerequisites:** SPEC-05 (quoting loop calling `ExecutionService`).

---

## 1. Purpose

Implement **listenKey** lifecycle + **user data WebSocket** per runner (or shared account singleton if Binance allows one stream — **USD-M user stream is account-wide** — normative: **one user stream per process** feeding **all** symbol ledgers).

**Critical design decision (normative):**

- Binance futures **user stream** is typically **one listenKey per account**, not per symbol.
- MUST implement **`AccountUserStreamService`** at **`TradingSession`** level (singleton), not inside each `MainThreadSymbolRunner` duplicate connection.

---

## 2. Architecture adjustment vs phase narrative

| Component | Responsibility |
|-----------|----------------|
| `AccountUserStreamService` | listenKey create/keepalive/close; WS connect; demux events by `symbol` |
| `PositionLedger` (existing) | Per-symbol instance or map `symbol → ledger` |
| `QuotingOrchestrator` | Calls `inventoryReader` + `canAddRisk(side, qty, price)` before `tick` place |

---

## 3. Module map

| Action | Path |
|--------|------|
| Create | `src/application/services/account-user-stream.ts` OR `src/infrastructure/binance/account-user-stream-coordinator.ts` |
| Modify | `src/bootstrap/run-trader.ts` — start coordinator after `TradingSession`, inject into supervisor/runners |
| Modify | `src/runtime/worker/main-thread-symbol-runner.ts` — receive **callbacks** or **ledger ref** from coordinator |
| Wire | `ReconciliationService` — existing constructor from `src/application/services/reconciliation.ts` |
| Create | `test/unit/services/account-user-stream.test.ts` |

---

## 4. `AccountUserStreamCoordinator` API

```typescript
export interface AccountUserStreamCoordinator {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Register ledger mutator for symbol — idempotent. */
  registerSymbol(symbol: string, ledger: PositionLedger): void;
}
```

### 4.1 `start()` algorithm

1. Require `venue.execution` non-null OR separate **read-only signed** client for listenKey only — **listenKey needs signed REST** — if read-only mode, MUST skip user stream and log `userstream.skipped_read_only`.

2. `POST /fapi/v1/listenKey` per existing `user-stream.ts` helpers — reuse code.

3. Schedule keepalive interval: Binance futures **30m** expiry typical — refresh at **25m** (`15 * 60 * 1000` ms wrong — use **`25 * 60 * 1000`**).

4. Connect WS URL = base user stream URL + listenKey from Binance docs — **single helper** in infrastructure.

5. On message: parse with existing parsers → route fills to `ledger.applyFill(...)` for matching symbol.

6. Dedupe: use **`tradeId`** + **`orderId`** composite key — MUST match `PositionLedger` existing API.

### 4.2 `stop()`

1. Close WS.

2. `DELETE listenKey` best-effort.

3. Clear timers.

---

## 5. Pre-trade risk gate

**New thin module:** `src/application/services/pre-trade-risk.ts`

```typescript
export function canPlaceQuoteIntent(args: {
  readonly intent: QuoteIntent;
  readonly ledger: PositionLedger;
  readonly cfg: AppConfig["risk"];
  readonly spec: SymbolSpec;
}): { ok: true } | { ok: false; reason: string };
```

**Rules (normative MVP):**

1. If intent adds inventory on side that increases `|net|` beyond `cfg.maxAbsQty` → reject.

2. If estimated notional (`price * qty * contractSize`) exceeds `cfg.maxAbsNotional` → reject.

3. Global cap: if sum across symbols required — **defer to SPEC-07** aggregator OR approximate from single-symbol only — document choice.

Integrate at start of **`QuotingOrchestrator.tick`** before cancel/replace.

---

## 6. Reconciliation

**Interval:** Use existing config pattern — if `reconciliationIntervalMs` missing, add to schema default **`60_000`**.

**Algorithm:**

1. On timer, call `ReconciliationService` method(s) already implemented — **read class** and specify exact method in implementation PR.

2. On mismatch classification `ReconcileRequired`: set **global** `haltFlag` readable by orchestrators (`supervisor.broadcast(HALT_QUOTING)`).

---

## 7. Logging contract

| `event` | Notes |
|---------|-------|
| `userstream.listenkey.created` | MUST NOT include raw key at info level — omit or mask |
| `userstream.skipped_read_only` | info |
| `reconcile.mismatch` | warn + fields `{ symbol?, delta? }` safe |

---

## 8. Test specification

| ID | Case | Assert |
|----|------|--------|
| T01 | duplicate fill event | ledger net unchanged |
| T02 | limit breach | `tick` does not call place |
| T03 | reconcile mismatch | halt broadcast spy |

---

## 9. Definition of Done

- [ ] Single user stream for account (no duplicate listenKeys)
- [ ] Testnet manual: fills move ledger

---

## 10. Handoff to SPEC-07

Supervisor **`cancelAllForSymbol`** already exists — ensure coordinator **`stop`** ordering: **halt → cancel → close WS**.
