# Binance scalper damru — config cheat sheet

**Local run & tooling:** [DEVELOPERS.md](../DEVELOPERS.md). **Day-to-day ops:** [docs/operator/running-the-trader-and-parameters.md](../docs/operator/running-the-trader-and-parameters.md).

---

## Quick start

1. **Point the app at a JSON file** with `CONFIG_PATH` (see `config/examples/` — e.g. `testnet.json` for testnet-style defaults).
2. **Set `environment`** in that file to **`testnet`** or **`live`**. It must match the Binance hosts and the keys you use. Optional **`credentialProfile`** must match **`environment`** if you set it.
3. **Set `TRADING_ENV` or `APP_ENV`** to the same world (`testnet` / `live`) when you want the built-in default REST/WS hosts before your file is merged in.
4. **Keep `features.liveQuotingEnabled` false** until you deliberately want the process to build the execution layer and place orders (and you are not using `--dry-run`). Default behavior is read-only at the order layer when the flag is off.
5. **Do not put API secrets in JSON** in git. Use **`BINANCE_API_KEY`** and **`BINANCE_API_SECRET`** (or your secret manager) and see **Environment variables** below.
6. **Root version:** your JSON must include **`"configSchemaVersion": "1"`**.
7. **Every knob** (names, types, defaults) is defined in **`src/config/schema.ts`**. The tables in **Full parameter reference** are the human-readable version of that file.
8. **Optional profit gate on inventory de-risk:** when **`features.inventoryDeRiskEnabled`** is on, set **`risk.deRiskProfitOnly`** / **`risk.deRiskMinProfitTicks`** so automated reduce-only exits fire only when the touch price clears **`avgEntryPrice`** by enough ticks (see **Risk & limits**).

---

## How config is loaded

- **Schema:** Zod in **`src/config/schema.ts`**. **Load path:** deep merge in **`src/config/load.ts`**, then the config is frozen for the run.
- **Merge order:** (1) built-in defaults for testnet vs live (from `TRADING_ENV` / `APP_ENV`) — mainly Binance REST/WS URLs; hosts are checked against **`environment`**; (2) your JSON — nested objects merge, but **arrays** **`symbols`** and **`perSymbolOverrides`** **replace** entirely; (3) env overrides — **`BINANCE_REST_BASE_URL`**, **`BINANCE_WS_BASE_URL`**, **`BINANCE_API_KEY`**, **`BINANCE_API_SECRET`**, **`LOG_LEVEL`**.

---

## Full parameter reference

### Root-level fields

| Field | What it does (simple) |
| --- | --- |
| **`configSchemaVersion`** | Locks the config shape. Wrong version → startup error. |
| **`environment`** | **`testnet`** or **`live`**. Chooses default URLs and must match the Binance hosts you use. |
| **`credentialProfile`** | Optional. If set, must equal **`environment`** — catches “live keys labeled testnet” mistakes. |
| **`logLevel`** | **`debug`**, **`info`**, **`warn`**, **`error`**. How chatty logs are (default **`info`**). |
| **`symbols`** | List of USD-M symbols to run (e.g. `BTCUSDT`). Order matters for display only; array replaces on merge. |
| **`credentials`** | Optional inline **`apiKey`** / **`apiSecret`**; usually you use env vars instead. |
| **`heartbeatIntervalMs`** | How often the process expects a healthy “tick” (default **5000** ms). |
| **`heartbeatMissThreshold`** | How many missed heartbeats before treating the session as unhealthy (default **3**). |
| **`reconciliationIntervalMs`** | How often the app compares **ledger vs REST position** (default **60_000** ms). |
| **`perSymbolOverrides`** | Small per-symbol tweaks (see [Per-symbol overrides](#per-symbol-overrides-persymboloverrides)). Optional; default empty array. |

### Binance connection (`binance.*`)

| Field | What it does (simple) |
| --- | --- |
| **`restBaseUrl`** | REST API base URL (required in JSON unless defaults fill it). |
| **`wsBaseUrl`** | WebSocket base URL for streams. |
| **`feeRefreshIntervalMs`** | How often you **intend** to refresh fee assumptions from the exchange (default **24h**). |
| **`feeSafetyBufferBps`** | Extra spread cushion (basis points) so you do not quote exactly at fee edge (default **1**). |
| **`maxConcurrentDepthSnapshots`** | Max REST depth snapshot fetches at once process-wide (default **2**). Lower if you see HTTP 429. |
| **`depthSnapshotMinIntervalMs`** | Minimum time between **starting** two depth snapshots (default **100** ms; **0** = no extra gap). |

### Risk & limits (`risk.*`)

| Field | What it does (simple) |
| --- | --- |
| **`sessionLossCapQuote`** | Stop/slow trading when **session** loss in quote currency hits this (required). |
| **`dailyLossCapQuote`** | Optional **daily** loss cap; if omitted, session cap is used for daily logic too. |
| **`maxOpenNotionalQuote`** | Cap on **open** notional exposure in quote terms (required). |
| **`defaultMinSpreadTicks`** | Default minimum spread (ticks) when no per-symbol override applies (default **5**). |
| **`maxDesiredLeverage`** | What you **ask** the exchange for at bootstrap (default **50**). |
| **`riskMaxLeverage`** | Internal ceiling used when choosing leverage (default **20**). |
| **`vpinBucketVolume`** | Size of each VPIN volume bucket for flow-toxicity scoring (default **1**). |
| **`vpinBucketBasis`** | **`base`** or **`quote`** — whether bucket size is in base or quote units (default **`base`**). |
| **`vpinEwmaN`** | Smoothing length for the VPIN-style score (default **5**). |
| **`vpinStaleFlushMs`** | After this idle time, flush a stuck VPIN bucket (default **60_000** ms). |
| **`vpinTau`** | Toxicity threshold; above it, hybrid quoting **steps back** (between 0 and 1, default **0.6**). |
| **`rvEnabled`** | Turn on **realized-volatility** style filtering (default **false**). |
| **`rvTau`** | Parameter for the RV filter when enabled (default **0.0005**). |
| **`maxAbsQty`** | Hard cap on absolute position size per symbol in **base** units (default **1**). |
| **`maxAbsNotional`** | Hard cap per symbol in **notional** terms (default **10_000**). |
| **`globalMaxAbsNotional`** | Cap on **sum** of notionals across symbols (default **25_000**). |
| **`inventoryEpsilon`** | Small inventory level treated as “flat enough” (default **0**). |
| **`maxTimeAboveEpsilonMs`** | If inventory stays above epsilon longer than this, you get **inventory pressure** behavior (default **60_000** ms). |
| **`riskLimitBreachLogCooldownMs`** | Minimum gap between **`risk.limit_breach`** logs for the same issue (default **60_000**; **0** = log every time). |
| **`warnUtilization`**, **`criticalUtilization`**, **`haltUtilization`** | Margin utilization bands (0–1): warn → critical → halt (defaults **0.7 / 0.85 / 0.95**). |
| **`preFundingFlattenMinutes`** | Minutes-before-funding window for future flatten logic (default **0**). Accepted by schema; **no runtime consumer in `src` yet** — keep **0** unless you know otherwise. |
| **`deRiskMode`** | When **`features.inventoryDeRiskEnabled`** is on: **`off`** (no auto exit), **`passive_touch`** (post-only at touch), **`ioc_touch`** (IOC limit). Default **`passive_touch`**. |
| **`deRiskProfitOnly`** | When **`true`**, automated de-risk runs only if the **touch** exit would beat **ledger `avgEntryPrice`** by at least **`deRiskMinProfitTicks`** (long: best ask ≥ avg; short: best bid ≤ avg). If unknown avg or not yet profitable, de-risk is skipped and you may see **`quoting.de_risk_profit_gate`**. Default **`false`**. |
| **`deRiskMinProfitTicks`** | Extra **ticks** of edge vs avg entry required when **`deRiskProfitOnly`** is on (default **0**). |

### Feature flags (`features.*`)

| Field | What it does (simple) |
| --- | --- |
| **`liveQuotingEnabled`** | **`true`** → build **ExecutionService** and send real orders when keys exist and not **`--dry-run`**. **`false`** → read-only execution layer even with keys (default **false**). |
| **`markoutFeedbackEnabled`** | Feeds **markout policy** into quoting (spread widening from rolling markout) when **true** (default **false**). |
| **`reconciliationIntervalOverrideEnabled`** | Placeholder in schema only — **not read by runtime** today; leave **false**. |
| **`preFundingFlattenEnabled`** | Placeholder in schema only — **not read by runtime** today; leave **false**. |
| **`regimeFlagsEnabled`** | Turns on **regime flag** handling in the symbol runner (default **false**). |
| **`inventoryDeRiskEnabled`** | When **`true`**, ledger stress can trigger **reduce-only** exits per **`risk.deRiskMode`** (default **false**). |
| **`useWorkerThreads`** | Run **one worker thread per symbol** for isolation (default **false**). Cannot use with **`combinedDepthStream`**. |
| **`combinedDepthStream`** | Multiplex depth on **one** WS connection (`/stream?streams=...`) on the main thread (default **false**). Not compatible with **`useWorkerThreads`**. |

### Rollout (`rollout.*`)

| Field | What it does (simple) |
| --- | --- |
| **`markoutPromotionWindowMs`** | Rolling window (ms) for judging whether economics/markout justify sizing up (default **86_400_000** = 24h). |

### Quoting (`quoting.*`)

Generates quote timing, staleness guards, trend-stress behavior, and the liquidity-engine block.

| Field | What it does (simple) |
| --- | --- |
| **`repriceMinIntervalMs`** | Minimum time between quoting **ticks** per symbol (default **250**). |
| **`maxBookStalenessMs`** | If the order book is older than this, **do not** post new quotes (default **3000**). |
| **`warnLogCooldownMs`** | Minimum gap between noisy quoting warnings (de-risk suppressed, unfillable dust, etc.). Default **60_000**; **0** means “derive from **`repriceMinIntervalMs`**” (can be loud). |
| **`baseOrderQty`** | Optional fixed **base** size per quote leg; if missing, code uses a fraction of **`risk.maxAbsQty`**. |
| **`regimeTrendStressPolicy`** | What happens when **trend stress** builds: **`legacy`** (halt on trip), **`cancel_throttle`**, **`ladder_mvp`**, **`ladder_full`** (default **`legacy`**). |
| **`regimeTrendStressPersistenceN`** | How many **consecutive** stressed trend samples before halt under non-legacy policies (default **3**). Book/RV trips can still halt faster. |
| **`regimeTrendThrottleSpreadMult`** | When throttling, widen minimum spread by about this factor (≥ **1**, default **1.25**). |
| **`regimeTrendInventoryMinQty`** | Minimum **base** position size to treat wrong-way trend as “maybe flatten” for ladder modes (default **0**). |
| **`regimeStressClearedMs`** | After price calms down, wait this long before clearing stress/throttle (**0** = clear immediately on good sample). |
| **`regimeTrendImpulseNormalizer`** | **`none`** = raw mid step; **`rv_scaled`** = scale move by RV σ when **`risk.rvEnabled`** (default **`none`**). |
| **`regimeTrendRvZHalt`** | If **`rv_scaled`**, halt when normalized impulse **z** exceeds this (default **2.5**). |
| **`liquidityEngine`** | Optional nested block — see [Liquidity engine](#liquidity-engine-quotingliquidityengine). Omit entirely → liquidity-engine features off; **`{}`** merges schema defaults. |

### Liquidity engine (`quoting.liquidityEngine.*`)

Umbrella for economics-aware quoting, portfolio caps, regime splits, two-leg safety, fair value, inventory skew, FSM, and trigger debouncing.

| Field | What it does (simple) |
| --- | --- |
| **`enabled`** | Master switch for liquidity-engine behavior (default **false**). Examples often set **`true`**. |
| **`useLegacyCancelAllRefresh`** | **`true`** → refresh by **cancel all** then replace (**legacy**). **`false`** → refresh using **target book vs open orders** diff when enabled (default **true**). |
| **`edge.enforce`** | If edge checks **block** bad quotes when on (default **false**). |
| **`edge.shadowOnly`** | Log edge failures without blocking (default **false**). |
| **`edge.lambdaSigma`** | Weight for sigma-style edge term (default **0**). |
| **`edge.minEdgeBpsFloor`** | Minimum edge in **basis points** before acting (default **0**). |
| **`portfolio.enforceGlobal`** | When on with portfolio rules, enforce **global** gross limits (default **false**). |
| **`portfolio.betaCapEnabled`** | Scale caps using **beta vs a reference asset** (default **false**). |
| **`portfolio.betaToRef`** | Map **`"SYMBOL"` → β** vs reference (e.g. BTC); missing symbols treated as **β = 1**. |
| **`regimeSplit.enabled`** | Split regime inputs (flow vs microstructure) when on (default **false**). |
| **`regimeSplit.toxicCombineMode`** | How to combine toxicity: **`any`**, **`flow_only`**, **`microstructure_only`**, **`both`** (default **`any`**). |
| **`twoLegSafety.enabled`** | Extra safety around **two-leg** placement when on (default **false**). |
| **`fairValue.mode`** | **`touch`** = bid/ask touch; **`microprice`** = microprice-style fair (default **`touch`**). |
| **`inventorySkew.enabled`** | Shift quotes based on inventory when on (default **false**). |
| **`inventorySkew.kappaTicks`** | Strength of skew in ticks (default **0**). |
| **`inventorySkew.maxShiftTicks`** | Optional cap on how far fair/mid can shift (ticks). |
| **`regimeFsm.enabled`** | Finite-state regime machine for spread widening when on (default **false**). |
| **`regimeFsm.hysteresisSamples`** | Samples needed before changing FSM state (default **3**). |
| **`regimeFsm.defensiveSpreadMult`**, **`reduceSpreadMult`**, **`pausedSpreadMult`** | Multiply minimum spread in defensive / reduce / paused states (defaults **1.25 / 1.5 / 2**). |
| **`regimeFsm.flowDefensiveThreshold`**, **`microDefensiveThreshold`** | Scores (0–1) at which flow/micro inputs push toward defensive (defaults **0.65 / 0.5**). |
| **`regimeFsm.inventoryReduceThreshold`** | Inventory pressure level (0–1) to move toward **reduce** style quoting (default **0.75**). |
| **`regimeFsm.flowOffThreshold`** | Flow score above which flow is treated as “off” / worst case (default **0.95**). |
| **`quoteTriggers.enabled`** | Debounced **re-quote triggers** from market-data hooks when on (default **false**). |
| **`quoteTriggers.epsilonTicks`** | Minimum price move in ticks to fire a trigger when enabled (default **1**). |

Full example shape: [`examples/testnet.json`](examples/testnet.json) (and other `examples/*.json`). OMS merge pattern: [`examples/liquidity-engine-oms-merge.example.json`](examples/liquidity-engine-oms-merge.example.json).

### Per-symbol overrides (`perSymbolOverrides[]`)

Each entry:

| Field | What it does (simple) |
| --- | --- |
| **`schemaVersion`** | Must be **`"1"`** for the entry. |
| **`symbol`** | Symbol name (e.g. **`BTCUSDT`**). |
| **`effectiveFrom`** | Optional ISO timestamp for **your own ops notes**; bootstrap spread resolution **does not** filter by this field today. |
| **`minSpreadTicks`** | Overrides **`risk.defaultMinSpreadTicks`** for the spread **floor** at bootstrap. The **last** array entry for that **`symbol`** with **`minSpreadTicks` set** wins. |

Example:

```json
{
  "configSchemaVersion": "1",
  "perSymbolOverrides": [
    {
      "schemaVersion": "1",
      "symbol": "BTCUSDT",
      "effectiveFrom": "2026-05-01T00:00:00.000Z",
      "minSpreadTicks": 6
    }
  ]
}
```

### Environment variables (override JSON)

| Variable | What it does |
| --- | --- |
| **`CONFIG_PATH`** | Path to your JSON file. |
| **`TRADING_ENV`** / **`APP_ENV`** | **`testnet`** or **`live`** — picks default Binance URLs before merge. |
| **`BINANCE_REST_BASE_URL`**, **`BINANCE_WS_BASE_URL`** | Override URLs after merge. |
| **`BINANCE_API_KEY`**, **`BINANCE_API_SECRET`** | API credentials (preferred over storing secrets in JSON). |
| **`LOG_LEVEL`** | Overrides **`logLevel`** in config. |

Never commit real keys. Use exports or your secret manager.

---

## High-impact fields (review before production)

These directly affect PnL and safety:

- **`risk.sessionLossCapQuote`**, **`risk.dailyLossCapQuote`**, **`risk.maxOpenNotionalQuote`**
- **`risk.maxAbsQty`**, **`risk.maxAbsNotional`**, **`risk.globalMaxAbsNotional`**, **`risk.haltUtilization`**
- **`symbols`**, **`features.*`**, **`quoting.*`**, **`credentialProfile`**, **`rollout.markoutPromotionWindowMs`**, **`heartbeat*`**, **`reconciliationIntervalMs`**

**Safe-ish:** a new **`perSymbolOverrides`** row with a future **`effectiveFrom`** and unchanged caps.

**Risky:** raising caps together with no testnet proof — the bot may run, but outcomes may not match intent.
