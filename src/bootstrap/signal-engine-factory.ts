import type { AppConfig } from "../config/schema.js";
import type { ClockPort } from "../application/ports/clock-port.js";
import type { LoggerPort } from "../application/ports/logger-port.js";
import { SignalEngine } from "../application/services/signal-engine.js";

export function createSignalEngineForSession(
  input: { readonly config: Pick<AppConfig, "risk">; readonly clock: ClockPort },
  log?: LoggerPort,
): SignalEngine {
  const r = input.config.risk;
  return new SignalEngine(
    {
      targetBucketVolume: r.vpinBucketVolume,
      basis: r.vpinBucketBasis,
      ewmaN: r.vpinEwmaN,
      staleFlushMs: r.vpinStaleFlushMs,
      rvEnabled: r.rvEnabled,
      rvTau: r.rvTau,
    },
    input.clock,
    log,
  );
}
