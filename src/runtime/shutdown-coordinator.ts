import type { LoggerPort } from "../application/ports/logger-port.js";
import type { Supervisor } from "./supervisor/supervisor.js";
import type { SnapshotScheduler } from "./supervisor/snapshot-scheduler.js";
import type { TimerRegistry } from "./timer-registry.js";

/** Narrow port so runtime shutdown does not depend on application wiring details. */
export interface UserStreamLifecycle {
  stop(): Promise<void>;
}

export interface DevKeepAliveDisposable {
  dispose(): void;
}

/**
 * SPEC-07 normative shutdown sequence (production SIGINT/SIGTERM path).
 * Caller should clear module-level handles after this resolves (or in `finally`).
 */
export async function shutdownTradingProcess(deps: {
  readonly supervisor: Supervisor;
  readonly timerRegistry: TimerRegistry;
  readonly userStream: UserStreamLifecycle | undefined;
  readonly snapshotScheduler: SnapshotScheduler | undefined;
  readonly devKeepAlive: DevKeepAliveDisposable | undefined;
  readonly log: LoggerPort;
}): Promise<void> {
  deps.supervisor.broadcast({ type: "HALT_QUOTING", reason: "shutdown" });
  deps.timerRegistry.clearAll();
  await deps.supervisor.stopAll();
  await deps.userStream?.stop();
  deps.snapshotScheduler?.stop();
  deps.devKeepAlive?.dispose();
  deps.log.info({ event: "shutdown.complete" }, "shutdown.complete");
}
