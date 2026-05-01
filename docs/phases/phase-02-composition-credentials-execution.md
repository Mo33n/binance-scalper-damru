# Phase 02 — Composition: REST client, credentials, trading vs read-only

**Status:** Draft  
**Epic traceability:** Epic B (B1 REST, B2 fees path already in bootstrap), Epic E (E2 construction surface), Epic I (I1 env matrix, I1.2 secrets posture)  
**Prerequisites:** [Phase 01](./phase-01-async-entry-bootstrap.md) **Done**.

---

## 1. Objective

After bootstrap, construct **one shared** `BinanceRestClient` and, when allowed, **`ExecutionService` + `SignedCredentials`**. Make **read-only** vs **order-capable** mode **explicit** at startup. Resolve **`ExchangePort` vs `ExecutionService`** boundary with a written ADR in code comments. Gate **stub** exchange removal so tests and dry environments remain deterministic.

---

## 2. In scope / out of scope

### In scope

- Factory functions (e.g. `createVenueClients(bootstrap, cfg, log)`) returning immutable handles.
- Rules:
  - **Read-only mode:** missing `apiKey` **or** `apiSecret` **or** explicit dry flag → **no** `ExecutionService.placeFromIntent` calls allowed from orchestration (defensive guard throws if called).
  - **Trading-capable mode:** both secrets present **and** `features.liveQuotingEnabled === true` (new schema field—see tasks) **and** not `live` without extra ack flag (optional; if omitted, document “operator responsibility”).
- CLI: `--dry-run` (recommended) forces read-only even if keys exist.
- Document **`ExchangePort`** evolution: either extend interface for “venue health” only **or** deprecate stub for runtime—**decision recorded** in `exchange-port.ts` header + 5-line ADR in `docs/architecture/` optional (or comment-only if team avoids new doc).
- Update `createAppContext` / `runTrader` interaction so **stub** `ExchangePort` is not the **only** long-lived reference when trading mode is on (may keep stub for backward compat until Phase 05 replaces usage—document).

### Out of scope

- Implementing the full quote loop (Phase 05).
- listenKey / user stream (Phase 06).
- Schema for every Epic H flag—only add flags required here.

---

## 3. Dependencies & inputs

- From Phase 01: `TradingSessionBootstrap` (config + bootstrap + log).
- Existing: `BinanceRestClient`, `SignedCredentials` type from `signed-rest.ts`, `ExecutionService` constructor deps.

---

## 4. Work breakdown (concrete tasks)

### 4.1 Config schema

1. Extend `src/config/schema.ts` `featuresSchema` with **`liveQuotingEnabled: z.boolean().default(false)`** (name per plan; aligns with parent doc).
2. Merge defaults in `load.ts` / schema defaults; bump `configSchemaVersion` **only** if you treat this as breaking—**prefer** additive boolean with default `false` **without** version bump if policy allows.
3. Update **all** `config/examples/*.json` to include the new key explicitly (or rely on default—**explicit preferred** for reviewer visibility).
4. Update [config/README.md](../../config/README.md): meaning of `liveQuotingEnabled`, ownership, safe defaults for `live` vs `testnet`.

### 4.2 CLI

5. Parse `--dry-run` in argv; thread boolean into `runTrader` / session factory.
6. `--help` documents `--dry-run` and `liveQuotingEnabled`.

### 4.3 Factory module

7. Add `src/bootstrap/venue-factory.ts` (name flexible) exporting e.g.:
   - `createSharedRestClient(cfg, log)`
   - `createExecutionIfAllowed(cfg, client, argvDryRun): ExecutionService | undefined`
   - `describeTradingMode(...): { mode: "read_only" | "order_capable"; reasons: string[] }`
8. Log **one** structured line at startup: `event: "trading.mode"` with `{ mode, reasons }` — reasons must be **enum-like** strings, not free text that could leak paths.

### 4.4 Stub / ExchangePort

9. Add ADR block at top of `src/application/ports/exchange-port.ts`: **Execution stays in `ExecutionService`**; `ExchangePort` reserved for future “health/ping” or simulator swap—**or** extend `ExchangePort` with minimal methods—**pick one** and list **call sites** expected through Phase 05.
10. If stub remains: `createStubExchangeAdapter` only used when `mode === read_only` **or** tests; assert via log or debug-only invariant (avoid production `console.assert` spam).

### 4.5 Integration point

11. Invoke factory from `runTrader` immediately after bootstrap success.
12. Pass factory outputs into session object used by Phase 03 (`TradingSession` type extension).

### 4.6 Tests

13. Unit: dry-run + keys present → `ExecutionService` undefined.
14. Unit: `liveQuotingEnabled: false` + keys → undefined.
15. Unit: keys + `liveQuotingEnabled: true` + not dry-run → defined.
16. Unit: invalid credential combination logs `trading.mode` with `read_only`.

### 4.7 Security review checklist (self)

17. Confirm `verify:secrets` still passes; if new env keys introduced, update `verify-secrets.mjs` patterns if needed.

---

## 5. Artifacts & file touches

| Path | Change |
|------|--------|
| `src/config/schema.ts` | `liveQuotingEnabled` |
| `src/config/load.ts` | Defaults merge if needed |
| `config/examples/*.json` | Explicit feature keys |
| `config/README.md` | Governance |
| `src/bootstrap/venue-factory.ts` | **New** |
| `src/bootstrap/run-trader.ts` | Integrate factory |
| `src/main.ts` | Help text |
| `src/application/ports/exchange-port.ts` | ADR comment |
| `test/unit/bootstrap/venue-factory.test.ts` | **New** |

---

## 6. Acceptance criteria

- [ ] Default example configs **do not** enable live quoting without operator edit.
- [ ] Dry-run cannot place orders even with keys + flag (defensive layer in factory **and** orchestration guard).
- [ ] Startup log clearly states mode in one JSON line.
- [ ] Full CI green.

---

## 7. Definition of Done (complete)

1. **Schema:** `liveQuotingEnabled` present, defaulted, documented, in examples.
2. **CLI:** `--dry-run` parsed, tested, documented.
3. **Factory:** Single code path constructs REST client + optional `ExecutionService`; no duplicate `BinanceRestClient` per symbol yet (shared instance OK).
4. **ExchangePort decision** documented in-repo (comment or `docs/architecture/exchange-port-adr.md` if created).
5. **No order side effects** in Phase 02 PR itself—only construction + guards unless a minimal “ping” is required (then add test).
6. **Logs:** stable `event` names; no secrets.
7. **Tests:** minimum four cases listed in §4.6.
8. **Handoff:** Extended session type available for Phase 03 import without circular deps.

---

## 8. Test plan

| Case | Expected |
|------|----------|
| A | No keys → read_only |
| B | Keys + dry-run → read_only |
| C | Keys + `liveQuotingEnabled: false` → read_only |
| D | Keys + flag true + no dry-run → order_capable |

---

## 9. Manual smoke

1. Keys in env + `liveQuotingEnabled: false` → log shows read_only.
2. Add `--dry-run` with flag true → still read_only.
3. Flip flag true, remove dry-run → order_capable (no orders sent yet).

---

## 10. Non-functional

- **Fail-fast:** Contradictory env (e.g. live URLs + testnet label) still caught by existing allowlist—no regression.
- **Performance:** Single REST client reuse; connection pooling not required yet.

---

## 11. Risks

| Risk | Mitigation |
|------|------------|
| Operator enables quoting by mistake | Default false + explicit JSON edit |
| ExchangePort confusion | ADR + single execution gateway |

---

## 12. Handoff to Phase 03

Phase 03 needs: shared `BinanceRestClient`, optional `ExecutionService`, `describeTradingMode` result on session, `SymbolSpec` list from bootstrap.

---

## 13. Open questions

- Live environment **extra** ack flag (e.g. `features.liveAcknowledged`) — add in Phase 02 or 10? If skipped, document operator risk in README.
