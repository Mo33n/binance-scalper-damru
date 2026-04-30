export interface SnapshotEmitter {
  emitSnapshot(): void;
}

export class SnapshotScheduler {
  private timer: ReturnType<typeof setInterval> | undefined;

  startEvery60s(emitter: SnapshotEmitter): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => {
      emitter.emitSnapshot();
    }, 60_000);
  }

  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
