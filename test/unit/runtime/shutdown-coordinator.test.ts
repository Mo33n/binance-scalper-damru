import { describe, expect, it, vi } from "vitest";
import type { LoggerPort } from "../../../src/application/ports/logger-port.js";
import type { Supervisor } from "../../../src/runtime/supervisor/supervisor.js";
import type { SnapshotScheduler } from "../../../src/runtime/supervisor/snapshot-scheduler.js";
import type { TimerRegistry } from "../../../src/runtime/timer-registry.js";
import { shutdownTradingProcess } from "../../../src/runtime/shutdown-coordinator.js";

function silentLog(): LoggerPort {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child(): LoggerPort {
      return silentLog();
    },
  };
}

describe("shutdownTradingProcess (SPEC-07 T02 / SPEC-09 timer registry)", () => {
  it("runs HALT broadcast → timerRegistry.clearAll → stopAll → user stream → snapshot → dev dispose", async () => {
    const order: string[] = [];

    const broadcast = vi.fn(() => {
      order.push("broadcast");
    });
    const stopAll = vi.fn(() => {
      order.push("stopAll");
      return Promise.resolve();
    });
    const supervisor = { broadcast, stopAll } as unknown as Supervisor;

    const userStop = vi.fn(() => {
      order.push("userStream.stop");
      return Promise.resolve();
    });

    const snapshotScheduler = {
      stop: vi.fn(() => {
        order.push("snapshot.stop");
      }),
    } as unknown as SnapshotScheduler;

    const clearAll = vi.fn(() => {
      order.push("timerRegistry.clearAll");
    });
    const timerRegistry = { clearAll } as unknown as TimerRegistry;

    const dispose = vi.fn(() => {
      order.push("dev.dispose");
    });

    await shutdownTradingProcess({
      supervisor,
      timerRegistry,
      userStream: { stop: userStop },
      snapshotScheduler,
      devKeepAlive: { dispose },
      log: silentLog(),
    });

    expect(order).toEqual([
      "broadcast",
      "timerRegistry.clearAll",
      "stopAll",
      "userStream.stop",
      "snapshot.stop",
      "dev.dispose",
    ]);
    expect(broadcast).toHaveBeenCalledWith({ type: "HALT_QUOTING", reason: "shutdown" });
  });
});
