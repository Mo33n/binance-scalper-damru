# Running DAMRU on Binance USD‑M — operator & parameter guide

This document is written for someone who thinks in **risk first**, then edge. It explains **how to run** this codebase, **what each major parameter does in trading terms**, and **what you should turn when your objective changes** (observation → testnet sizing → tighter risk).

Authoritative schema: [`src/config/schema.ts`](../../src/config/schema.ts). Merge rules and quick reference: [`config/README.md`](../../config/README.md). Safety and promotion: [`docs/rollout/`](../rollout/) and [`docs/architecture/feature-flags.md`](../architecture/feature-flags.md).

---

## 1. What you are actually running

**DAMRU** is a **config-driven** USD‑M perpetuals stack: per-symbol runners consume **depth + agg trades**, maintain **VPIN-style flow toxicity** (and optional **realized-vol regime**), and drive a **hybrid quoting** policy (post-only oriented, widen or step off touch when conditions deteriorate). A **supervisor** coordinates heartbeats and halt commands; **user-stream fills** update a **position ledger**; optional **reconciliation** compares ledger to REST positions.

It is **not** a black-box alpha factory. Treat it as **execution + risk scaffolding** where your JSON and flags decide how aggressively you lean into the market.

---

## 2. Prerequisites (non-negotiable)

| Requirement | Why it matters |
|-------------|----------------|
| **Node 20+** | Matches `package.json` engines. |
| **Outbound network** | Bootstrap calls public REST (`exchangeInfo`, fees, leverage, etc.). |
| **`CONFIG_PATH`** | Points at validated JSON; see merge order in `config/README.md`. |
| **`TRADING_ENV` / `APP_ENV`** | `testnet` or `live` — seeds default REST/WS hosts and **must** match your intent. Hosts are validated against `environment`. |
| **API keys (optional until you need private streams or orders)** | Set `BINANCE_API_KEY` / `BINANCE_API_SECRET` in the environment (or embed in JSON credentials — prefer env). No automatic `.env` loading. |

**Trader discipline:** use **separate keys** per environment, IP restrict where Binance allows it, and never commit secrets.

---

## 3. How to run — commands

**Development (TypeScript, no prior build):**

```bash
export TRADING_ENV=testnet
export CONFIG_PATH=config/examples/testnet.json
# Optional:
# export BINANCE_API_KEY=...
# export BINANCE_API_SECRET=...
npm run dev
```

**Keep the process alive after bootstrap (typical for observing WS + loops):**

```bash
npm run dev -- --stay-alive
# or: DAMRU_STAY_ALIVE=1
```

**Production-shaped binary:**

```bash
npm run build
export TRADING_ENV=testnet
export CONFIG_PATH=config/examples/testnet.json
npm start -- --stay-alive
```

**Force read-only order layer even if keys exist:**

```bash
npm run dev -- --dry-run --stay-alive
```

**Disable market data WebSockets** (bootstrap-only / CI-style):

```bash
DAMRU_DISABLE_MARKET_DATA=1 npm run dev
```

**Help:**

```bash
npm run dev -- --help
```

**Worker threads** (`features.useWorkerThreads: true`): run **`npm run build`** first so Node can load `dist/runtime/worker/symbol-worker.js`; workers rely on **process env** for signing.

---

## 4. Operating modes — what you get

| Mode | Keys | `liveQuotingEnabled` | CLI | Rough behavior |
|------|------|----------------------|-----|----------------|
| **Observation** | Optional | `false` (default) | `--stay-alive` | Bootstrap, mode selection, runners may attach **market data** and signals; **no** `ExecutionService` → **no REST orders**. |
| **Keys, quoting off** | Yes | `false` | no `--dry-run` | Still **read_only** at the venue: **no** `ExecutionService`. **`AccountUserStreamCoordinator` does not start** the listenKey + user-data WS path (fills from the exchange will **not** flow into the ledger here). |
| **Dry-run** | Yes | any | `--dry-run` | **No** `ExecutionService` — same as read-only for orders **and** user stream (coordinator bails when execution is absent). |
| **Testnet / live posting** | Yes | `true` | no `--dry-run` | **Order-capable** venue: `ExecutionService` exists → **user stream** (listenKey) **can** start, **reconciliation** timer **can** run, **place/cancel** per policy. |

**Veteran note:** On testnet, liquidity and microstructure lie to you. Use testnet to prove **plumbing and kill switches**, not to prove **edge**.

---

## 5. Adjust parameters by *objective*

### 5.1 “I only want to watch the machine breathe”

- Keep **`features.liveQuotingEnabled`: `false`**.
- Set **`logLevel`**: `info` or `debug` if you need skip reasons.
- Use **`--stay-alive`**.
- **Optional:** tighten **`quoting.maxBookStalenessMs`** later when you turn quoting on — no effect on orders while execution is off.

### 5.2 “I want signals tight but not gun-shy”

- **`risk.vpinTau`**: Higher → flow must look **more toxic** before hybrid policy treats the regime as “toxic” (wider / off-touch). Lower → **more defensive** quoting sooner.
- **`risk.vpinBucketVolume`**: Larger buckets → **slower** toxicity score updates, smoother; smaller → **nervous**, faster reactions to tape bursts.
- **`risk.vpinEwmaN`**: More smoothing on the score → less flicker; less smoothing → more reactive.
- **`risk.rvEnabled` / `risk.rvTau`**: Turn RV on when you want **mid-path volatility** to contribute to **stressed** regime (and, if **`features.regimeFlagsEnabled`**, possible **halt** paths tied to RV).

### 5.3 “I want to clip risk before I clip edge”

Priority order for most desks:

1. **`risk.maxOpenNotionalQuote`** — coarse **notional budget** for how big the book is allowed to think.
2. **`risk.maxAbsQty`** / **`risk.maxAbsNotional`** — **per-symbol** inventory and notional caps; pre-trade risk consults the ledger.
3. **`risk.globalMaxAbsNotional`** — **portfolio** notional cap across symbols.
4. **`risk.sessionLossCapQuote`** — portfolio PnL guard (wired to **loss guard** → supervisor **HALT** when breached). Quote-unit cap; align with your tick value mentally.
5. **`risk.dailyLossCapQuote`** (optional) — if unset, defaults to **`sessionLossCapQuote`** in the supervisor loss guard. Set explicitly when **intraday** and **session** limits should differ.

### 5.4 “I need fewer API calls / less cancel-replace churn”

- **`quoting.repriceMinIntervalMs`**: Raise it (e.g. 250 → 400–800 ms) to **slow** the quoting loop **trade-off**: slower reaction to touch moves; less rate-limit and fee churn.
- **`binance.feeSafetyBufferBps`**: Part of **economic spread floor** at bootstrap; raising it forces **wider** minimum spreads at acceptance — fewer borderline quotes that die to fees.

### 5.5 “Books lie sometimes — don’t quote stale”

- **`quoting.maxBookStalenessMs`**: Lower → **stricter** freshness requirement before placing; higher → more tolerant (dangerous on unstable WS).

### 5.6 “Size per clip”

- **`quoting.baseOrderQty`**: Explicit per-leg base qty when set.
- If omitted: orchestrator uses **~5% of `risk.maxAbsQty`** (capped by `maxAbsQty`) — documented convention; tune **`maxAbsQty`** or set **`baseOrderQty`** explicitly for predictable clip size.

### 5.7 “Turn on defensive overlays”

| Flag | Purpose |
|------|---------|
| **`features.markoutFeedbackEnabled`** | After fills, **markout EWMA** can **widen** the spread floor (runner-local tracker). Use when you want **adverse selection feedback** in sizing of *minimum* spread, not a guarantee of profitability. |
| **`features.regimeFlagsEnabled`** | Evaluates **book width / thinness**, **mid drift**, and **RV stressed** (if RV enabled); can emit **`halt_request`** → portfolio **HALT_QUOTING**. Thresholds live in code defaults (`domain/regime/live-regime-thresholds.ts`) until exposed in config. |
| **`features.useWorkerThreads`** | Isolation **per symbol**; operational complexity ↑; use when you believe **CPU / GC isolation** is worth it. |

### 5.8 “Bootstrap / symbol acceptance”

- **`symbols`**: List of USD‑M symbols; bootstrap may **reject** illiquid / gated names.
- **`risk.defaultMinSpreadTicks`**: Baseline floor; **per-symbol** effective floor can come from **bootstrap spread gate** (`effectiveMinSpreadTicks` on accepted symbols).
- **`perSymbolOverrides[].minSpreadTicks`**: Surgical wider floor for specific symbols when overrides are applied in your branch (see `config/README.md`).
- **`risk.maxDesiredLeverage`**, **`risk.riskMaxLeverage`**, **`risk.maxOpenNotionalQuote`**: Interact with **leverage selection** at bootstrap — constraining **max leverage** vs **brackets** is how you keep notionals sane before you ever quote.

---

## 6. Full parameter reference (trading meaning)

### 6.1 Environment & venues

| Parameter | Meaning |
|-----------|---------|
| **`environment`** | `testnet` vs `live` — canonical switch with URL validation. |
| **`credentialProfile`** | Optional; **must match** `environment` if set — prevents mislabeled key profiles. |
| **`binance.restBaseUrl` / `wsBaseUrl`** | Usually defaulted from `TRADING_ENV`; override only with care — allowlist must match `environment`. |
| **`binance.feeRefreshIntervalMs`** | Intent for how often you **refresh fee assumptions** from the exchange (policy / ops cadence). |
| **`binance.feeSafetyBufferBps`** | Extra **bps cushion** in spread-vs-fee economics at bootstrap gate — higher → harder to accept tight-spread symbols. |

### 6.2 Feature flags (`features.*`)

| Flag | Default | Meaning |
|------|---------|---------|
| **`liveQuotingEnabled`** | `false` | **Master switch** for constructing **`ExecutionService`** and posting orders (subject to `--dry-run` and credentials). |
| **`markoutFeedbackEnabled`** | `false` | Widens minimum spread from **markout EWMA** when adverse. |
| **`regimeFlagsEnabled`** | `false` | **Macro defensive halts** from book / trend / RV (see code thresholds). |
| **`useWorkerThreads`** | `false` | Per-symbol **worker threads**; requires **built** `dist` worker. |
| **`reconciliationIntervalOverrideEnabled`** | `false` | **Reserved** in schema — verify implementation before relying on name. |
| **`preFundingFlattenEnabled`** | `false` | **Reserved** in schema for funding-window behavior — **not** wired in application paths reviewed here; treat as **future**. |

### 6.3 Quoting cadence (`quoting.*`)

| Parameter | Meaning |
|-----------|---------|
| **`repriceMinIntervalMs`** | Minimum time between **quoting ticks** (cancel/replace cycle attempts) per symbol. |
| **`maxBookStalenessMs`** | Skip quoting when computed book age exceeds this. |
| **`baseOrderQty`** | Optional explicit **base qty per leg**; else ~5% of `maxAbsQty` convention. |

### 6.4 Rollout (`rollout.*`)

| Parameter | Meaning |
|-----------|---------|
| **`markoutPromotionWindowMs`** | Rolling **milliseconds** for economics / markout review windows in rollout narrative; **`npm run verify:rollout`** asserts sensible positive value on small-live template. |

### 6.5 Flow toxicity & RV (`risk.*` — signals)

| Parameter | Meaning |
|-----------|---------|
| **`vpinBucketVolume`** | Target volume per **VPIN bucket** — smaller → faster regime flips. |
| **`vpinBucketBasis`** | `base` vs `quote` — **units** for bucket cuts; pick one and stick to it mentally. |
| **`vpinEwmaN`** | Smoothing of toxicity dynamics. |
| **`vpinStaleFlushMs`** | Flush **stale partial buckets** so decay doesn’t numb you to silence. |
| **`vpinTau`** | Toxicity **threshold** vs hybrid classifier — primary “when do we step back?” knob. |
| **`rvEnabled`** | Turns **realized vol** path on in `SignalEngine`. |
| **`rvTau`** | Separates **normal** vs **stressed** RV regime (used in quoting + regime halts when enabled). |

### 6.6 Inventory & loss (`risk.*` — risk rails)

| Parameter | Meaning |
|-----------|---------|
| **`maxAbsQty`** | Hard **per-symbol position** bound (qty); pre-trade risk consults ledger. |
| **`maxAbsNotional`** | Per-symbol **notional** bound (`~ absQty * mark`). |
| **`globalMaxAbsNotional`** | **Cross-symbol** notional stress gate in ledger read path. |
| **`inventoryEpsilon`** | “Small enough to ignore” inventory band for **time-above-epsilon** logic. |
| **`maxTimeAboveEpsilonMs`** | How long **inventory magnitude** may stay above epsilon before stress escalation in ledger. |
| **`sessionLossCapQuote`** | Portfolio **loss cap** (quote units) for **loss guard** → **HALT_QUOTING** (`session_loss_cap`). |
| **`dailyLossCapQuote`** | Optional separate cap; **defaults to session cap** if omitted in wiring. |
| **`maxOpenNotionalQuote`** | Bootstrap / risk **budget** knob — keep aligned with leverage brackets and personal risk tolerance. |

### 6.7 Margin utilization bands (`risk.*`)

| Parameter | Meaning |
|-----------|---------|
| **`warnUtilization`** | Threshold for **warn** state in **`MarginMonitor`** helper (0–1). |
| **`criticalUtilization`** | **Critical** band. |
| **`haltUtilization`** | **Halt** classification in the helper. |

**Important honesty:** These fields are **validated in config** and used by **`MarginMonitor`** in isolation tests. They are **not** automatically polled from Binance margin endpoints in the default **`runTrader`** path at the time of this writing. Treat them as **prepared policy constants** until a margin polling loop is wired to the supervisor. Do **not** assume automatic halt on utilization without verifying code.

### 6.8 Funding-adjacent

| Parameter | Meaning |
|-----------|---------|
| **`preFundingFlattenMinutes`** | Minutes-before-funding narrative knob in schema. **`preFundingFlattenEnabled`** is not wired — verify before trusting automation. |

### 6.9 Supervisor & reconciliation

| Parameter | Meaning |
|-----------|---------|
| **`heartbeatIntervalMs`** | Worker **heartbeat emit** cadence and dev **pulse** interval when stay-alive attached. |
| **`heartbeatMissThreshold`** | Missed heartbeats (in multiples of interval logic) → **cancel-all** for **that symbol** when supervisor detects dead worker. |
| **`reconciliationIntervalMs`** | REST **position vs ledger** poll cadence when credentials + execution exist — mismatch can trigger **HALT** reasons (`position_drift:*`). |

### 6.10 Credentials

| Parameter | Meaning |
|-----------|---------|
| **`credentials.apiKey` / `apiSecret`** | Optional in JSON; usually prefer **`BINANCE_API_KEY` / `BINANCE_API_SECRET`** env merges from `load.ts`. |

### 6.11 Logging

| **`logLevel`** | `debug` \| `info` \| `warn` \| `error` — verbosity for structured logs. |

---

## 7. What actually halts quoting today (wired behaviors)

Without claiming completeness of every branch, you should expect **HALT_QUOTING**-style outcomes when:

- **Supervisor shutdown** sequence runs (`shutdown` reason).
- **Loss guard** trips on portfolio PnL vs **`sessionLossCapQuote` / `dailyLossCapQuote`** (`session_loss_cap`).
- **Reconciliation** detects material drift (`position_drift:<symbol>`).
- **`features.regimeFlagsEnabled`** requests halt (`regime_*` reasons via **`halt_request`**).
- Other halts already in logs (`margin_halt`, etc.) as code evolves — **grep** `HALT_QUOTING` in `src/` when upgrading.

**Emergency:** See [`docs/rollout/emergency-stop.md`](../rollout/emergency-stop.md).

---

## 8. Suggested testnet progression

1. **`liveQuotingEnabled`: `false`**, keys optional, **`--stay-alive`** — confirm bootstrap + **market-data** WS + logs (no private user stream).
2. Keys on testnet, still **`liveQuotingEnabled`: `false`** — confirms **read_only** with REST available for signed bootstrap paths that don’t need `ExecutionService`; **no** user-stream fills until step 4.
3. **`liveQuotingEnabled`: `true`** plus **`--dry-run`** — still **no** execution / user stream (dry-run forces read_only); use this only to validate **argv + config** wiring, not private streams.
4. **Tiny `maxAbsQty`**, wide **`defaultMinSpreadTicks`**, conservative **`sessionLossCapQuote`**, **`liveQuotingEnabled`: `true`**, **no** `--dry-run` — **minimum** posting risk on testnet; **user stream + reconciliation** active when credentials present.
5. Layer **`markoutFeedbackEnabled`** / **`regimeFlagsEnabled`** only after you trust halts and caps.

---

## 9. Closing trader mindset

Parameters are **liability curves**. The JSON does not know your clearing arrangement, your VaR limit, or your sleep schedule — **`sessionLossCapQuote`** and **`maxAbsQty`** do more for survival than any toxicity tweak. Tune flow knobs **after** caps and halts match what you could explain to a compliance officer at 3 a.m.

---

*Last reviewed: 2026-05-01*
