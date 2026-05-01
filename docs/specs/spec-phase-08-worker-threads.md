# SPEC-08 — Worker thread isolation (technical)

**Phase:** 08  
**Prerequisites:** SPEC-07 (supervisor + shutdown stable).

---

## 1. Purpose

Move per-symbol loop to **`worker_threads.Worker`** while supervisor stays on main thread. Preserve **`SymbolRunnerPort`** contract.

---

## 2. Security model (normative)

**Credentials:** Workers MUST inherit **`process.env`** containing `BINANCE_API_KEY` / `BINANCE_API_SECRET` OR receive **no secrets in postMessage** — **preferred:** env inheritance only; document in README.

---

## 3. Serializable payload

**File:** `src/runtime/messaging/worker-bootstrap.ts` (new)

```typescript
export const WORKER_BOOTSTRAP_V = 1 as const;

export interface WorkerBootstrapPayloadV1 {
  readonly v: typeof WORKER_BOOTSTRAP_V;
  readonly workerId: string;
  readonly symbol: string;
  readonly spec: SymbolSpec; // JSON-serializable subset — strip functions
  readonly configSubset: {
    readonly binance: AppConfig["binance"];
    readonly risk: AppConfig["risk"];
    readonly quoting: AppConfig["quoting"];
    readonly features: AppConfig["features"];
    readonly heartbeatIntervalMs: number;
    readonly logLevel: AppConfig["logLevel"];
    readonly environment: AppConfig["environment"];
  };
}
```

**Rule:** `SymbolSpec` MUST be validated at runtime in worker with **zod** duplicate schema OR `JSON.parse(JSON.stringify(spec))` round-trip only if already plain data.

---

## 4. Worker entry

**File:** `src/runtime/worker/symbol-worker.ts`

```typescript
import { workerData, parentPort } from "node:worker_threads";
```

**Algorithm:**

1. Assert `workerData.payload.v === 1`.

2. Reconstruct logger (new Pino destination — sync stderr acceptable).

3. Reconstruct `BinanceRestClient`, optional `ExecutionService` **using env credentials** + `payload.configSubset`.

4. Run **same** internal loop as main-thread runner (extract shared **`runSymbolLoop(deps)`** function into `symbol-loop.ts` used by both).

5. `parentPort.postMessage(stringSerializedEnvelope)` for heartbeat/metrics/fatal.

6. `parentPort.on("message")` accepts **supervisor commands** as serialized envelopes `kind: "supervisor_cmd"`.

---

## 5. Parent adapter

**File:** `src/runtime/worker/worker-symbol-runner-port.ts`

Implements `SymbolRunnerPort`:

- `new Worker(new URL("./symbol-worker.js", import.meta.url), { workerData: { payload } })` — **use `.js`** extension for emitted output path compatibility.

- Map worker `message` event → `onMessage(String(data))`.

- `worker.on("exit", ...)` → `onExit()`.

---

## 6. Supervisor integration

Replace `MainThreadSymbolRunnerPort` with `WorkerSymbolRunnerPort` behind config flag:

```typescript
features.useWorkerThreads: z.boolean().default(false),
```

**Rollout:** default `false` until stable; then `true`.

---

## 7. Test specification

| ID | Case | Assert |
|----|------|--------|
| T01 | round-trip heartbeat | envelope parses |
| T02 | worker throws | exit code non-zero + cancelAll |
| T03 | shutdown | worker terminates |

Vitest MAY need `poolOptions: { threads: { singleThread: true } }` for worker tests — document flakiness fix.

---

## 8. Definition of Done

- [ ] No secrets in `postMessage` payloads
- [ ] README debugging worker section

---

## 9. Handoff to SPEC-09

Expose metric deltas through same envelopes for rate limit / loss guard counters.
