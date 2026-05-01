# SPEC-10 — Rollout documentation artifacts (technical)

**Phase:** 10  
**Prerequisites:** SPEC-07 MVP complete; SPEC-09 recommended before live.

---

## 1. Purpose

Produce **reviewable markdown artifacts** with **stable sections**, **internal links**, and **flag inventory** sourced from `src/config/schema.ts`.

---

## 2. Deliverable files (normative)

| Path | Required sections |
|------|-------------------|
| `docs/rollout/testnet-limitations.md` | Liquidity, fees, WS stability, fill realism, URL matrix vs prod |
| `docs/architecture/feature-flags.md` | Table: flag path, type, default, owner role, when to enable, dependent phases |
| `docs/rollout/promotion-checklist.md` | Ordered checklist with Evidence column; link `npm run verify:rollout` |
| `docs/rollout/emergency-stop.md` | SIGINT, kill -9 caveat, UI cancel-all, API key disable, Binance support reference |

---

## 3. Feature flag table generation (machine-assisted)

**Optional script:** `scripts/generate-feature-flag-doc.mjs` reads `schema.ts` via regex AST — **not required for MVP** — manual table acceptable if updated same PR as schema changes.

**Minimum columns:**

1. JSON path (`features.liveQuotingEnabled`)
2. Type
3. Default
4. Owner
5. Risk level (`low/med/high`)
6. Dependencies (e.g. requires credentials)

**Must include:** every key under `featuresSchema` + `liveQuotingEnabled` + `useWorkerThreads` (when added) + quoting schema keys.

---

## 4. README / DOCUMENTATION updates

**README.md:**

- New subsection **Rollout & safety** with links to `docs/rollout/*` and `docs/architecture/feature-flags.md`.

**DOCUMENTATION.md:**

- Link `docs/specs/` index for implementers.

---

## 5. Script cross-links

**File:** `scripts/verify-rollout.ts`

- Top comment block MUST contain: `See docs/rollout/promotion-checklist.md`.

---

## 6. Review gate

**Normative:** Non-author engineer completes **promotion-checklist.md** as dry-run (unchecked boxes OK) and files GitHub review comment — optional process; document in CONTRIBUTING if desired.

---

## 7. Test specification

| ID | Check |
|----|--------|
| T01 | All links resolve on GitHub |
| T02 | No real secrets in markdown |
| T03 | Flag table matches grep of `schema.ts` keys |

---

## 8. Definition of Done

- [ ] Four files exist and linked from README
- [ ] `Last reviewed: YYYY-MM-DD` footer in each doc

---

## 9. Coding phase transition

After SPEC-10 docs merge **or** in parallel with SPEC-09, implementation proceeds **strictly** in SPEC-01 → SPEC-10 order; each merge updates checkbox section in `docs/phases/*.md` Status lines.
