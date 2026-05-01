# SPEC-07 — Supervisor runtime, shutdown, heartbeat miss (technical)

**Phase:** 07  
**Prerequisites:** SPEC-06 (user stream, halt paths).

---

## 1. Purpose

Make **`Supervisor`** the **only** owner of symbol lifecycle: start/stop runners, ingest envelopes, detect heartbeat miss → **`cancelAllForSymbol`**, unify **SIGINT/SIGTERM** shutdown with **`SnapshotScheduler`**.

---

## 2. Existing code reference

**Files:**

- `src/runtime/supervisor/supervisor.ts`
- `src/runtime/supervisor/snapshot-scheduler.ts`
- `src/runtime/shutdown.ts`

---

## 3. Normative wiring

### 3.1 `runTrader` tail

After constructing `TradingSession` + `venue` + `AccountUserStreamCoordinator`:

1. `await coordinator.start()` if order-capable.

2. Build `SupervisorDeps`:

```typescript
cancelAllForSymbol: async (symbol) => {
  if (session.venue.execution) await session.venue.execution.cancelAll(symbol);
}
```

3. `statsSink`: reuse `createStdoutStatsSink(session.log)` from composition OR session holds sink — **single instance**.

4. `supervisor.startSymbols(selectAcceptedSymbolSpecs(session.bootstrap).map(s => s.symbol))`.

5. Start **`SnapshotScheduler`** with interval **`60_000`** ms — wire existing class per constructor signature.

### 3.2 Heartbeat tick

`Supervisor.checkHeartbeats()` already exists (`supervisor.ts`). MUST be invoked on a timer:

```typescript
setInterval(() => {
  void supervisor.checkHeartbeats().catch((e) => log.error(...));
}, cfg.heartbeatIntervalMs);
```

**Normative:** interval period SHOULD equal `heartbeatIntervalMs` (same as worker emit cadence) to avoid excessive CPU; document if different.

**Miss rule (existing code):** `maxGap = heartbeatIntervalMs * heartbeatMissThreshold`; if `now - last > maxGap` → `cancelAllForSymbol(symbol)` and reset `lastHeartbeat` to `now` (see `checkHeartbeats` implementation — do not change semantics without epic review).

### 3.3 `broadcast` / `HALT_QUOTING` / per-symbol halt

- **`broadcast(command)`** — portfolio-wide fan-out to **every** runner handle. Used for **`shutdown`**, **`session_loss_cap`**, and any deliberate **kill-all** policy. **`HALT_QUOTING`** dedupes once per reason via internal key `HALT_QUOTING::portfolio::<reason>`.

- **`haltQuotingForSymbol(symbol, reason)`** — sends **`HALT_QUOTING`** **only** to the handle for **`symbol`**. Used for **`halt_request`** envelopes from runners (regime trips) and **`position_drift:<sym>`** from reconcile. Dedupes per **`symbol::HALT_QUOTING::<reason>`** so unrelated symbols keep quoting.

Choose **unique `reason` strings** where operators grep logs (`shutdown`, `session_loss_cap`, `regime_trend_stress`, …).

### 3.4 Shutdown coordinator

**New or extend:** `src/runtime/shutdown-coordinator.ts`

```typescript
export async function shutdownTradingProcess(deps: {
  supervisor: Supervisor;
  userStream: AccountUserStreamCoordinator | undefined;
  snapshotScheduler: { stop(): void } | undefined;
  log: LoggerPort;
}): Promise<void>;
```

**Order (normative):**

1. `supervisor.broadcast({ type: "HALT_QUOTING", reason: "shutdown" })`.

2. `await deps.supervisor.stopAll()`.

3. `await deps.userStream?.stop()`.

4. Stop snapshot scheduler timer.

5. Allow Pino to flush (if sync destination, no-op).

---

## 4. Signal handlers

**Single registration** in `runTrader` after successful start:

```typescript
const onSignal = () => {
  void shutdownTradingProcess(...).finally(() => process.exit(0));
};
process.once("SIGINT", onSignal);
process.once("SIGTERM", onSignal);
```

**Interaction with `attachDevKeepAlive`:** dev-keep-alive MUST NOT register its own SIGINT that exits **before** supervisor stop — **modify** `dev-keep-alive.ts` to accept optional **`onShutdown`** hook OR disable SIGINT handling there when supervisor active — **normative:** only **one** SIGINT path.

---

## 5. Supervisor API additions (if missing)

```typescript
broadcast(command: SupervisorCommand): void;
```

- Iterates handles → `sendCommand` maps `HALT_QUOTING` to envelope `supervisor_cmd` OR direct `sendCommand` API — today `sendCommand` expects `SupervisorCommand` type — **use same**.

---

## 6. Test specification

| ID | Case | Assert |
|----|------|--------|
| T01 | stop heartbeat | after threshold `cancelAllForSymbol` once |
| T02 | SIGINT | shutdown order spy |
| T03 | two symbols | `stopAll` stops both |

---

## 7. Definition of Done

- [ ] MVP global DoD from `docs/phases/README.md` satisfied
- [ ] No duplicate signal handlers

---

## 8. Handoff to SPEC-08

Extract **`WorkerBootstrapPayload`** JSON-serializable from `TradingSession` subset **minus** functions/non-JSON.
