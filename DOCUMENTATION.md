# Documentation

**Developer workflow:** [DEVELOPERS.md](DEVELOPERS.md) — run, test, lint, and navigate the codebase.

**Configuration:** [config/README.md](config/README.md) — merge order, schema fields, rollout and risk knobs.

**Layering:** Hexagonal boundaries for `src/domain/**` and `src/application/ports/**` are enforced by ESLint; see messages in [eslint.config.js](eslint.config.js) when imports violate those rules.

**Workers / runtime:** [src/runtime/worker/README.md](src/runtime/worker/README.md) — per-symbol worker model.

**Apps layout (future):** [apps/README.md](apps/README.md) — reserved workspace shape.

**Remaining work (runnable bot):** [docs/implementation-plan-remaining-work.md](docs/implementation-plan-remaining-work.md) — executive plan and architecture diagram.

**Phase task packs (concrete WBS + DoD):** [docs/phases/README.md](docs/phases/README.md) — Phases 01–10, one file per phase.

**Technical specs (for coding):** [docs/specs/README.md](docs/specs/README.md) — SPEC-01–10: APIs, types, algorithms, test tables.

**Operator runbook:** [docs/operator/running-the-trader-and-parameters.md](docs/operator/running-the-trader-and-parameters.md) — commands, modes, and trading-focused parameter meanings.

**Rollout & safety (SPEC-10):** [docs/rollout/promotion-checklist.md](docs/rollout/promotion-checklist.md), [docs/rollout/testnet-limitations.md](docs/rollout/testnet-limitations.md), [docs/rollout/emergency-stop.md](docs/rollout/emergency-stop.md), [docs/architecture/feature-flags.md](docs/architecture/feature-flags.md).
