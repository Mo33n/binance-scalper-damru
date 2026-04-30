import type { Supervisor } from "./supervisor/supervisor.js";

export interface ShutdownDeps {
  readonly supervisor: Supervisor;
  readonly cancelAllForSymbol: (symbol: string) => Promise<void>;
  readonly symbols: () => readonly string[];
}

export function createGracefulShutdown(deps: ShutdownDeps): () => Promise<void> {
  let inFlight: Promise<void> | undefined;
  return async () => {
    if (inFlight !== undefined) return inFlight;
    inFlight = (async () => {
      deps.supervisor.broadcast({ type: "HALT_QUOTING", reason: "shutdown" });
      for (const symbol of deps.symbols()) {
        await deps.cancelAllForSymbol(symbol);
      }
      await deps.supervisor.stopAll();
    })();
    await inFlight;
  };
}
