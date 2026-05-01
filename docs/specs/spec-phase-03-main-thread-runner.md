# SPEC-03 — Main-thread `SymbolRunnerPort` implementation (technical)

**Phase:** 03  
**Prerequisites:** SPEC-02 (`TradingSession` with `venue`).

---

## 1. Purpose

Implement **`SymbolRunnerPort`** with a **main-thread** runner that:

- Satisfies existing **`Supervisor`** expectations (`startSymbolRunner` → `SymbolRunnerHandle`, **raw JSON envelopes** on `onMessage`).
- Emits **heartbeat** envelopes on interval.
- **`stop()`** idempotent; cancel-all when `venue.execution` defined.

---

## 2. Existing contracts (must not break)

### 2.1 `SymbolRunnerPort`

**File:** `src/runtime/worker/symbol-runner.ts`

Current shape MUST remain valid:

```typescript
startSymbolRunner(input: {
  symbol: string;
  workerId: string;
  onMessage(raw: string): void;
  onExit(): void;
}): SymbolRunnerHandle;
```

### 2.2 Supervisor ingestion

**File:** `src/runtime/supervisor/supervisor.ts`

Passes `onMessage(raw)` into `ingestRawMessage` → `parseEnvelope(raw)`. Therefore runner MUST send **`serializeEnvelope`** strings from `src/runtime/messaging/envelope.ts` with `v: 1`.

### 2.3 Heartbeat payload

Use **`HeartbeatPayload`** from `src/runtime/messaging/types.ts`:

```typescript
{
  workerId, symbol, seq, sentAtMonotonicMs
}
```

**Envelope kind:** `"heartbeat"`.

---

## 3. Module map

| Action | Path |
|--------|------|
| Create | `src/bootstrap/select-accepted-symbols.ts` — `selectAcceptedSymbolSpecs(ctx: BootstrapExchangeContext): readonly SymbolSpec[]` |
| Create | `src/runtime/worker/main-thread-symbol-runner.ts` — class implementing `SymbolRunnerPort` |
| Modify | `src/bootstrap/run-trader.ts` — instantiate runner port + start symbols (temporary wiring before SPEC-07: either direct loop OR supervisor — **spec below chooses minimal**) |
| Create | `test/unit/runtime/main-thread-symbol-runner.test.ts` |

---

## 4. `selectAcceptedSymbolSpecs`

**Signature:**

```typescript
import type { BootstrapExchangeContext } from "../../application/services/bootstrap-exchange.js";
import type { SymbolSpec } from "../../infrastructure/binance/types.js";

export function selectAcceptedSymbolSpecs(
  ctx: BootstrapExchangeContext,
): readonly SymbolSpec[];
```

**Algorithm:**

1. Build `Map<string, BootstrapSymbolDecision>` from `ctx.decisions` keyed by `symbol`.
2. Return `ctx.symbols.filter((spec) => map.get(spec.symbol)?.status === "accepted")`.
3. If decision missing for a symbol in `ctx.symbols`: treat as **rejected** (log once at callsite — not in pure function).

---

## 5. `MainThreadSymbolRunner` class

**File:** `src/runtime/worker/main-thread-symbol-runner.ts`

**Declaration:** `export class MainThreadSymbolRunner implements SymbolRunnerPort`

### 5.1 Constructor deps

```typescript
export interface MainThreadRunnerDeps {
  readonly session: TradingSession; // narrowed: bootstrap already accepted-only for started symbols
  readonly monotonicNowMs: () => number;
}
```

**Note:** For per-symbol instance, pass **child logger** `log.child({ symbol })` if `LoggerPort` supports child — else prefix events.

### 5.2 Internal state enum

```typescript
type RunnerState = "idle" | "running" | "stopping" | "stopped";
```

### 5.3 `startSymbolRunner`

1. If internal registry already has active handle for same `symbol`, MUST return existing handle OR throw — **pick idempotent return** (supervisor guards duplicates today).

2. Start `setInterval` every `session.config.heartbeatIntervalMs`:
   - Increment `seq`.
   - Build `HeartbeatPayload`.
   - `onMessage(serializeEnvelope({ v:1, kind:"heartbeat", payload }))`.

3. Set state `running`.

4. Return handle:

```typescript
{
  workerId: input.workerId,
  symbol: input.symbol,
  stop: async () => { ... },
  sendCommand: (cmd) => { ... },
}
```

### 5.4 `sendCommand`

- **`HALT_QUOTING`:** set internal `halted = true` (used later by SPEC-05); log `debug`.
- **`RESUME_QUOTING`:** `halted = false`.
- **`CANCEL_ALL`:** if `symbol` matches, call cancel-all path (same as stop partial).

### 5.5 `stop()`

1. If state `stopped`, resolve immediately.
2. Set `stopping`; clear heartbeat interval.
3. If `session.venue.execution` defined: `await execution.cancelAll(symbol)` (`ExecutionService.cancelAll` in `execution-service.ts`).
4. Call `onExit()` **once** (supervisor uses for disconnect metric — ensure idempotent guard).
5. State `stopped`.

---

## 6. Wiring in `runTrader` (SPEC-03 only)

**Minimal:** After `TradingSession` built:

```typescript
const port = new MainThreadSymbolRunner({ session, monotonicNowMs: () => session.clock.monotonicNowMs() });
const specs = selectAcceptedSymbolSpecs(session.bootstrap);
for (const spec of specs) {
  port.startSymbolRunner({ symbol: spec.symbol, workerId: `w-${spec.symbol}`, onMessage: () => {}, onExit: () => {} });
}
```

**Correction:** `onMessage` MUST go to supervisor — SPEC-03 requires introducing **`SupervisorRouter`** OR temporarily passing **no-op** only if supervisor not wired — **NORMATIVE for SPEC-03:** wire **Supervisor** immediately with `MainThreadSymbolRunnerPort` as `deps.runners` **OR** pass real `onMessage` from a thin coordinator.

**Decision for clean incremental merge:** Implement **`createDevRunnerCoordinator(session)`** that holds `Supervisor` instance + `MainThreadSymbolRunner` — starts symbols. Moves to SPEC-07 fully — for SPEC-03 minimum, **inline** supervisor construct matching:

```typescript
const runners = new MainThreadSymbolRunner(...);
const supervisor = new Supervisor(
  { heartbeatIntervalMs: cfg.heartbeatIntervalMs, heartbeatMissThreshold: cfg.heartbeatMissThreshold },
  { runners, statsSink: ctx.statsSink, nowUtcIso: () => clock.utcNowIso(), monotonicNowMs: () => clock.monotonicNowMs(), cancelAllForSymbol: async (sym) => { ... }, log },
);
supervisor.startSymbols(specs.map(s => s.symbol));
```

If cancel-all duplicates ExecutionService, inject **shared async function** from session.

---

## 7. Test specification

| ID | Case | Assert |
|----|------|--------|
| T01 | double `stop()` | second resolves, single `onExit` |
| T02 | fake timers | N heartbeats ⇒ N envelopes, monotonic `seq` |
| T03 | `execution` undefined | `stop` does not throw; no cancel call |
| T04 | `execution` mock | `cancelAllOpenOrders` called once on stop |

---

## 8. Definition of Done

- [ ] `SymbolRunnerPort` has concrete implementation file
- [ ] Envelope JSON parses with existing `parseEnvelope`
- [ ] Supervisor unit tests still pass or updated mocks

---

## 9. Handoff to SPEC-04

Runner internals gain **`attachMarketData(...)`** private methods — avoid exporting until SPEC-04.
