# Phase 07 — Supervisor integration: multi-symbol, heartbeat, cancel-all, halt

**Status:** Draft  
**Epic traceability:** Epic G (G1.4 heartbeat, G1.5 halt broadcast, G2 metrics & 60s snapshot), Epic F2 / H5 (loss / margin trip → halt), Epic H4 (shutdown coordination)  
**Prerequisites:** [Phase 06](./phase-06-user-stream-ledger-reconciliation.md) **Done**.

---

## 1. Objective

Promote `Supervisor` to the **orchestration root**: start/stop **N** `SymbolRunnerPort` instances, consume **heartbeats** / **metric deltas** / **fatal errors**, enforce **missed heartbeat → cancel-all** for affected symbol, implement **`HALT_QUOTING`** broadcast to all runners, wire **`SnapshotScheduler`** for consolidated **60s** output, and unify **SIGINT/SIGTERM** shutdown: stop supervisor → runners → user WS → market WS → final cancel-all policy.

---

## 2. In scope / out of scope

### In scope

- Construct `Supervisor` with concrete config: `heartbeatIntervalMs`, `heartbeatMissThreshold` from `AppConfig`.
- Register each accepted `SymbolSpec` with a **runner factory** (`createRunner(spec, sessionDeps)`).
- **Heartbeat path:**
  - Runner emits heartbeat events (already Phase 03) **or** supervisor polls `lastHeartbeatMonotonicMs`—**standardize on one** (event-driven preferred).
  - Supervisor tracks per-symbol miss count; on threshold: call `execution.cancelAllOpenOrders(symbol)` via shared client or runner command `FORCE_CANCEL_ALL`.
- **`HALT_QUOTING`:** map to `SupervisorCommand` in `messaging/types.ts`; runners must stop placing new orders but **may** finish cancels in flight—document semantics.
- **Snapshot:** `SnapshotScheduler` prints/ logs consolidated block every 60s per RFC §11.2 using **stats sink** + runner deltas if implemented; MVP may log JSON rollup from in-memory counters.
- **Shutdown:** single `ShutdownCoordinator` (reuse `shutdown.ts` if present) invoked from signal handler:
  1. Broadcast halt
  2. `await supervisor.stopAll()`
  3. Flush pino / sync logs
  4. `process.exit(0)` only after awaits complete
- **Global risk:** if `globalMaxAbsNotional` enforced at supervisor, aggregate per-symbol notionals from runner-reported metrics **or** REST poll—**implement one**; document accuracy trade-off.

### Out of scope

- OS-level workers (Phase 08).
- Full external metrics backend.

---

## 3. Dependencies & inputs

- Existing `Supervisor`, `SymbolRegistry`, `SnapshotScheduler`, `shutdown.ts` types.
- Phase 06 runner halt flags + inventory metrics exposure.

---

## 4. Work breakdown (concrete tasks)

### 4.1 Runner interface extensions

1. Add to `SymbolRunnerPort` or parallel interface: `getMetricsSnapshot(): SymbolMetricsDelta` (or push model)—**align** with `Supervisor` deps interface in `supervisor.ts` (update constructor deps if needed **without** breaking tests).
2. Ensure `sendCommand` handles `HALT_QUOTING`, `RESUME` (optional), `CANCEL_ALL` explicitly.

### 4.2 Supervisor wiring in `runTrader`

3. Replace “loop runners directly” with `supervisor.start(allSpecs)`.
4. Pass `LoggerPort`, `StatsSink`, heartbeat config, **cancel-all executor** function injected for testability.

### 4.3 Heartbeat miss → cancel-all

5. Implement miss detection with **monotonic** timestamps; avoid drift from `Date.now` for miss logic.
6. On miss: log `supervisor.heartbeat_miss` with `{ symbol, misses }`; invoke cancel-all once (debounce repeated calls per symbol).

### 4.4 Halt broadcast

7. Wire `LossGuard` / `MarginMonitor` / config trip if already in codebase to call `supervisor.broadcast(HALT_QUOTING, reason)`—**minimum:** manual test hook via SIGUSR2 optional (Unix only—document) **or** HTTP admin later; **MVP:** file-based halt **not** required.

### 4.5 Snapshot

8. Ensure `SnapshotScheduler` fires on wall clock with drift correction or document `setInterval` simplification for MVP.
9. Output includes: per-symbol volume estimate, PnL placeholder, inventory snapshot strings—match existing `stats-sink` capabilities.

### 4.6 Signal handlers

10. Register `SIGINT`/`SIGTERM` in **one** module; remove duplicate handlers from `dev-keep-alive.ts` when `DAMRU_STAY_ALIVE` used together with supervisor—**compose** so only one exit path.
11. Windows note: SIGTERM may differ—document if unsupported.

### 4.7 Tests

12. Unit: heartbeat miss triggers cancel-all mock exactly once.
13. Unit: halt broadcast stops quoting tick (spy on execution).
14. Integration: two runners, supervisor stops both.

### 4.8 Documentation

15. Update `src/runtime/supervisor/README.md` if missing; else `DOCUMENTATION.md` link.

---

## 5. Artifacts

| Path | Change |
|------|--------|
| `src/bootstrap/run-trader.ts` | Supervisor-first |
| `src/runtime/supervisor/supervisor.ts` | Adjust deps if needed |
| `src/runtime/shutdown.ts` | Unified shutdown |
| `src/runtime/dev-keep-alive.ts` | Integrate with supervisor shutdown |
| `test/unit/runtime/supervisor-integration.test.ts` | **New** |

---

## 6. Acceptance criteria

- [ ] N symbols → N runners supervised.
- [ ] Missed heartbeats → cancel-all (mock).
- [ ] Halt stops new orders within one quoting tick boundary (test).
- [ ] Snapshot fires on fake 60s wall clock in test.
- [ ] SIGINT triggers ordered shutdown without unhandled rejections.
- [ ] CI green.

---

## 7. Definition of Done (complete)

1. **Single orchestration root:** `Supervisor` owns lifecycle; `runTrader` does not directly hold runner array except via supervisor.
2. **Reliability:** heartbeat miss policy covered by tests; no tight coupling to wall clock.
3. **Safety:** halt path tested; cancel-all on miss tested.
4. **Observability:** supervisor logs include `symbol`, `workerId` stable identifiers.
5. **Shutdown:** no duplicate signal handlers; dev-keep-alive compatible (document combined usage).
6. **Global cap:** either implemented with documented approximation **or** explicitly deferred with GitHub issue link in phase file.
7. **Docs:** operator-facing “how to stop bot safely” in README.
8. **MVP runnable bot** criteria from parent plan **satisfied** after Phases 01–07 complete.

---

## 8. Test plan

| Case | Method |
|------|--------|
| Heartbeat miss | fake timers + stub runner stops emitting |
| Halt | broadcast then spy quoting |
| Shutdown | signal + await order |

---

## 9. Manual smoke

1. Two symbols testnet, small caps—verify supervisor logs both; stop with Ctrl+C—no orphan orders.
2. Kill -STOP worker thread **not** applicable pre-Phase 08—simulate miss via test only pre-08.

---

## 10. Non-functional

- **Log storm:** rate-limit repeated heartbeat miss logs.
- **Deadlock:** `await` graph documented; no lock holding during cancel-all network.

---

## 11. Risks

| Risk | Mitigation |
|------|------------|
| Circular deps runner↔supervisor | dependency injection interfaces |
| Partial shutdown | try/finally ordering |

---

## 12. Handoff to Phase 08

Define **serializable** `WorkerBootstrapPayload` containing everything worker thread needs to reconstruct runner internals **without** passing non-clonable handles incorrectly.

---

## 13. Open questions

- Resume after halt—automatic vs manual flag; default **manual** for safety.
