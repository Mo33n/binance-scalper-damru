import { describe, it, expect } from "vitest";
import {
  DepthSnapshotConcurrencyGate,
  SharedDepthSnapshotGate,
  allocateDepthGateSharedBuffer,
} from "../../../src/infrastructure/binance/depth-snapshot-gate.js";

describe("DepthSnapshotConcurrencyGate", () => {
  it("never exceeds max concurrent holders", async () => {
    const gate = new DepthSnapshotConcurrencyGate(4);
    let peak = 0;
    let active = 0;
    const run = async (): Promise<void> => {
      await gate.runExclusive(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
      });
    };
    await Promise.all(Array.from({ length: 12 }, run));
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("spaces concurrent snapshot starts by minIntervalMs", async () => {
    const gate = new DepthSnapshotConcurrencyGate(4, 60);
    const starts: number[] = [];
    const task = async (): Promise<void> => {
      await gate.runExclusive(async () => {
        starts.push(Date.now());
        await new Promise((r) => setTimeout(r, 5));
      });
    };
    await Promise.all([task(), task()]);
    starts.sort((a, b) => a - b);
    expect(starts.length).toBe(2);
    const first = starts[0];
    const second = starts[1];
    if (first === undefined || second === undefined) {
      throw new Error("expected two start timestamps");
    }
    expect(second - first).toBeGreaterThanOrEqual(55);
  });
});

describe("SharedDepthSnapshotGate", () => {
  it("rejects SharedArrayBuffer shorter than lock layout", () => {
    const sab = new SharedArrayBuffer(8);
    expect(() => new SharedDepthSnapshotGate(sab, 0)).toThrow(/at least/);
  });

  it("accepts buffer from allocateDepthGateSharedBuffer", () => {
    const sab = allocateDepthGateSharedBuffer();
    expect(() => new SharedDepthSnapshotGate(sab, 0)).not.toThrow();
  });

  // Cross-thread behavior (Atomics.wait) is covered by worker deployment; parallel runExclusive
  // on the Node main thread deadlocks if the holder awaits — do not call from main.
});
