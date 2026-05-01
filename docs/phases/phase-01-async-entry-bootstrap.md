# Phase 01 — Async process entry + exchange bootstrap on hot path

**Status:** Draft  
**Epic traceability:** Epic A (A2 runtime load, A3 logging), Epic B (B1–B4 bootstrap pipeline as **invoked** behavior)  
**Prerequisites:** None (baseline repo as of parent plan).

---

## 1. Objective

Make the **real** `bootstrapExchangeContext(cfg, log)` the **first authoritative exchange truth** after config load: async-capable entry, deterministic failure modes, structured logs for every symbol decision, and a **typed handoff object** for later phases—without yet starting WebSockets or placing orders.

---

## 2. In scope / out of scope

### In scope

- Top-level **async** orchestration function invoked from `src/main.ts` (e.g. `runTrader(argv): Promise<void>`).
- **Await** `bootstrapExchangeContext` with production `AppConfig` + `LoggerPort`.
- **Fail-fast** when zero symbols accepted after bootstrap (non-zero exit, single root error message + structured log).
- **Thread** `BootstrapExchangeContext` (symbols, fees, decisions) into a **narrow factory interface** used by later phases (may be stub implementation returning “no runners” in this phase only).
- Preserve **`--help`**, **`--stay-alive`** behavior; document interaction (bootstrap may still run before stay-alive attach, or stay-alive only after successful bootstrap—**pick one**, document in phase DoD).
- Top-level **try/catch** in entry: map unknown errors to `startup.failed` + `process.exitCode = 1` without leaking secrets.

### Out of scope

- WebSocket connect, `SignalEngine` wiring, `ExecutionService` calls (Phase 04+).
- Changing Binance parser math inside `exchange-info.ts` / `spread-gate.ts` unless a bug is discovered (fix in separate bugfix PR).
- `worker_threads` / supervisor loop (Phase 07–08).

---

## 3. Dependencies & inputs

- **Modules:** `loadAppConfig` / `loadConfig`, `createPinoLogger` + `toLoggerPort`, `bootstrapExchangeContext`, `STARTUP_EVENTS`.
- **Env:** `CONFIG_PATH`, `TRADING_ENV`, optional `BINANCE_*` overrides per [config/README.md](../../config/README.md).
- **Credentials:** Bootstrap already supports missing keys (synthetic fees path); Phase 01 must **not** assume keys exist.

---

## 4. Work breakdown (concrete tasks)

### 4.1 Module layout

1. Add `src/bootstrap/run-trader.ts` (or `src/runtime/run-trader.ts`—**choose one namespace**, document in file header).
2. Export `runTrader(argv: readonly string[]): Promise<void>` as the **single async orchestration** entry.
3. Keep `src/main.ts` minimal:
   - Parse argv for `--help` (sync early return unchanged).
   - `void runTrader(process.argv).catch(...)` or `await` inside async IIFE if the runtime policy requires unhandled rejection safety—**must** attach rejection handler so unhandled rejections never drop silently.

### 4.2 Bootstrap invocation

4. Inside `runTrader`, after `createAppContext()` **or** refactor so logger + config come from one place:
   - **Preferred:** `runTrader` calls `loadAppConfig()` (or uses `createAppContext` only for logger/clock if you dedupe config load—**avoid double `loadConfig`**; document chosen approach).
5. Call `await bootstrapExchangeContext(cfg, log)`.
6. If `result.symbols.length === 0`: log `event: "bootstrap.no_tradable_symbols"` with summary of `decisions`; `process.exitCode = 1`; return **without** throwing unless you standardize on throw (pick one pattern).

### 4.3 Handoff for downstream phases

7. Define a **narrow type** e.g. `TradingSessionBootstrap` in `src/bootstrap/types.ts` (name flexible) containing:
   - `readonly config: AppConfig`
   - `readonly bootstrap: BootstrapExchangeContext`
   - `readonly log: LoggerPort` (+ `clock` if needed later)
8. Pass `TradingSessionBootstrap` into `createPhasePlaceholder(b)` that currently logs `event: "trading.session.ready"` and resolves—**no** WS.

### 4.4 CLI / stay-alive interaction

9. Document and implement **one** policy:
   - **Option A (recommended):** Run bootstrap first; on success, if `--stay-alive` / `DAMRU_STAY_ALIVE`, attach keep-alive **after** bootstrap.
   - **Option B:** Stay-alive even on bootstrap failure for debugging—only if explicitly desired (generally **not** for production clarity).
10. Ensure `--help` **never** calls network (no bootstrap).

### 4.5 Logging & events

11. Add structured events if missing:
    - `bootstrap.exchange.completed` with counts `{ accepted, rejected }` (no PII).
12. Ensure bootstrap warnings for rejected symbols remain at `warn` level with stable `event` keys.

### 4.6 Tests

13. Unit test: mock `fetch` (or inject a test double **if** you introduce an injectable `HttpClient`—**prefer** mocking global `fetch` in Vitest for minimal intrusion) so `runTrader` receives a synthetic `exchangeInfo` fixture and produces **non-zero** accepted symbols OR zero with exit code path.
14. Unit test: `runTrader` with `--help` does **not** invoke bootstrap (spy).
15. If async entry uses dynamic import to avoid circular deps, document why.

### 4.7 Documentation

16. Update [DEVELOPERS.md](../../DEVELOPERS.md) “Run the app”: bootstrap runs automatically when not `--help`; mention network requirement when symbols need live `exchangeInfo`.
17. Update [README.md](../../README.md) one paragraph if behavior changes from “config only” to “network at startup”.

---

## 5. Artifacts & expected file touches

| Path | Change |
|------|--------|
| `src/bootstrap/run-trader.ts` | **New** — async orchestration |
| `src/bootstrap/trading-session-types.ts` | **New** (optional) — handoff types |
| `src/main.ts` | Wire `runTrader`; rejection handling |
| `test/unit/bootstrap/run-trader.test.ts` | **New** — mocks + help path |
| `DEVELOPERS.md`, `README.md` | Small updates |

---

## 6. Acceptance criteria (must all pass)

- [ ] `npm run typecheck && npm run lint && npm test && npm run build` succeed.
- [ ] `node dist/main.js --help` exits **0** and performs **no** `fetch` to Binance.
- [ ] With `CONFIG_PATH` valid and network available (or mocked in CI), process reaches `bootstrap.ready` equivalent **after** bootstrap completes (you may rename events but must remain grep-friendly).
- [ ] With **all symbols rejected** (fixture or config pointing to invalid list in test), process exits **non-zero** with clear message.
- [ ] No **double** config load unless documented and tested for equality.
- [ ] Unhandled promise rejection: **none** from `runTrader` path in normal Vitest + smoke.

---

## 7. Definition of Done (complete)

### 7.1 Code completeness

1. Async orchestration module exists, is imported only from entry (and tests).
2. `bootstrapExchangeContext` is **the** exchange bootstrap used on startup path (not dead code).
3. Zero-accepted-symbols path is **deterministic** and **test-covered**.
4. Help path bypasses network **verified** by test.
5. Stay-alive / dev flags behave per documented policy **without** orphan timers on early exit.

### 7.2 Quality & safety

6. No secrets in new log fields.
7. No new ESLint violations; no forbidden `domain` → `infrastructure` imports.
8. Error messages for bootstrap failures include **actionable** context (symbol list file path, HTTP status if REST error) without printing secrets.

### 7.3 Tests & CI

9. At least **two** new tests: (a) help no-network, (b) bootstrap outcome drives exit / event.
10. CI runtime remains acceptable (<2× prior median unless justified).

### 7.4 Documentation & operability

11. DEVELOPERS + README updated for “bootstrap hits network.”
12. This phase file’s **Status** can move to `Done` in git when merged.

### 7.5 Handoff readiness

13. `TradingSessionBootstrap` (or equivalent) is **stable enough** that Phase 02 can import it without rename churn—reviewer sign-off on type names.

---

## 8. Test plan (detailed)

| Layer | Cases |
|-------|--------|
| Unit | Help bypass; zero symbols; ≥1 symbol; REST throw mapping to exit code |
| Integration | Optional: start with `CONFIG_PATH=config/examples/minimal.json` + mocked fetch (if minimal symbols not on testnet—align fixture to test intent) |
| Manual | `CONFIG_PATH=config/examples/testnet.json TRADING_ENV=testnet npm run dev` shows bootstrap logs when network OK |

---

## 9. Manual smoke procedure

1. Disconnect network → run dev → expect **clear** bootstrap failure (timeout / DNS) and non-zero exit.
2. Reconnect → run dev → expect accepted symbol count > 0 for default example config.
3. `npm run dev -- --help` → no outbound Binance (watch with proxy/tcpdump if org requires).

---

## 10. Non-functional requirements

- **Startup latency:** Document expected extra latency vs old “config-only” boot (one `exchangeInfo` round-trip minimum).
- **Observability:** New events discoverable via `event` field in log JSON.
- **Idempotency:** Running twice in a row does not leak handles (timers, sockets) in Phase 01 code paths.

---

## 11. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Double config load drift | Single `loadAppConfig` in `runTrader`; pass into context factory |
| CI flakiness from network | Mock `fetch` in tests; document optional network job separately |
| Unhandled rejections | Explicit `.catch` on root promise |

---

## 12. Handoff to Phase 02

Phase 02 expects:

- `TradingSessionBootstrap` (or agreed name) with `config`, `bootstrap`, `log`.
- Clear pattern for **read-only vs trading** to be added **without** renaming this type again.

---

## 13. Open questions (resolve before merge)

- Should `createAppContext` remain the **only** logger factory, or should `runTrader` own logger creation to avoid stub exchange in composition? **Decision:** record in PR description (affects Phase 02).
