# Phase 08 — OS-level worker isolation (`worker_threads` preferred)

**Status:** Draft  
**Epic traceability:** Epic G (G1.1 process model, G1.2 IPC versioning, G1.4 cancel on crash), Epic H4 (shutdown joins workers)  
**Prerequisites:** [Phase 07](./phase-07-supervisor-integration.md) **Done**.

---

## 1. Objective

Move per-symbol execution from **main thread** to **`worker_threads`** (preferred first for shared memory / lower overhead) **or** `child_process` (document if chosen for stronger isolation). Preserve **`SymbolRunnerPort`** for supervisor: main thread owns supervisor + IPC; worker runs **market data + quoting + user stream** loop. **Serialize** bootstrap payload across boundary with **versioned envelope** (`runtime/messaging/envelope.ts`).

---

## 2. In scope / out of scope

### In scope

- `src/runtime/worker/symbol-worker.ts` (new entry) — `parentPort` message loop.
- Message protocol: `WorkerBootstrapPayloadV1` including:
  - `protocolVersion: 1`
  - `symbol`, serialized `SymbolSpec` (JSON-safe subset), REST/WS base URLs, **credential handles policy** (see §13—likely **not** pass raw secrets; use env inheritance or **named pipe** / **shared memory**—**must document chosen security model**)
  - Feature flags subset, risk caps subset, heartbeat interval
- **Parent → worker:** commands: `START`, `HALT`, `SHUTDOWN`.
- **Worker → parent:** `Heartbeat`, `MetricDelta`, `FatalError`, `LogRelay` (optional; prefer structured forwarding).
- Supervisor uses `WorkerSymbolRunner` implementing `SymbolRunnerPort` that wraps `Worker` lifecycle.
- On worker `exit` or `error` event: supervisor triggers **cancel-all** for symbol (same as heartbeat miss).
- Graceful shutdown: post `SHUTDOWN`, await worker exit with timeout; **force terminate** after T seconds with log.

### Out of scope

- Kubernetes / Docker packaging.
- Shared memory ring buffers for ultra-low latency (future).

---

## 3. Dependencies & inputs

- Stable message types in `src/runtime/messaging/`.
- Phase 07 supervisor cancel-all executor.

---

## 4. Work breakdown (concrete tasks)

### 4.1 Security model for credentials

1. **Decision record required:** common pattern = worker inherits `process.env` (keys already in env) **or** main passes one-time token—**never** log payload.
2. If env inheritance: worker entry reads same `BINANCE_API_KEY` as parent; document in README security implications on shared host.

### 4.2 Worker entry

3. Implement `symbol-worker.ts` with `workerData` typed.
4. Inside worker: reconstruct logger (pino **destination** in worker thread—sync stdout policy may differ; **test** log visibility).
5. Reuse **same** internal classes as main-thread runner via shared module imports (watch for circular ESM graphs—split if needed).

### 4.3 Parent adapter

6. `WorkerSymbolRunner` implements `SymbolRunnerPort`:
   - `startSymbolRunner` spawns `new Worker(new URL('./symbol-worker.js', import.meta.url), { workerData })` (ESM pattern).
   - Wire `parentPort.on('message')` to supervisor callbacks.

### 4.4 IPC hardening

7. Unknown `protocolVersion` → reject worker start with fatal log.
8. Malformed envelope: drop + `warn` counter; supervisor metric optional.

### 4.5 Tests

9. Vitest `worker_threads` test: echo heartbeat round-trip.
10. Test: worker throw → parent observes `error` → cancel-all mock invoked.

### 4.6 Performance smoke (optional)

11. Document max symbols per machine guidance after micro-benchmark (non-blocking).

---

## 5. Artifacts

| Path | Change |
|------|--------|
| `src/runtime/worker/symbol-worker.ts` | **New** entry |
| `src/runtime/worker/worker-symbol-runner.ts` | **New** parent adapter |
| `src/runtime/messaging/envelope.ts` | Version + payload types extend |
| `test/unit/runtime/worker-symbol-runner.test.ts` | **New** |

---

## 6. Acceptance criteria

- [ ] ≥2 workers concurrently in integration test (lightweight).
- [ ] Shutdown ends all workers without zombie processes (verify in test teardown).
- [ ] Cancel-all on worker crash path tested.
- [ ] CI green (may need Vitest pool config for workers).

---

## 7. Definition of Done (complete)

1. **Isolation:** Per-symbol heavy loop off main thread; main thread remains responsive for supervisor aggregation.
2. **Protocol:** Versioned messages; malformed safe.
3. **Security:** Documented credential strategy; no secrets in IPC payloads.
4. **Lifecycle:** start/stop/shutdown semantics identical from supervisor POV as Phase 07.
5. **Tests:** worker round-trip + crash + shutdown.
6. **Observability:** worker logs include `threadId` / `workerId` stable.
7. **README:** “Running workers” + debugging (how to attach inspector to worker).
8. **Deprecation:** `MainThreadSymbolRunner` retained behind flag `features.useWorkerThreads` default **true** after stabilization—optional; if removed, document migration.

---

## 8. Test plan

| Case | Expected |
|------|----------|
| Protocol mismatch | worker refuses start |
| Shutdown | clean exit |
| Crash | cancel-all |

---

## 9. Manual smoke

1. Two symbols, observe two worker threads in `ps` or logging.
2. `kill -9` on worker subprocess **if** child_process path—**only** if implemented; for `worker_threads`, simulate crash via test.

---

## 10. Non-functional

- **Serialization cost:** keep payload small; large `SymbolSpec` OK.
- **CPU affinity:** out of scope.

---

## 11. Risks

| Risk | Mitigation |
|------|------------|
| Pino in worker | test log interleaving; consider child log field `worker: true` |
| ESM worker URL | follow Node 20 docs exactly |

---

## 12. Handoff to Phase 09

Hardening modules attach to **supervisor** events and **worker** metrics stream—ensure `MetricDelta` schema includes counters H3/H5 need.

---

## 13. Open questions

- Passing secrets: env vs message—**security review required** before merge.
