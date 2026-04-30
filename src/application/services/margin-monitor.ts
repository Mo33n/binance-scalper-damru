import type { LoggerPort } from "../ports/logger-port.js";

export interface MarginSnapshot {
  readonly utilization: number;
  readonly timestampMs: number;
}

export interface MarginMonitorConfig {
  readonly warnUtilization: number;
  readonly criticalUtilization: number;
  readonly haltUtilization: number;
}

export type MarginState = "normal" | "warn" | "critical" | "halt";

export interface AlertPort {
  alert(input: { level: "warn" | "error" | "fatal"; code: string; context: Record<string, unknown> }): void;
}

export class MarginMonitor {
  private readonly cfg: MarginMonitorConfig;
  private readonly alertPort: AlertPort;
  private readonly log: LoggerPort | undefined;
  private lastState: MarginState = "normal";

  constructor(cfg: MarginMonitorConfig, alertPort: AlertPort, log?: LoggerPort) {
    this.cfg = cfg;
    this.alertPort = alertPort;
    this.log = log;
  }

  evaluate(snapshot: MarginSnapshot): MarginState {
    const next = classifyUtilization(snapshot.utilization, this.cfg);
    if (next !== this.lastState) {
      const level = next === "halt" ? "fatal" : next === "critical" ? "error" : "warn";
      this.alertPort.alert({
        level,
        code: "margin_state_transition",
        context: { from: this.lastState, to: next, utilization: snapshot.utilization },
      });
      this.log?.warn(
        { event: "risk.margin_transition", from: this.lastState, to: next, utilization: snapshot.utilization },
        "risk.margin_transition",
      );
      this.lastState = next;
    }
    return this.lastState;
  }
}

function classifyUtilization(utilization: number, cfg: MarginMonitorConfig): MarginState {
  if (utilization >= cfg.haltUtilization) return "halt";
  if (utilization >= cfg.criticalUtilization) return "critical";
  if (utilization >= cfg.warnUtilization) return "warn";
  return "normal";
}
