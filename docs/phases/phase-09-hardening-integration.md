# Phase 09 — Hardening integration (Epic H selective)

**Status:** Draft  
**Epic traceability:** Epic H — H3 rate limits, H4 shutdown (final polish), H1 markout, H5 loss limits / cooldown, H6 regime halts (config-gated)  
**Prerequisites:** [Phase 07](./phase-07-supervisor-integration.md) **Done**; [Phase 08](./phase-08-worker-isolation.md) **Done or explicitly skipped** with flag (document).

---

## 1. Objective

Wire **existing hardening modules** into the **live runtime** so defenses are not “library-only”: REST **rate-limit budget** around hot paths, **markout** scheduling on fills with optional feedback into quoting/reprice, **session/daily loss** trips to **supervisor halt**, **regime / symbol halt** when `regimeFlagsEnabled`, and **final** shutdown ordering validated under failure injection.

---

## 2. In scope / out of scope

### In scope (prioritized)

| Priority | Module (existing code) | Runtime wiring |
|:--------:|------------------------|------------------|
| P0 | `rate-limit-budget.ts` | Wrap `BinanceRestClient` calls used by quoting + user stream keepalive + reconcile |
| P0 | `shutdown.ts` | Ensure all timers (markout, reconcile, keepalive, snapshot) registered for cancel |
| P1 | `markout-tracker.ts` + `features.markoutFeedbackEnabled` | On fill: schedule horizons; if enabled, adjust reprice aggressiveness via documented hook into Phase 05 orchestrator |
| P1 | `loss-guard.ts` / session caps | Trip `HALT_QUOTING` on breach |
| P2 | `regime-flags` / H6 | When `regimeFlagsEnabled`, connect RV+VPIN priority table to halt / widen per epic |

### Out of scope

- Full external observability stack (Datadog, etc.).
- Changing markout math algorithms (wire only).

---

## 3. Dependencies & inputs

- Supervisor broadcast + runner command channel from Phase 07/08.
- Fill events from Phase 06.
- Config flags in `featuresSchema`.

---

## 4. Work breakdown (concrete tasks)

### 4.1 Rate limit (H3)

1. Identify **all** REST call sites in hot path (orders, cancel, listenKey, reconcile, exchangeInfo refresh if any).
2. Wrap with `RateLimitBudget` acquire/release; on throttle: log `rest.throttled` + **skip** or **queue** action—document per call type (orders likely queue briefly; cancels likely immediate priority).
3. Tests: burst calls → throttled count increments; no unbounded queue growth.

### 4.2 Shutdown (H4)

4. Register every `setInterval`/`setTimeout` in a central **TimerRegistry** disposable from shutdown coordinator.
5. Test: fake shutdown cancels markout timers (if markout active).

### 4.3 Markout (H1)

6. On ledger fill application, enqueue markout sample job with fill id + mid snapshot reference from book read model.
7. If `markoutFeedbackEnabled`, pass rolling stat into quoting orchestrator **as input** (extend `QuotingInputs` or side-channel policy object).
8. Cap concurrent markout timers (pool) per epic H1.2 intent—document max.

### 4.4 Loss guard (H5)

9. Wire `LossGuard` (or equivalent) to PnL stream from ledger / realized; on trip `supervisor.broadcast(HALT)` with reason `session_loss_cap`.
10. Cooldown timer: optional—if implemented, document operator recovery.

### 4.5 Regime halts (H6)

11. If flag enabled, connect `regime-flags` output to halt/widen; else no-op with `debug` log once at startup.

### 4.6 Documentation

12. `docs/architecture/hardening-runtime.md` summarizing wiring diagram.

---

## 5. Artifacts

| Path | Change |
|------|--------|
| `src/infrastructure/binance/rest-client.ts` | Optional decorator pattern |
| `src/runtime/shutdown.ts` | Timer registry |
| `src/runtime/worker/*` | Hooks |
| `docs/architecture/hardening-runtime.md` | **New** |

---

## 6. Acceptance criteria

- [ ] REST storm test does not exceed configured weight budget (mock weight).
- [ ] Shutdown clears markout timers (test).
- [ ] Loss trip halts quoting in test.
- [ ] With flags off, no behavior change vs Phase 07 baseline (regression test / snapshot of events).

---

## 7. Definition of Done (complete)

1. **Rate limit:** all identified REST sites wrapped or explicitly exempted with comment “why exempt.”
2. **Shutdown:** no timer leaks in Vitest after 200 shutdown cycles (optional stress) or reasoned skip.
3. **Markout:** fill triggers sampling; negative series triggers policy action **when** flag enabled; **deterministic** tests with fake clock.
4. **Loss:** session cap enforced; logs stable `event` keys.
5. **Regime:** gated; no effect when disabled.
6. **Docs:** hardening-runtime.md merged.
7. **CI:** full green; flaky tests not introduced.

---

## 8. Test plan

| Module | Tests |
|--------|-------|
| Rate limit | synthetic burst |
| Markout | fake clock horizons |
| Loss | inject PnL series |

---

## 9. Manual smoke

1. Enable markout feedback on testnet with tiny size; observe widened spreads or paused sides per policy (document expected UX).
2. Simulate loss cap via config absurdly low—confirm halt.

---

## 10. Non-functional

- **Latency:** rate limiter must not add mutex contention on hot path—profile if needed.
- **Determinism:** markout uses monotonic scheduling.

---

## 11. Risks

| Risk | Mitigation |
|------|------------|
| Feedback loop instability | cap magnitude of spread change per window |
| Timer leaks | central registry |

---

## 12. Handoff to Phase 10

Promotion docs reference **which** hardening flags must be true before live sizing (Epic I).

---

## 13. Open questions

- Exact mapping from markout stat to quote width—define in PR with quant owner sign-off.
