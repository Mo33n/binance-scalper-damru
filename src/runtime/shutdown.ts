import type { Supervisor } from "./supervisor/supervisor.js";
import type { OrderActionContext } from "../application/services/execution-service.js";

export interface ShutdownDeps {
  readonly supervisor: Supervisor;
  readonly cancelAllForSymbol: (symbol: string, ctx?: OrderActionContext) => Promise<void>;
  readonly symbols: () => readonly string[];
}

export function createGracefulShutdown(deps: ShutdownDeps): () => Promise<void> {
  let inFlight: Promise<void> | undefined;
  return async () => {
    if (inFlight !== undefined) return inFlight;
    inFlight = (async () => {
      deps.supervisor.broadcast({ type: "HALT_QUOTING", reason: "shutdown" });
      for (const symbol of deps.symbols()) {
        await deps.cancelAllForSymbol(symbol, { reason: "graceful_shutdown" });
      }
      await deps.supervisor.stopAll();
    })();
    await inFlight;
  };
}
