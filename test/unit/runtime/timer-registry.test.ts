import { afterEach, describe, expect, it, vi } from "vitest";
import { TimerRegistry } from "../../../src/runtime/timer-registry.js";

describe("TimerRegistry (SPEC-09 T02)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clearAll stops registered intervals", () => {
    vi.useFakeTimers();
    let ticks = 0;
    const registry = new TimerRegistry();
    const id = setInterval(() => {
      ticks += 1;
    }, 1000);
    registry.register("t", id);
    vi.advanceTimersByTime(2500);
    expect(ticks).toBe(2);
    registry.clearAll();
    vi.advanceTimersByTime(5000);
    expect(ticks).toBe(2);
  });
});
