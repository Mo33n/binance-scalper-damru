# Implementation phases — index

Principal-engineering task packs for the **remaining vertical integration** (see parent [implementation-plan-remaining-work.md](../implementation-plan-remaining-work.md)). Each phase file is **self-contained**: concrete tasks, acceptance checks, exhaustive **Definition of Done**, tests, smoke, risks, and handoff.

## Execution order (strict)

| Order | Document | Title |
|------:|----------|--------|
| 1 | [phase-01-async-entry-bootstrap.md](./phase-01-async-entry-bootstrap.md) | Async entry + exchange bootstrap on hot path |
| 2 | [phase-02-composition-credentials-execution.md](./phase-02-composition-credentials-execution.md) | Composition: REST, credentials, trading vs read-only mode |
| 3 | [phase-03-symbol-runner-main-thread.md](./phase-03-symbol-runner-main-thread.md) | `SymbolRunnerPort` v0 (main-thread) |
| 4 | [phase-04-market-data-runner.md](./phase-04-market-data-runner.md) | Book + tape inside runner |
| 5 | [phase-05-signal-quote-execution-loop.md](./phase-05-signal-quote-execution-loop.md) | Signal → hybrid quote → REST + reprice |
| 6 | [phase-06-user-stream-ledger-reconciliation.md](./phase-06-user-stream-ledger-reconciliation.md) | User stream, ledger, reconciliation, limits |
| 7 | [phase-07-supervisor-integration.md](./phase-07-supervisor-integration.md) | Supervisor, heartbeat, cancel-all, halt |
| 8 | [phase-08-worker-isolation.md](./phase-08-worker-isolation.md) | `worker_threads` / IPC worker entry |
| 9 | [phase-09-hardening-integration.md](./phase-09-hardening-integration.md) | Epic H selective wiring |
| 10 | [phase-10-epic-i-rollout-docs.md](./phase-10-epic-i-rollout-docs.md) | Epic I operator docs + promotion |

**Rule:** do not start phase *N+1* until phase *N* meets its **Definition of Done** and merges.

---

## Global conventions (all phases)

- **Language / style:** TypeScript strict; no new `any`; match existing import style (`.js` suffix in ESM).
- **Architecture:** `src/domain/**` and `src/application/ports/**` remain free of `infrastructure` imports; ESLint must stay green.
- **Secrets:** Never log API keys, secrets, or signed query strings; extend redaction tests if new log fields touch auth.
- **CI gate:** `npm run typecheck && npm run lint && npm test && npm run build` on every PR.
- **Network:** Default unit/integration tests **offline**; live/testnet only behind explicit env flags or manual smoke.
- **Logging:** New lifecycle events use structured `event` keys and stable string `msg`; include `symbol` where applicable.
- **Config:** Any new flag goes through `src/config/schema.ts` + `load.ts` merge + `config/examples/*.json` + [config/README.md](../../config/README.md).

---

## Global Definition of Done — MVP runnable bot (cross-phase)

When **Phases 1–7** (and required parts of **6**) are complete per their phase DoDs, the following **system** properties must hold:

1. **Process:** Starting the app with valid config keeps Node alive with a **non-trivial event loop** (WS timers, reprice, reconciliation), not only `dev-keep-alive` pulses unless that mode is explicitly selected.
2. **Bootstrap:** `bootstrapExchangeContext` runs at startup; **all** operator symbols receive a logged **accepted** or **rejected** decision; **zero** accepted symbols → **non-zero exit** with actionable stderr/log.
3. **Market data:** For each accepted symbol, **depth + aggTrade** subscriptions are established against `cfg.binance.wsBaseUrl`; disconnect/reconnect does not corrupt silent state (gap/resync policy active).
4. **Signals:** Tape path updates VPIN/toxicity state used by quoting decisions.
5. **Quoting & orders:** Hybrid quoting produces `QuoteIntent`; `ExecutionService` sends **POST_ONLY** orders when **trading mode + feature flags** allow; reprice path **cancels or replaces** stale working orders per policy.
6. **User stream:** listenKey lifecycle runs; fills update internal ledger with **dedupe**; position/notional limits **block** risk-increasing sends when breached.
7. **Supervision:** Supervisor receives per-symbol heartbeats; **missed heartbeats beyond threshold** trigger **cancel-all** for that symbol (verified in test with mock execution).
8. **Shutdown:** SIGINT/SIGTERM stops feeds, cancels open orders per policy, awaits runner stop, exits with defined code.
9. **Quality:** No regression in existing tests; new tests cover new branches; smoke doc updated.

**Phases 8–10** move from **MVP runnable** toward **RFC-scale isolation, hardening, and operator rollout** — see each phase DoD.

---

## Traceability (phases → epics)

| Phases | Epics (from `development_document/docs/tasks/epics/`) |
|--------|----------------------------------------------------------|
| 1 | A, B (bootstrap entry) |
| 2 | B, E, I |
| 3–4 | C, G (runner lifecycle) |
| 5 | D, E |
| 6 | E, F, H |
| 7 | G, F, H |
| 8 | G, H |
| 9 | H |
| 10 | I |

---

## PR naming (suggested)

`feat(phase-01): async runTrader + bootstrap` — increment phase number per merge.

---

## Technical specifications (coding)

Implementation-ready specs: **[docs/specs/README.md](../specs/README.md)** — SPEC-01 … SPEC-10 (types, APIs, algorithms, test tables).

---

## Maintenance

- Mark phase files with a **“Status”** line at top (`Draft | In progress | Done`) when your team tracks execution.
- Keep epic source documents authoritative for **business rules**; these phase files are authoritative for **delivery sequencing and engineering DoD**.
