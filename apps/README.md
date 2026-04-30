# `apps/` (reserved — Phase 2)

The **runnable entry** for this repository is currently `src/main.ts` at the repo root (Phase 1 single package).

When we adopt **npm workspaces**, expect:

- `apps/trader` — process supervisor + CLI entry, depending on `@scalper/*` packages.
