# Phase 03 — SymbolRunner v0 (main-thread implementation)

**Status:** Draft  
**Epic traceability:** Epic G (G1.1 encapsulation, G1.3 worker bootstrap sequence **without** OS worker yet), Epic C (C3.3 lifecycle hooks **skeleton**)  
**Prerequisites:** [Phase 02](./phase-02-composition-credentials-execution.md) **Done**.

---

## 1. Objective

Provide a **real** `SymbolRunnerPort` implementation that runs **on the main thread** (or same thread as `runTrader` async flow) for **one symbol**, encapsulating lifecycle: **start** → idle loop placeholder → **stop** with **idempotent** resource cleanup and **cancel-all** when credentials allow. No market-data subscriptions yet beyond **optional** no-op stubs (Phase 04 fills real WS).

---

## 2. In scope / out of scope

### In scope

- New class e.g. `MainThreadSymbolRunner` implementing `SymbolRunnerPort` from `src/runtime/worker/symbol-runner.ts` (or colocated file `main-thread-symbol-runner.ts` exporting implementation while keeping interface in `symbol-runner.ts`).
- Constructor / factory inputs (minimum):
  - `symbol: string` (or `SymbolSpec`)
  - `LoggerPort` (child logger with `symbol` binding)
  - `BinanceRestClient`
  - `ExecutionService | undefined` (from Phase 02)
  - `SignalEngine` instance (new per symbol)
  - `EffectiveFees`, risk knobs slice from `AppConfig` **or** full `AppConfig` (document choice to avoid over-fetching secrets—prefer passing **non-secret** risk DTO)
- `startSymbolRunner(...)`: returns `SymbolRunnerHandle` with:
  - `stop(): Promise<void>` **idempotent**
  - `sendCommand(cmd)` **queue or noop** until Phase 07 IPC—document current behavior
- `stop()` behavior:
  1. Cancel timers created in this phase (if any heartbeat emit for supervisor prep).
  2. If `ExecutionService` defined → `cancelAllOpenOrders(symbol)` **best-effort**; await; log outcome.
  3. Close any **opened** handles from this phase (likely none until Phase 04—still call internal `dispose()` hook).
- Emit **structured heartbeat** on `config.heartbeatIntervalMs` to prepare Phase 07 (supervisor can subscribe in-process).

### Out of scope

- Real WebSocket connect (Phase 04).
- Quoting loop (Phase 05).
- `worker_threads` (Phase 08).

---

## 3. Dependencies & inputs

- `BootstrapExchangeContext.symbols` filtered to accepted specs only (application layer filter using `decisions` where `status === "accepted"`—**define single helper** `selectAcceptedSpecs(bootstrap)`).
- Phase 02 session: REST client + optional execution.

---

## 4. Work breakdown (concrete tasks)

### 4.1 Selection helper

1. Implement `selectAcceptedSymbolSpecs(ctx: BootstrapExchangeContext): readonly SymbolSpec[]` in `src/application/services/` or `src/bootstrap/` (pure function over bootstrap result + decisions).
2. Unit tests: mixed accept/reject fixtures.

### 4.2 Implementation class

3. Implement `MainThreadSymbolRunner` with explicit state enum: `idle | starting | running | stopping | stopped`.
4. `startSymbolRunner(input)` validates `input.symbol` matches `SymbolSpec.symbol`.
5. Internal `heartbeatTimer`: `setInterval` firing structured `event: "runtime.worker_heartbeat"` with `{ symbol, seq }` incrementing seq.
6. `stop()`:
   - If state `stopped`, return immediately.
   - Transition `stopping`; clear interval; await cancel-all; transition `stopped`.
7. `sendCommand`: log at `debug` for unknown commands in v0; no crash.

### 4.3 Wiring in runTrader (single symbol first)

8. For **MVP slice**, start **exactly one** runner for `symbols[0]` OR loop all accepted—**choose**:
   - **Recommended Phase 03:** loop **all** accepted symbols but each runner **no-op** beyond heartbeat to stress multi-symbol timers early.
9. Await `runner.stop()` on shutdown path (Phase 01 exit may not yet hook SIGINT—if not, add **temporary** shutdown from `runTrader` end for Phase 03 only, then unify in Phase 07—document).

### 4.4 Tests

10. Unit: double `stop()` safe.
11. Unit: heartbeat emits N times with fake timers (`vi.useFakeTimers()`).
12. Integration: mock `cancelAllOpenOrders` invoked on stop when execution present.

### 4.5 Documentation

13. Update `src/runtime/worker/README.md`: main-thread runner exists; OS worker replaces later.

---

## 5. Artifacts

| Path | Change |
|------|--------|
| `src/runtime/worker/main-thread-symbol-runner.ts` | **New** |
| `src/bootstrap/select-accepted-symbols.ts` | **New** (or similar) |
| `src/bootstrap/run-trader.ts` | Start/stop runners |
| `test/unit/runtime/main-thread-symbol-runner.test.ts` | **New** |

---

## 6. Acceptance criteria

- [ ] All accepted symbols get a runner instance when session starts (per §4.3 choice).
- [ ] Heartbeat logs appear at configured interval in manual smoke.
- [ ] `stop()` clears timers (verify with fake timers: no pending timers).
- [ ] CI green.

---

## 7. Definition of Done (complete)

1. **Interface:** `SymbolRunnerPort` has a **concrete** in-repo implementation (not only interface).
2. **Lifecycle:** state machine documented in class comment; illegal transitions guarded.
3. **Cleanup:** `cancelAllOpenOrders` on stop when execution exists; **no** call when read-only.
4. **Heartbeats:** seq monotonic; includes `symbol` field always.
5. **Multi-symbol:** if multiple accepted, N heartbeats interleave without throwing (single-threaded order acceptable).
6. **Tests:** fake timers + double stop + cancel-all mock.
7. **Docs:** worker README updated.
8. **No resource leaks** in Vitest suite (run single test file with `--pool=forks` if needed to detect handle leaks).

---

## 8. Test plan

| Test | Technique |
|------|-----------|
| Heartbeat | `vi.advanceTimersByTime` |
| Cancel-all | mock `ExecutionService` or fetch layer |
| Accept filter | table-driven decisions |

---

## 9. Manual smoke

1. Testnet config, read-only → start → heartbeats, stop via process kill (SIGINT) if wired; else short timeout script.
2. With execution + flag (Phase 02) → stop triggers cancel path (verify in Binance UI open orders empty).

---

## 10. Non-functional

- **Log volume:** heartbeats at `info` may be noisy—consider `debug` for per-tick and `info` every Kth—**document decision**.
- **CPU:** interval must not overlap long synchronous work (future phases offload heavy parse).

---

## 11. Risks

| Risk | Mitigation |
|------|------------|
| SIGINT not wired | Temporary `process.on` in runTrader until Phase 07 |
| Cancel-all on testnet without keys | Skip with explicit log |

---

## 12. Handoff to Phase 04

Runner exposes hooks: `onBookReady`, `attachBookAdapter(adapter)` or constructor receives factory—**define extension point** in Phase 04 without renaming runner class.

---

## 13. Open questions

- Heartbeat log level default—resolve with ops preference.
