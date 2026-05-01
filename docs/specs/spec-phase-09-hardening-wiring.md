# SPEC-09 — Hardening modules wiring (technical)

**Phase:** 09  
**Prerequisites:** SPEC-07; SPEC-08 optional.

---

## 1. Purpose

Attach existing modules to **REST hot path**, **shutdown**, **fills**, and **supervisor halt**:

- `src/application/services/rate-limit-budget.ts`
- `src/application/services/markout-tracker.ts`
- `src/application/services/loss-guard.ts`
- `src/domain/regime/regime-flags.ts` (if `features.regimeFlagsEnabled`)

---

## 2. Rate limit (H3)

### 2.1 Wrapper pattern

**Decorate** `BinanceRestClient` OR wrap at call-site:

```typescript
export function withRateLimitBudget(
  client: BinanceRestClient,
  budget: RateLimitBudget,
): BinanceRestClient;
```

If decoration is invasive, **alternative:** single `RestInvocationGate` passed to `ExecutionService` factory — **pick minimal diff**.

### 2.2 Coverage checklist (must wrap every call)

| Call site file | Method |
|----------------|--------|
| `signed-rest-orders.ts` | place/cancel |
| `user-stream.ts` | listenKey create/keepalive/delete |
| `reconciliation.ts` | REST polls |

---

## 3. Shutdown timer registry (H4)

**File:** `src/runtime/timer-registry.ts` (new)

```typescript
export class TimerRegistry {
  register(id: string, t: ReturnType<typeof setInterval>): void;
  clearAll(): void;
}
```

**Instrument:** markout timers, reconcile timer, listenKey refresh, snapshot scheduler, heartbeat checks — **all** `setInterval` from SPEC-01–07 MUST register.

**Call from:** `shutdownTradingProcess` **before** supervisor stop.

---

## 4. Markout (H1)

**Trigger:** On `PositionLedger` mutation after fill — hook **`ledger.onFill`** callback OR poll ledger events.

**Action:** Call `MarkoutTracker.schedule(fillId, midSnapshot)` per existing API.

**Feedback:** If `features.markoutFeedbackEnabled`, push rolling stat into **`QuotingOrchestrator`** via new **`MarkoutPolicy`** interface:

```typescript
export interface MarkoutPolicy {
  widenSpreadTicks(): number; // 0 if none
}
```

---

## 5. Loss guard (H5)

**Wire** `LossGuard` (or equivalent) to PnL updates from `PnlService` inside supervisor — **read existing supervisor + pnl** integration.

**On trip:** `broadcast(HALT_QUOTING)` with reason `session_loss_cap`.

---

## 6. Regime flags (H6)

If `features.regimeFlagsEnabled`, evaluate regime inputs from book mid drift (`symbol-loop.maybeEmitRegimeHaltAsync`), optionally **RV-scaled** impulse when `quoting.regimeTrendImpulseNormalizer === "rv_scaled"` and `risk.rvEnabled` (σ from `SignalEngine.getRvEwmaSigmaLn()`).

**IPC:** Runner emits **`halt_request`** envelope → **`Supervisor.haltQuotingForSymbol(symbol, reason)`** — **only that symbol’s** runner receives **`HALT_QUOTING`** (multi-symbol sessions continue quoting elsewhere unless a portfolio halt fires separately).

---

## 7. Test specification

| ID | Module | Assert |
|----|--------|--------|
| T01 | Rate limit | burst blocked |
| T02 | Timer registry | clearAll kills pending |
| T03 | Loss guard | halt called |

---

## 8. Definition of Done

- [ ] Every checklist row in §2.2 wrapped or explicitly exempt with comment
- [ ] No timer leaks in Vitest after shutdown test

---

## 9. Handoff to SPEC-10

Document which flags MUST be on for live promotion.
