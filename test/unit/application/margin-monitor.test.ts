import { describe, expect, it } from "vitest";
import { MarginMonitor } from "../../../src/application/services/margin-monitor.js";

describe("MarginMonitor", () => {
  it("transitions once and emits one alert per transition", () => {
    const calls: Array<{ level: string; code: string }> = [];
    const monitor = new MarginMonitor(
      {
        warnUtilization: 0.7,
        criticalUtilization: 0.85,
        haltUtilization: 0.95,
      },
      {
        alert(input) {
          calls.push({ level: input.level, code: input.code });
        },
      },
    );

    expect(monitor.evaluate({ utilization: 0.5, timestampMs: 1 })).toBe("normal");
    expect(monitor.evaluate({ utilization: 0.72, timestampMs: 2 })).toBe("warn");
    expect(monitor.evaluate({ utilization: 0.73, timestampMs: 3 })).toBe("warn");
    expect(monitor.evaluate({ utilization: 0.9, timestampMs: 4 })).toBe("critical");
    expect(monitor.evaluate({ utilization: 0.97, timestampMs: 5 })).toBe("halt");

    expect(calls).toEqual([
      { level: "warn", code: "margin_state_transition" },
      { level: "error", code: "margin_state_transition" },
      { level: "fatal", code: "margin_state_transition" },
    ]);
  });
});
