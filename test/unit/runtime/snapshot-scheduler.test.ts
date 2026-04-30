import { describe, expect, it, vi } from "vitest";
import { SnapshotScheduler } from "../../../src/runtime/supervisor/snapshot-scheduler.js";

describe("SnapshotScheduler", () => {
  it("emits exactly once per 60s with fake timers", () => {
    vi.useFakeTimers();
    const scheduler = new SnapshotScheduler();
    const emitter = { emitSnapshot: vi.fn() };
    scheduler.startEvery60s(emitter);
    vi.advanceTimersByTime(59_999);
    expect(emitter.emitSnapshot).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(1);
    expect(emitter.emitSnapshot).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(emitter.emitSnapshot).toHaveBeenCalledTimes(2);
    scheduler.stop();
    vi.useRealTimers();
  });
});
