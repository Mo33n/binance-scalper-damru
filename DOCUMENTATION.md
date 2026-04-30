# Documentation

**Developer workflow:** [DEVELOPERS.md](DEVELOPERS.md) — run, test, lint, and navigate the codebase.

**Configuration:** [config/README.md](config/README.md) — merge order, schema fields, rollout and risk knobs.

**Layering:** Hexagonal boundaries for `src/domain/**` and `src/application/ports/**` are enforced by ESLint; see messages in [eslint.config.js](eslint.config.js) when imports violate those rules.

**Workers / runtime:** [src/runtime/worker/README.md](src/runtime/worker/README.md) — per-symbol worker model.

**Apps layout (future):** [apps/README.md](apps/README.md) — reserved workspace shape.
