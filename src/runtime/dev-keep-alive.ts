import type { LoggerPort } from "../application/ports/logger-port.js";
import type { TimerRegistryPort } from "../application/ports/timer-registry-port.js";
import type { AppConfig } from "../config/schema.js";

const STAY_ALIVE_ENV = "DAMRU_STAY_ALIVE";

export interface DevKeepAliveHandle {
  dispose(): void;
}

/**
 * Dev-only: keep the Node process alive after bootstrap so local runs behave like a daemon.
 * Enable with `--stay-alive` or `DAMRU_STAY_ALIVE=1` (also `true` / `yes`).
 */
export function shouldAttachDevKeepAlive(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (argv.includes("--stay-alive")) return true;
  const v = env[STAY_ALIVE_ENV]?.toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * When `registerSignalHandlers` is false (SPEC-07 main trader path), the caller owns SIGINT/SIGTERM
 * and must invoke `dispose()` during graceful shutdown — single signal registration policy.
 */
export function attachDevKeepAlive(
  log: LoggerPort,
  config: AppConfig,
  options?: { readonly registerSignalHandlers?: boolean; readonly timerRegistry?: TimerRegistryPort },
): DevKeepAliveHandle {
  const intervalMs = config.heartbeatIntervalMs;
  log.info({ event: "startup.dev_keep_alive", intervalMs }, "dev.keep_alive.started");

  const id = setInterval(() => {
    log.debug({ event: "runtime.dev_pulse" }, "dev.keep_alive.pulse");
  }, intervalMs);
  options?.timerRegistry?.register("dev_keep_alive_pulse", id);

  const stopPulse = () => {
    clearInterval(id);
  };

  if (options?.registerSignalHandlers !== false) {
    const shutdown = (signal: NodeJS.Signals) => {
      stopPulse();
      log.info({ event: "startup.dev_shutdown", signal }, "dev.keep_alive.stopped");
      process.exit(0);
    };
    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
  }

  return {
    dispose: () => {
      stopPulse();
      log.info({ event: "startup.dev_shutdown" }, "dev.keep_alive.stopped");
    },
  };
}
