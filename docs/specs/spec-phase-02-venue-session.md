# SPEC-02 — Venue session: REST client, credentials, trading mode (technical)

**Phase:** 02  
**Prerequisites:** SPEC-01 merged (`TradingSessionBootstrap` exists).

---

## 1. Purpose

Construct **one shared** `BinanceRestClient` and optional **`ExecutionService`** after bootstrap; classify **`TradingMode`**; add **`--dry-run`** and **`features.liveQuotingEnabled`** gates; document **`ExchangePort`** vs execution split.

---

## 2. Configuration schema (normative)

**File:** `src/config/schema.ts`

Extend `featuresSchema`:

```typescript
liveQuotingEnabled: z.boolean().default(false),
```

**Rules:**

- Default MUST be `false` for all environments.
- MUST appear explicitly in every file under `config/examples/` for reviewer visibility (set `false` unless file is clearly “danger” example).

**File:** `config/README.md` MUST document: meaning, when to enable, owner (Quant/Ops).

---

## 3. CLI

**Parse in:** `src/bootstrap/run-trader.ts` or tiny `src/bootstrap/argv.ts`

| Flag | Semantics |
|------|-----------|
| `--dry-run` | Forces **read-only**: MUST NOT instantiate `ExecutionService` nor call order endpoints from orchestration (even if keys + flag true). |

**Help text:** Update `src/main.ts` help string to include `--dry-run`.

---

## 4. Data model

**File:** `src/bootstrap/venue-types.ts` (new)

```typescript
import type { BinanceRestClient } from "../infrastructure/binance/rest-client.js";
import type { ExecutionService } from "../application/services/execution-service.js";

export type TradingMode = "read_only" | "order_capable";

export interface TradingVenueHandles {
  readonly rest: BinanceRestClient;
  readonly execution: ExecutionService | undefined;
  readonly mode: TradingMode;
  /** Stable enum-like strings for logs only — no PII. */
  readonly modeReasons: readonly ("no_credentials" | "dry_run" | "live_quoting_disabled" | "ready")[];
}
```

---

## 5. Factory API

**File:** `src/bootstrap/venue-factory.ts` (new)

```typescript
import type { AppConfig } from "../config/schema.js";
import type { LoggerPort } from "../application/ports/logger-port.js";
import type { TradingVenueHandles } from "./venue-types.js";

export function createTradingVenueHandles(input: {
  readonly cfg: AppConfig;
  readonly log: LoggerPort;
  readonly argv: readonly string[];
}): TradingVenueHandles;
```

### 5.1 Algorithm `createTradingVenueHandles`

1. `rest = new BinanceRestClient({ baseUrl: cfg.binance.restBaseUrl, log })`.

2. Let `hasCreds = Boolean(cfg.credentials.apiKey && cfg.credentials.apiSecret)` (exact property paths MUST match `AppConfig`).

3. Initialize `reasons: modeReasons[] = []`.

4. If `!hasCreds`: `reasons.push("no_credentials")`; `execution = undefined`; `mode = "read_only"`.

5. Else if `argv.includes("--dry-run")`: `reasons.push("dry_run")`; `execution = undefined`; `mode = "read_only"`.

6. Else if `!cfg.features.liveQuotingEnabled`: `reasons.push("live_quoting_disabled")`; `execution = undefined`; `mode = "read_only"`.

7. Else: build `SignedCredentials` exactly as used elsewhere (`apiKey`, `apiSecret` strings); `execution = new ExecutionService(rest, creds, undefined, log)` (match constructor arity from `execution-service.ts`); `reasons.push("ready")`; `mode = "order_capable"`.

8. Log once:

```typescript
log.info({ event: "trading.mode", mode, reasons: [...reasons] }, "trading.mode.selected");
```

---

## 6. `ExchangePort` ADR (normative comment)

**File:** `src/application/ports/exchange-port.ts`

Append block comment:

- **Decision:** Order placement/cancel remains **`ExecutionService` + `BinanceRestClient`** on the integration path through MVP.
- **`ExchangePort`** MAY remain minimal (`environment` only) for stub/bootstrap compat OR gain **`readonly tag: "stub" | "live"`** later — MUST NOT duplicate execution methods until simulator implements full façade.

---

## 7. Session aggregation type

**File:** `src/bootstrap/trading-session-types.ts` — extend:

```typescript
import type { TradingVenueHandles } from "./venue-types.js";

export interface TradingSession extends TradingSessionBootstrap {
  readonly venue: TradingVenueHandles;
}
```

**Wire in `runTrader`:** After SPEC-01 bootstrap success:

```typescript
const venue = createTradingVenueHandles({ cfg: session.config, log: session.log, argv });
const full: TradingSession = { ...session, venue };
await continueTradingSession(full); // placeholder until SPEC-03
```

---

## 8. Security

- MUST NOT log API keys or secrets.
- Run `npm run verify:secrets` before merge; update `scripts/verify-secrets.mjs` if new sensitive literals introduced.

---

## 9. Test specification

| ID | Given | Then |
|----|-------|------|
| T01 | no credentials | `mode === "read_only"`, `reasons` contains `no_credentials` |
| T02 | creds + `--dry-run` | read_only, `dry_run` |
| T03 | creds + `liveQuotingEnabled: false` | read_only, `live_quoting_disabled` |
| T04 | creds + flag true + no dry-run | `order_capable`, `execution` defined |

---

## 10. Definition of Done

- [ ] Schema + examples + README updated
- [ ] Help lists `--dry-run`
- [ ] Exactly one `trading.mode` info log per process start (post-bootstrap)

---

## 11. Handoff to SPEC-03

`TradingSession` MUST be passed into runner factory; `venue.execution` MAY be `undefined` — runner MUST tolerate.
