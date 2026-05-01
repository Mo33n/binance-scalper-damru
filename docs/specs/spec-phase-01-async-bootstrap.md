# SPEC-01 — Async process entry and exchange bootstrap (technical)

**Phase:** 01  
**Prerequisites:** None.

---

## 1. Purpose

Move network **exchange bootstrap** onto the application hot path after config load, with a **single async orchestration** function and **deterministic** exit when no tradable symbols exist.

---

## 2. Non-goals (this spec)

- WebSocket clients, order placement, supervisor (later specs).
- Changing `bootstrapExchangeContext` business rules inside `bootstrap-exchange.ts` except bugfixes filed separately.

---

## 3. Module map

| Action | Path |
|--------|------|
| Create | `src/bootstrap/run-trader.ts` |
| Create | `src/bootstrap/trading-session-types.ts` |
| Modify | `src/main.ts` |
| Create | `test/unit/bootstrap/run-trader.test.ts` |
| Modify | `DEVELOPERS.md`, `README.md` (bootstrap requires network) |

---

## 4. Data model

### 4.1 `TradingSessionBootstrap`

**File:** `src/bootstrap/trading-session-types.ts`

```typescript
import type { AppConfig } from "../config/schema.js";
import type { LoggerPort } from "../application/ports/logger-port.js";
import type { ClockPort } from "../application/ports/clock-port.js";
import type { BootstrapExchangeContext } from "../application/services/bootstrap-exchange.js";

/** Immutable snapshot after config load + exchange bootstrap (SPEC-01). */
export interface TradingSessionBootstrap {
  readonly config: AppConfig;
  readonly bootstrap: BootstrapExchangeContext;
  readonly log: LoggerPort;
  readonly clock: ClockPort;
}
```

**Rules:**

- `bootstrap.symbols` MUST be the **accepted-only** list returned by `bootstrapExchangeContext` (see §6.1 for filtering policy if upstream returns mixed).

### 4.2 Re-export check

If `BootstrapExchangeContext` is not exported from `bootstrap-exchange.ts` today, export it (type-only re-export acceptable).

---

## 5. Public API

### 5.1 `runTrader`

**File:** `src/bootstrap/run-trader.ts`

```typescript
export async function runTrader(argv: readonly string[]): Promise<void>;
```

**Behavior (normative):**

1. If `argv` contains `--help` or `-h`: MUST return immediately **without** calling `fetch`, `bootstrapExchangeContext`, or `loadAppConfig` network paths. (Help text remains in `main.ts` OR moved here — **single source**; if moved, `main` only delegates.)

2. Otherwise:
   - Build `AppContext`-equivalent services **without** double-loading config:
     - **Option A (preferred):** Call existing `createAppContext()` once; use `ctx.config`, `ctx.log`, `ctx.clock`.
     - **Option B:** Call `loadAppConfig()` + logger factory separately; MUST NOT diverge from `createAppContext` defaults — document choice in PR.
   - Emit same startup logs as today via `logStartupConfig(ctx.log, ctx.config)` **before** network bootstrap OR **after** config load only — MUST NOT duplicate `config.loaded` lines; pick **one** ordering and document in code comment.

3. `const bootstrap = await bootstrapExchangeContext(ctx.config, ctx.log)`.

4. **Accepted symbols filter:**  
   `const accepted = bootstrap.symbols` **if** `bootstrapExchangeContext` already filters to accepted-only; **else** compute  
   `accepted = bootstrap.symbols.filter((s) => decisionFor(s)?.status === "accepted")`  
   using `bootstrap.decisions` — implement **`selectAcceptedSymbols(bootstrap): SymbolSpec[]`** in `src/bootstrap/select-accepted-symbols.ts` if needed.

5. If `accepted.length === 0`:
   - `ctx.log.error({ event: "bootstrap.no_tradable_symbols", rejectedCount: bootstrap.decisions.filter(d => d.status === "rejected").length }, "...")`
   - Set `process.exitCode = 1`
   - `return` (do not throw unless team standardizes on throw — **prefer exitCode + return** for clean stderr control).

6. Construct `TradingSessionBootstrap` with **accepted-only** symbols substituted:
   - Either **mutate** frozen copy:  
     `const narrowed = { ...bootstrap, symbols: accepted } satisfies BootstrapExchangeContext`  
     (if type allows readonly array replacement).

7. Call placeholder **`await continueTradingSession(session)`** defined in same file as **no-op** resolving immediately, logging  
   `{ event: "trading.session.bootstrap_complete", symbolCount: accepted.length }`.

8. **Stay-alive:** If `shouldAttachDevKeepAlive(argv)` from `runtime/dev-keep-alive.ts` is true, MUST call `attachDevKeepAlive(session.log, session.config)` **after** step 6 success **only** (not on `--help`, not when exitCode set).

### 5.2 `main.ts` integration

**Normative:**

```typescript
void runTrader(process.argv).catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`${STARTUP_EVENTS.failed}: ${msg}`);
  process.exitCode = 1;
});
```

- MUST NOT leave unhandled promise rejections from `runTrader`.
- Sync `main()` MAY remain export for tests; document that production entry uses async path.

---

## 6. Logging contract (new / stable events)

| `event` | Level | Required fields |
|---------|-------|-----------------|
| `bootstrap.no_tradable_symbols` | error | `rejectedCount` (number) |
| `trading.session.bootstrap_complete` | info | `symbolCount` (number) |

Existing bootstrap events from `bootstrap-exchange.ts` MUST remain unchanged.

---

## 7. Error handling

| Condition | Action |
|-----------|--------|
| `bootstrapExchangeContext` throws | Catch at `runTrader` boundary → log `startup.failed` + message → `exitCode = 1` |
| Non-Error throw | Stringify |

Secrets MUST NOT appear in error strings (rely on upstream).

---

## 8. Test specification

| ID | Given | When | Then |
|----|-------|------|------|
| T01 | argv `--help` | `runTrader(argv)` | No global `fetch` spy calls |
| T02 | mocked `fetch` returns valid exchangeInfo fixture + symbols match | `runTrader` | `bootstrap_complete` log / or spy on `continueTradingSession` |
| T03 | mocked bootstrap yields zero accepted | `runTrader` | `process.exitCode === 1` (restore env after test) |
| T04 | `runTrader` rejects | `.catch` path | `exitCode` set (if testing via exported harness, assert rejection mapped) |

**Implementation note:** Use `vi.stubGlobal("fetch", ...)` and restore in `afterEach`.

---

## 9. Definition of Done (machine-checkable)

- [ ] `npm run typecheck && npm run lint && npm test && npm run build`
- [ ] `node dist/main.js --help` → exit 0, zero fetch
- [ ] Production path performs `await bootstrapExchangeContext` exactly once per invocation

---

## 10. Handoff to SPEC-02

`TradingSessionBootstrap` MUST be importable by venue factory without circular imports (`venue-factory` imports `trading-session-types`, not `run-trader` calling factory in reverse during module init).
