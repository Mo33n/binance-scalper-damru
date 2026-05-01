# Promotion checklist (testnet → live)

Use this as a **dry-run** before enabling real order flow. A non-author reviewer SHOULD walk it once per promotion boundary (template → small-live → wider caps).

**Automated guardrail:** run `npm run verify:rollout` (loads `config/examples/small-live.json` under live env and asserts tight `maxOpenNotionalQuote` and rollout fields). See [`scripts/verify-rollout.ts`](../../scripts/verify-rollout.ts).

| Step | Check | Evidence |
|------|--------|----------|
| 1 | `environment` is `live`; `credentialProfile` matches `environment` when set | Config JSON + load logs |
| 2 | REST/WS URLs point at **production** Binance USD-M endpoints | `binance.restBaseUrl`, `binance.wsBaseUrl` |
| 3 | API keys are **live** keys, IP-restricted and least-privilege | Key console screenshot / policy doc (no secrets in repo) |
| 4 | `features.liveQuotingEnabled` intentionally `true` | Config diff |
| 5 | Risk caps reviewed: `sessionLossCapQuote`, `dailyLossCapQuote`, `maxOpenNotionalQuote`, `maxAbsQty`, leverage bounds | Risk sign-off |
| 6 | `npm run verify:secrets` clean on the same tree | CI / local log |
| 7 | `npm run verify:rollout` passes | Command output JSON `{ ok: true, ... }` |
| 8 | `npm test` + `npm run build` on release commit | CI green |
| 9 | Operator read [emergency-stop.md](./emergency-stop.md) | Ack in ticket / review |
|10 | Testnet limitations understood | [testnet-limitations.md](./testnet-limitations.md) |

Optional hardening before widening size:

| Step | Check | Evidence |
|------|--------|----------|
| A | `features.markoutFeedbackEnabled` decision documented | [feature-flags.md](../architecture/feature-flags.md) |
| B | `features.regimeFlagsEnabled` decision documented | Same |
| C | `features.useWorkerThreads` load-tested if enabled | Bench notes |

---

*Last reviewed: 2026-05-01*
