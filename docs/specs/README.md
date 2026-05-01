# Technical specifications — implementation index

These documents are **engineering specs**: stable names, types, behaviors, and tests so implementation can proceed **without reinterpretation**. They **derive from** [docs/phases/](../phases/README.md) and match the current repo layout (`src/**`, `test/**`).

## Reading order (matches coding order)

| Spec | Phase | Document |
|------|------:|----------|
| SPEC-01 | 01 | [spec-phase-01-async-bootstrap.md](./spec-phase-01-async-bootstrap.md) |
| SPEC-02 | 02 | [spec-phase-02-venue-session.md](./spec-phase-02-venue-session.md) |
| SPEC-03 | 03 | [spec-phase-03-main-thread-runner.md](./spec-phase-03-main-thread-runner.md) |
| SPEC-04 | 04 | [spec-phase-04-market-data.md](./spec-phase-04-market-data.md) |
| SPEC-05 | 05 | [spec-phase-05-quoting-execution.md](./spec-phase-05-quoting-execution.md) |
| SPEC-06 | 06 | [spec-phase-06-user-stream-ledger.md](./spec-phase-06-user-stream-ledger.md) |
| SPEC-07 | 07 | [spec-phase-07-supervisor-runtime.md](./spec-phase-07-supervisor-runtime.md) |
| SPEC-08 | 08 | [spec-phase-08-worker-threads.md](./spec-phase-08-worker-threads.md) |
| SPEC-09 | 09 | [spec-phase-09-hardening-wiring.md](./spec-phase-09-hardening-wiring.md) |
| SPEC-10 | 10 | [spec-phase-10-rollout-artifacts.md](./spec-phase-10-rollout-artifacts.md) |

## Spec conventions (all files)

- **Normative:** “MUST / MUST NOT / SHOULD” mean RFC-style requirement levels.
- **Types:** TypeScript fragments are **prescriptive** unless marked *illustrative*.
- **Paths:** All paths repo-relative from workspace root.
- **Tests:** Each spec ends with **Test specification** tables — implement as Vitest cases.
- **Events:** Structured logs use `{ event: string, ...fields }` per existing Pino usage.

## Links

- Phase narratives: [docs/phases/](../phases/)
- Executive plan: [docs/implementation-plan-remaining-work.md](../implementation-plan-remaining-work.md)
