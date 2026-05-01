# SPEC-04 — Market data inside runner (technical)

**Phase:** 04  
**Prerequisites:** SPEC-03 (`MainThreadSymbolRunner` + supervisor wiring skeleton).

---

## 1. Purpose

For each running symbol, establish **Binance USD-M** depth + aggTrade streams using existing infrastructure; feed **tape** into **`SignalEngine`**; expose **staleness** and **touch spread ticks** for quoting.

---

## 2. Non-goals

- Order REST calls (SPEC-05).
- listenKey user stream (SPEC-06).

---

## 3. Module map

| Action | Path |
|--------|------|
| Create | `src/runtime/worker/market-data-controller.ts` (or fold into `main-thread-symbol-runner.ts` if <400 LOC — **prefer separate file** for testability) |
| Modify | `src/runtime/worker/main-thread-symbol-runner.ts` — lifecycle calls into controller |
| Create | `test/integration/market-data-runner.test.ts` — mock WS |
| Depth pipeline | `src/infrastructure/binance/depth-session.ts` — pending queue, bridge microtasks, REST resync w/ backoff, transport gating |
| Depth parse | `src/infrastructure/binance/depth-stream-parse.ts` — JSON → `DepthDiffEvent`, frame limits |
| Book projection | `src/infrastructure/binance/depth-order-book.ts` — snapshot + diff apply, gap detection |
| REST snapshot cap | `src/infrastructure/binance/depth-snapshot-gate.ts` — limit concurrent `/fapi/v1/depth` fetches |

**Reconnect:** `BinanceBookFeedAdapter` runs a per-symbol WS loop: on disconnect/error it logs `book.ws_closed` / `book.ws_error`, calls `DepthSession.notifyTransportDisconnect()` (desync + `onGap`), backs off, reconnects, and runs `bootstrapFromRest()` again.

---

## 4. Dependencies on existing code (must reuse)

- `BinanceBookFeedAdapter` — `src/infrastructure/binance/binance-market-data-adapters.ts`
- WS client — `src/infrastructure/binance/ws-client.ts`
- Agg trades — `src/infrastructure/binance/agg-trades.ts` / adapter patterns in same folder
- `SignalEngine` — `src/application/services/signal-engine.ts` (`onTapeEvent` or actual API — **read file and match name**)
- Domain tape types — `src/domain/market-data/types.ts`

---

## 5. Type: `MarketDataReadModel`

**New file:** `src/runtime/worker/market-data-read-model.ts`

```typescript
export interface MarketDataReadModel {
  /** Monotonic ms of last successfully applied book delta/snapshot. */
  readonly lastBookApplyMonotonicMs: number | undefined;
  /** Best bid/ask mid if both sides valid; else undefined. */
  readonly lastMid: number | undefined;
  /** Spread in ticks using SymbolSpec.tickSize; undefined if touch incomplete. */
  readonly touchSpreadTicks: number | undefined;
  /** True after gap detection until fresh snapshot applied + policy clears. */
  readonly quotingPausedForBookResync: boolean;
}
```

Controller MUST update fields atomically from single-threaded callbacks (main thread).

---

## 6. Controller API

```typescript
export interface MarketDataController {
  start(): Promise<void>;
  stop(): Promise<void>;
  getReadModel(): MarketDataReadModel;
}
```

### 6.1 `start()` algorithm

1. Instantiate WS connections using `cfg.binance.wsBaseUrl` + symbol stream identifiers per existing helpers (no new host string literals outside `constants.ts`).

2. **Depth:** wire adapter callbacks:
   - On each applied update: set `lastBookApplyMonotonicMs = monotonicNowMs()`, compute touch, `touchSpreadTicks`, `lastMid`.
   - Build **`BookSnapshot`** per `src/domain/market-data/types.ts` (must include `spreadTicks` when known) and call **`signalEngine.onBookEvent(book)`** so `SignalEngine.getQuotingInputs()` / RV paths stay consistent.
   - On gap/resync signal from depth layer: set `quotingPausedForBookResync = true`; log `{ event: "marketdata.book_resync", symbol, reason }`.

3. On successful full resync / snapshot alignment: set `quotingPausedForBookResync = false`.

4. **Tape:** each normalized trade → `signalEngine.onTapeEvent(...)` (match method signature exactly).

5. Tape overflow: use `bounded-queue.ts`; on drop increment counter; log `warn` **rate-limited** max once/sec per symbol.

### 6.2 `stop()`

1. Unsubscribe / close WS **in reverse order** tape then depth or vice versa — document order to avoid dangling callbacks.

2. Clear internal timers.

3. Idempotent.

---

## 7. Integration with runner

**MainThreadSymbolRunner** (or coordinator):

- Holds `MarketDataController` per symbol **inside** the object created by `startSymbolRunner` — requires **map** `symbol → internals`.

**Problem:** Current `SymbolRunnerPort.startSymbolRunner` returns handle only — internal map MUST live inside `MainThreadSymbolRunnerPort` implementation class as **private `active = Map<string, RunnerInternals>`**.

**RunnerInternals:**

```typescript
interface RunnerInternals {
  controller: MarketDataController;
  interval: ReturnType<typeof setInterval> | undefined;
  halted: boolean;
  seq: number;
}
```

---

## 8. Logging contract

| `event` | Fields |
|---------|--------|
| `marketdata.book_resync` | `symbol`, `reason` (enum string) |
| `marketdata.tape_backlog` | `symbol`, `dropped` (optional) |

---

## 9. Test specification

| ID | Given | Then |
|----|-------|------|
| T01 | Mock WS sends fixture depth jsonl | read model touch matches golden |
| T02 | Gap injection fixture | `quotingPausedForBookResync` true then false after resync |
| T03 | Tape lines | `signalEngine` spy receives N calls |
| T04 | `stop()` | WS close spy called; no further callbacks |

---

## 10. Definition of Done

- [ ] Live testnet smoke documented (optional CI skip)
- [ ] No `binance` imports under `domain/`

---

## 11. Handoff to SPEC-05

Expose **`getQuotingSnapshot(symbol): QuotingSnapshot`** from runner internals:

```typescript
interface QuotingSnapshot {
  readonly touchSpreadTicks: number | undefined;
  readonly stalenessMs: number;
  readonly toxicity: /* type from SignalEngine snapshot */;
}
```

Implement `stalenessMs = monotonicNow - lastBookApply` or `Infinity` if undefined.
