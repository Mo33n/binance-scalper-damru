import type { TimerRegistryPort } from "../../application/ports/timer-registry-port.js";

export interface SnapshotEmitter {
  emitSnapshot(): void;
}

export class SnapshotScheduler {
  private timer: ReturnType<typeof setInterval> | undefined;

  startEvery60s(emitter: SnapshotEmitter, timerRegistry?: TimerRegistryPort): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => {
      emitter.emitSnapshot();
    }, 60_000);
    timerRegistry?.register("portfolio_snapshot_60s", this.timer);
  }

  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
