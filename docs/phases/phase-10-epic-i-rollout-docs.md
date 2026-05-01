# Phase 10 — Epic I rollout documentation & operator gates (in-repo)

**Status:** Draft  
**Epic traceability:** Epic I (I1 config matrix, I1.2 secrets, I1.3 feature flags registry, I1.4 testnet limitations, I2 promotion / drills)  
**Prerequisites:** [Phase 07](./phase-07-supervisor-integration.md) **Done** (MVP bot). Phases **08–09** may proceed in parallel **documentation** tasks but **I2 drills** assume stable runtime.

---

## 1. Objective

Close **documentation and governance gaps** so a new operator can **promote** from testnet to small-live with explicit checklists, understand **what testnet does not prove**, and find **every feature flag** with owner + default. Align `verify:rollout` / `verify:secrets` docs with **operator runbooks**.

---

## 2. In scope / out of scope

### In scope

- `docs/rollout/testnet-limitations.md` (new): liquidity, fee, latency, fill behavior caveats per RFC §13.1 spirit.
- `docs/architecture/feature-flags.md` (new): table of **all** `features.*` + `liveQuotingEnabled` + worker flag + markout + regime + **owner** + **default** + **when to enable**.
- `docs/rollout/promotion-checklist.md` (new): ordered checklist: reconcile healthy, markout window satisfied (`rollout.markoutPromotionWindowMs`), keys rotated, caps verified, **dry-run** on live JSON, etc.; link to `npm run verify:rollout`.
- `docs/rollout/emergency-stop.md` (new): SIGINT, halt command, Binance UI cancel-all backup, API key disable procedure.
- Update [README.md](../../README.md): link block “Rollout & safety” pointing to `docs/rollout/*`.
- Update [config/README.md](../../config/README.md): link feature flags doc; cross-link promotion checklist for `small-live.json`.
- Optional: `docs/rollout/drill-script-notes.md` if automatable drills exist—else “manual drill record template.”

### Out of scope

- Legal/compliance sign-off text (reference only).
- Changing exchange API behavior.

---

## 3. Dependencies & inputs

- Final list of feature flags from `schema.ts` after Phases 02–09.
- Script outputs from `scripts/verify-rollout.ts` and `verify-secrets.mjs`.

---

## 4. Work breakdown (concrete tasks)

### 4.1 Inventory flags

1. Grep `src/config/schema.ts` for `features` and any top-level toggles added in prior phases.
2. Produce authoritative markdown table—**no** flag omitted.

### 4.2 Testnet limitations doc

3. Sections: fees, queue position, absence of toxic flow realism, WS disconnect frequency, key differences USD-M testnet vs prod URLs.
4. Link from README “Introduction” disclaimer.

### 4.3 Promotion checklist

5. Each item has **owner role** (e.g. “Quant”, “SRE”) and **evidence** column (e.g. screenshot, log snippet).
6. Include **explicit** “no size increase without …” language aligned with `rollout.markoutPromotionWindowMs` comment in schema.

### 4.4 Emergency stop

7. Document: `HALT` path, process kill, API key rotation, Binance cancel all open orders UI path.

### 4.5 Script alignment

8. Update `scripts/verify-rollout.ts` header comment to link `docs/rollout/promotion-checklist.md`.
9. Ensure `package.json` script descriptions unchanged except optional `docs` link in `README` not package.json.

### 4.6 Review

10. Peer review: non-engineer reads testnet limitations + can explain why live differs.

---

## 5. Artifacts

| Path | Change |
|------|--------|
| `docs/rollout/testnet-limitations.md` | **New** |
| `docs/architecture/feature-flags.md` | **New** |
| `docs/rollout/promotion-checklist.md` | **New** |
| `docs/rollout/emergency-stop.md` | **New** |
| `README.md`, `config/README.md`, `DOCUMENTATION.md` | Links |
| `scripts/verify-rollout.ts` | Comment link |

---

## 6. Acceptance criteria

- [ ] Every `features.*` key in schema appears in feature-flags.md with default + owner.
- [ ] README links to rollout docs in ≤2 clicks from root.
- [ ] Promotion checklist references `verify:rollout` command verbatim.
- [ ] No secrets in markdown examples (use placeholders).

---

## 7. Definition of Done (complete)

1. **Completeness:** All four new docs exist and are linked.
2. **Accuracy:** Flag table matches `schema.ts` on merge commit (CI grep check optional script).
3. **Operator test:** One person **not** author follows emergency-stop doc in staging dry-run and signs checklist.
4. **Epic I alignment:** I1.3 / I1.4 / I2 narrative satisfied **in-repo** (no “see external wiki only” for these items).
5. **Governance:** `config/README.md` points to feature flags for PR reviewers.
6. **Status:** Phase 10 marked `Done` in git when merged.

---

## 8. Test plan

| Check | Method |
|-------|--------|
| Broken links | `markdown-link-check` optional CI or manual |
| Flag parity | script `node scripts/check-feature-docs.mjs` **optional** future |

---

## 9. Manual smoke

1. New engineer onboarding: follow README → rollout docs → run `verify:rollout` successfully.
2. Verify all internal links resolve in GitHub rendering.

---

## 10. Non-functional

- **Clarity:** reading level suitable for sleep-deprived operator (short sentences).
- **Versioning:** date stamp at bottom of each doc `Last reviewed: YYYY-MM-DD`.

---

## 11. Risks

| Risk | Mitigation |
|------|------------|
| Doc drift | add CI check later; for now CODEOWNERS on `docs/rollout` |

---

## 12. Handoff

Project reaches **“RFC operational posture”** when Phase 08–10 complete **and** epic-specific acceptance tests from `development_document` are mapped to automated tests (separate maintenance task—list in promotion checklist as ongoing).

---

## 13. Open questions

- Bilingual docs requirement—if any, specify locale strategy.
