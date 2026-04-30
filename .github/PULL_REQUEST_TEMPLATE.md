## Summary

<!-- What changed and why (1–3 sentences). -->

## Checklist

- [ ] **Layering:** Hexagonal boundaries respected (`domain/` and `application/ports/` do not import `infrastructure/` or `runtime/` — enforced by ESLint).
- [ ] **SRP:** New services have a single clear responsibility.
- [ ] **Secrets:** No API keys or secrets in code or fixtures.
- [ ] **Dependencies:** New packages are justified (record in a team ADR or your dependency policy).
- [ ] **Quality:** `npm run typecheck && npm run lint && npm test && npm run verify:secrets && npm run build`.
