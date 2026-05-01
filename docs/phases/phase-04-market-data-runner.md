# Phase 04 — Market data wiring inside runner (book + tape)

**Status:** Draft  
**Epic traceability:** Epic C (C1 depth sync, C2 tape, C3 ports + adapters + lifecycle)  
**Prerequisites:** [Phase 03](./phase-03-symbol-runner-main-thread.md) **Done**.

---

## 1. Objective

Inside each `MainThreadSymbolRunner`, establish **live** `BookFeed` + **tape** subscriptions using existing `BinanceBookFeedAdapter` and the agg-trade path, with **staleness**, **gap/resync** behavior, and **typed errors** surfaced to the logger. Feed **tape events** into `SignalEngine.onTapeEvent`. Prepare **read models** (best bid/ask, touch spread ticks) for Phase 05.

---

## 2. In scope / out of scope

### In scope

- Construct `BinanceWsClient` (or existing WS wrapper) per symbol per epic C1.1 patterns in repo.
- Wire **depth** stream: snapshot + diffs per `depth-order-book.ts` rules already implemented—**invoke** from runner `start`.
- Wire **agg trades** stream: subscribe, push into bounded queue / handler → `TapeTrade` domain events → `SignalEngine`.
- Expose on runner:
  - `getLatestTouchSpreadTicks(): number | undefined` (or return full snapshot DTO)
  - `getBookStalenessMs(): number` using monotonic clock per Epic C1.4
- On **gap / hard reset** path from depth module:
  - Set internal `quotingPausedUntilFresh: boolean` or callback to Phase 05 interface.
  - Emit `event: "marketdata.book_resync"` with `{ symbol, reason }`.
- `stop()`: **close** WS connections, await close events, clear queues, remove handlers (no leaks).

### Out of scope

- Placing orders (Phase 05).
- User private stream (Phase 06).
- Cross-symbol shared WS multiplex (future optimization).

---

## 3. Dependencies & inputs

- `cfg.binance.wsBaseUrl`, `SymbolSpec` (tick size, symbol string).
- `SignalEngine` reference from runner.
- Logger child with `symbol`.

---

## 4. Work breakdown (concrete tasks)

### 4.1 Adapter construction

1. Factory `createMarketDataForSymbol(spec, cfg, log, signalEngine)` returning `{ bookFeed, tapeFeed, dispose }` or similar.
2. Ensure stream **names** / URLs match Binance USD-M futures testnet vs live (reuse constants / builder—no duplicated host strings outside `constants.ts`).

### 4.2 Book path

3. On `start`, initiate REST depth snapshot + WS depth per existing adapter design—**call existing functions**; fix any “export but unused” gaps.
4. Subscribe to book updates: update **local** read model for touch + staleness timestamp (`lastBookApplyMonotonicMs`).
5. Wire **gap** handler: set pause flag; call `signalEngine` reset API if exists or add `resetStaleSignalState()` if required by VPIN policy—**document**.

### 4.3 Tape path

6. Subscribe agg trades; parse to domain `TapeTrade` (existing types); call `signalEngine.onTapeEvent(evt)` for each **deduped** event if stream can duplicate—document Binance guarantees.
7. Bounded queue: use `bounded-queue.ts`; on overflow policy, increment counter and `warn` with rate limit (log once per second max).

### 4.4 Staleness

8. Implement `getBookStalenessMs()` using `monotonicNowMs() - lastBookApplyMonotonicMs`.
9. If no book yet, return `Infinity` or `undefined`—**document** semantics for Phase 05 “do not quote”.

### 4.5 Tests

10. Adapter tests already exist—add **runner-level** integration test with **mock WS** server emitting fixture `jsonl` lines (reuse `test/fixtures/ws-depth`, `ws-tape`).
11. Test: `stop()` leaves no open listeners (use `mockWs` close spy).

### 4.6 Documentation

12. Add `docs/architecture/market-data-lifecycle.md` **or** expand `src/infrastructure/binance/README.md` with “Runner wiring” section—**one** place only.

---

## 5. Artifacts

| Path | Change |
|------|--------|
| `src/runtime/worker/main-thread-symbol-runner.ts` | WS start/stop |
| `src/runtime/worker/market-data-bundle.ts` | **New** optional |
| `test/integration/market-data-runner.test.ts` | **New** (mock WS) |

---

## 6. Acceptance criteria

- [ ] With testnet + network, runner logs first top-of-book within bounded time (document SLA as “best effort” e.g. 30s).
- [ ] Tape events increase VPIN bucket state (assert via `SignalEngine` snapshot getter in test).
- [ ] Gap fixture triggers resync event exactly once in test harness.
- [ ] `stop()` closes WS (verified by mock).
- [ ] CI offline tests pass.

---

## 7. Definition of Done (complete)

1. **Functional:** Both streams subscribed for each running symbol; errors typed and logged.
2. **Signal:** `SignalEngine` receives tape events in order preserved by queue policy.
3. **Staleness:** Observable numeric API on runner for Phase 05.
4. **Pause:** Resync sets quoting pause flag until fresh book snapshot applied—**test proves** un-pause.
5. **Resource safety:** No event listener leaks after `stop()` in stress test (≥100 start/stop cycles optional).
6. **Docs:** Single architecture note for lifecycle + pause semantics.
7. **Observability:** `marketdata.*` events stable and grep-friendly.
8. **Security:** WS URLs logged at `debug` only if at all (avoid noise); never log listenKey here (N/A).

---

## 8. Test plan

| Layer | Coverage |
|-------|----------|
| Unit | Staleness math, pause flag transitions |
| Integration | Mock WS driving book+tape through runner |
| Manual | Testnet single symbol, verify logs + order book UI |

---

## 9. Manual smoke

1. `TRADING_ENV=testnet` + valid symbol → depth connection success log.
2. Disconnect Wi-Fi mid-run → reconnect behavior logs reason (per adapter).
3. Ctrl+C / stop path → no process hang.

---

## 10. Non-functional

- **Backpressure:** queue drops documented; supervisor metric hook optional stub for Phase 07.
- **Rate of logs:** backoff on reconnect spam.

---

## 11. Risks

| Risk | Mitigation |
|------|------------|
| Subtle diff bugs | Rely on existing tests; add runner transcript test |
| Test flakiness | No live network in CI |

---

## 12. Handoff to Phase 05

Expose **single** read API: `getQuotingSnapshot(): { touchSpreadTicks, stalenessMs, toxicity, regime flags... }` consolidating book + signal—implement in Phase 05 start or end of Phase 04 as thin delegator.

---

## 13. Open questions

- Whether VPIN state resets on book-only resync—align with RFC §6.3 team interpretation; document in code.
