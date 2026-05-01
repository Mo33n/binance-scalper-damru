import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { FillEvent } from "../../infrastructure/binance/user-stream.js";
import type { TradingSession } from "../../bootstrap/trading-session-types.js";
import { buildWorkerBootstrapPayload } from "../messaging/worker-bootstrap.js";
import { serializeEnvelope } from "../messaging/envelope.js";
import type { SupervisorCommand } from "../messaging/types.js";
import type { SymbolRunnerHandle, SymbolRunnerPort } from "./symbol-runner.js";

/**
 * Production: `dist/.../symbol-worker.js` (tsc output).
 * Dev (`tsx` / Vitest): `symbol-worker-entry.mjs` calls `tsx/esm/api` `register()` then dynamic-imports
 * `symbol-worker.ts` so `.js` import specifiers resolve like the main thread.
 */
function symbolWorkerEntryUrl(): URL {
  const parentPath = fileURLToPath(import.meta.url);
  const name = parentPath.endsWith(".ts") ? "./symbol-worker-entry.mjs" : "./symbol-worker.js";
  return new URL(name, import.meta.url);
}

export interface WorkerSymbolRunnerPortDeps {
  readonly session: TradingSession;
  /** RFC X3 — parent REST seeds per symbol (optional). */
  readonly positionSeeds?: ReadonlyMap<string, { readonly netQty: number; readonly markPrice: number }>;
}

/**
 * SPEC-08 — `SymbolRunnerPort` backed by `worker_threads` (payload has no API secrets).
 */
export class WorkerSymbolRunnerPort implements SymbolRunnerPort {
  private readonly deps: WorkerSymbolRunnerPortDeps;
  private readonly workers = new Map<string, Worker>();
  private readonly handles = new Map<string, SymbolRunnerHandle>();

  constructor(deps: WorkerSymbolRunnerPortDeps) {
    this.deps = deps;
  }

  relayLedgerFill(fill: FillEvent): void {
    const w = this.workers.get(fill.symbol);
    if (w === undefined) return;
    w.postMessage(
      serializeEnvelope({
        v: 1,
        kind: "ledger_fill",
        payload: fill,
      }),
    );
  }

  startSymbolRunner(input: {
    symbol: string;
    workerId: string;
    onMessage(raw: string): void;
    onExit(): void;
  }): SymbolRunnerHandle {
    const sym = input.symbol;
    const existing = this.handles.get(sym);
    if (existing !== undefined) return existing;

    const spec = this.deps.session.bootstrap.symbols.find((s) => s.symbol === sym);
    if (spec === undefined) {
      throw new Error(`WorkerSymbolRunnerPort: missing SymbolSpec for ${sym}`);
    }

    const seed = this.deps.positionSeeds?.get(sym);
    const payload = buildWorkerBootstrapPayload({
      workerId: input.workerId,
      symbol: sym,
      spec,
      sessionConfig: this.deps.session.config,
      fees: this.deps.session.bootstrap.fees,
      decisions: this.deps.session.bootstrap.decisions,
      ...(seed !== undefined ? { initialPosition: seed } : {}),
    });

    const workerUrl = symbolWorkerEntryUrl();
    const sab = this.deps.session.depthGateSharedBuffer;
    const workerData: { payload: unknown; depthGateSab?: SharedArrayBuffer } = { payload };
    if (sab !== undefined) {
      workerData.depthGateSab = sab;
    }
    const worker = new Worker(workerUrl, {
      workerData,
    });

    worker.on("message", (data: unknown) => {
      input.onMessage(String(data));
    });

    worker.once("exit", () => {
      this.workers.delete(sym);
      this.handles.delete(sym);
      input.onExit();
    });

    this.workers.set(sym, worker);

    const handle: SymbolRunnerHandle = {
      workerId: input.workerId,
      symbol: sym,
      stop: async () => {
        await this.stopWorker(sym);
      },
      sendCommand: (cmd: SupervisorCommand) => {
        worker.postMessage(
          serializeEnvelope({
            v: 1,
            kind: "supervisor_cmd",
            payload: cmd,
          }),
        );
      },
    };
    this.handles.set(sym, handle);
    return handle;
  }

  private async stopWorker(symbol: string): Promise<void> {
    const w = this.workers.get(symbol);
    if (w === undefined) {
      this.handles.delete(symbol);
      return;
    }

    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        w.removeListener("exit", onExitWait);
        void w.terminate();
        resolve();
      }, 15_000);

      const onExitWait = (): void => {
        clearTimeout(t);
        resolve();
      };

      w.once("exit", onExitWait);
      w.postMessage(
        serializeEnvelope({
          v: 1,
          kind: "request_shutdown",
          payload: { workerId: `w-${symbol}`, symbol, reason: "supervisor_stop" },
        }),
      );
    });

    this.workers.delete(symbol);
    this.handles.delete(symbol);
  }
}
