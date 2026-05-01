import type { LoggerPort } from "../../application/ports/logger-port.js";
import type { OrderActionContext } from "../../application/services/execution-service.js";
import type { PortfolioSnapshot, PortfolioSnapshotLine, StatsSink } from "../../application/ports/stats-sink.js";
import type { LossGuard } from "../../application/services/loss-guard.js";
import { PnlService } from "../../application/services/pnl-service.js";
import { parseEnvelope } from "../messaging/envelope.js";
import type {
  HaltRequestPayload,
  HeartbeatPayload,
  MetricDeltaPayload,
  SupervisorCommand,
} from "../messaging/types.js";
import type { SymbolRunnerHandle, SymbolRunnerPort } from "../worker/symbol-runner.js";

interface SymbolMetrics {
  symbol: string;
  quoteVolume: number;
  netPnlQuote: number;
  feesQuote: number;
  fundingQuote: number;
  disconnects: number;
  lastError?: string;
}

export interface SupervisorConfig {
  readonly heartbeatIntervalMs: number;
  readonly heartbeatMissThreshold: number;
}

export interface SupervisorDeps {
  readonly runners: SymbolRunnerPort;
  readonly statsSink: StatsSink;
  readonly nowUtcIso: () => string;
  readonly monotonicNowMs: () => number;
  readonly cancelAllForSymbol: (symbol: string, ctx?: OrderActionContext) => Promise<void>;
  readonly log?: LoggerPort;
  /** SPEC-09 — portfolio PnL after each metric delta; trip → `HALT_QUOTING` `session_loss_cap`. */
  readonly lossGuard?: LossGuard;
}

export class Supervisor {
  private readonly cfg: SupervisorConfig;
  private readonly deps: SupervisorDeps;
  private readonly pnl = new PnlService();
  private readonly handles = new Map<string, SymbolRunnerHandle>();
  private readonly lastHeartbeat = new Map<string, number>();
  private readonly metrics = new Map<string, SymbolMetrics>();
  private readonly haltedReasons = new Set<string>();

  constructor(cfg: SupervisorConfig, deps: SupervisorDeps) {
    this.cfg = cfg;
    this.deps = deps;
  }

  startSymbols(symbols: readonly string[]): void {
    for (const symbol of symbols) {
      if (this.handles.has(symbol)) continue;
      const workerId = `w-${symbol}`;
      const handle = this.deps.runners.startSymbolRunner({
        symbol,
        workerId,
        onMessage: (raw) => {
          this.ingestRawMessage(raw);
        },
        onExit: () => {
          void this.onWorkerExit(symbol);
        },
      });
      this.handles.set(symbol, handle);
      this.lastHeartbeat.set(symbol, this.deps.monotonicNowMs());
      this.metrics.set(symbol, {
        symbol,
        quoteVolume: 0,
        netPnlQuote: 0,
        feesQuote: 0,
        fundingQuote: 0,
        disconnects: 0,
      });
    }
  }

  async stopAll(): Promise<void> {
    const stops = [...this.handles.values()].map((h) => h.stop());
    await Promise.all(stops);
    this.handles.clear();
  }

  ingestRawMessage(raw: string): void {
    try {
      const env = parseEnvelope(raw);
      if (env.kind === "heartbeat") {
        this.onHeartbeat(env.payload as HeartbeatPayload);
        return;
      }
      if (env.kind === "metric_delta") {
        this.onMetricDelta(env.payload as MetricDeltaPayload);
        return;
      }
      if (env.kind === "halt_request") {
        const p = env.payload as HaltRequestPayload;
        this.haltQuotingForSymbol(p.symbol, p.reason);
        return;
      }
      if (env.kind === "worker_fatal") {
        const payload = env.payload as { symbol?: string; errorMessage?: string };
        if (payload.symbol !== undefined && payload.errorMessage !== undefined) {
          this.recordError(payload.symbol, payload.errorMessage);
        }
      }
    } catch (error) {
      this.deps.log?.warn({ event: "ipc.message_dropped", raw }, "ipc.message_dropped");
      this.deps.log?.warn({ event: "ipc.parse_error", error: String(error) }, "ipc.parse_error");
    }
  }

  async checkHeartbeats(): Promise<void> {
    const now = this.deps.monotonicNowMs();
    const maxGap = this.cfg.heartbeatIntervalMs * this.cfg.heartbeatMissThreshold;
    for (const [symbol, last] of this.lastHeartbeat.entries()) {
      if (now - last <= maxGap) continue;
      await this.deps.cancelAllForSymbol(symbol, { reason: "heartbeat_worker_dead" });
      this.lastHeartbeat.set(symbol, now);
      this.deps.log?.error({ event: "worker.dead_detected", symbol }, "worker.dead_detected");
    }
  }

  /**
   * Portfolio-wide halt (loss cap, shutdown, etc.). Dedupes once per reason across all runners.
   */
  broadcast(command: SupervisorCommand): void {
    if (command.type === "HALT_QUOTING") {
      const key = `${command.type}::portfolio::${command.reason}`;
      if (this.haltedReasons.has(key)) return;
      this.haltedReasons.add(key);
    }
    for (const h of this.handles.values()) h.sendCommand(command);
  }

  /**
   * Quoting halt for one symbol only (regime trips, reconcile drift). Dedupes per (symbol, reason).
   */
  haltQuotingForSymbol(symbol: string, reason: string): void {
    const key = `${symbol}::HALT_QUOTING::${reason}`;
    if (this.haltedReasons.has(key)) return;
    this.haltedReasons.add(key);
    const h = this.handles.get(symbol);
    if (h !== undefined) {
      h.sendCommand({ type: "HALT_QUOTING", reason });
    }
  }

  emitSnapshot(): PortfolioSnapshot {
    const lines: PortfolioSnapshotLine[] = [];
    let portfolioVolumeQuote = 0;
    let portfolioNetPnlQuote = 0;

    for (const item of this.metrics.values()) {
      const netPnl = this.pnl.computeNetQuote({
        realizedQuote: item.netPnlQuote,
        feesQuote: item.feesQuote,
        fundingQuote: item.fundingQuote,
      });
      lines.push({
        symbol: item.symbol,
        quoteVolume: item.quoteVolume,
        netPnlQuote: netPnl,
      });
      portfolioVolumeQuote += item.quoteVolume;
      portfolioNetPnlQuote += netPnl;
    }

    const snapshot: PortfolioSnapshot = {
      emittedAtUtcIso: this.deps.nowUtcIso(),
      portfolioVolumeQuote,
      portfolioNetPnlQuote,
      lines,
    };
    this.deps.statsSink.emitSnapshot(snapshot);
    return snapshot;
  }

  private onHeartbeat(payload: HeartbeatPayload): void {
    this.lastHeartbeat.set(payload.symbol, this.deps.monotonicNowMs());
  }

  private onMetricDelta(payload: MetricDeltaPayload): void {
    const m = this.metrics.get(payload.symbol);
    if (m === undefined) return;
    m.quoteVolume += payload.quoteVolumeDelta ?? 0;
    m.netPnlQuote += payload.pnlDeltaQuote ?? 0;
    m.feesQuote += payload.feesDeltaQuote ?? 0;
    m.fundingQuote += payload.fundingDeltaQuote ?? 0;
    m.disconnects += payload.disconnectsDelta ?? 0;
    if (payload.errorMessage !== undefined) {
      this.recordError(payload.symbol, payload.errorMessage);
    }
    this.evaluateLossGuardAfterMetrics();
  }

  private computePortfolioNetPnlQuote(): number {
    let portfolioNetPnlQuote = 0;
    for (const item of this.metrics.values()) {
      portfolioNetPnlQuote += this.pnl.computeNetQuote({
        realizedQuote: item.netPnlQuote,
        feesQuote: item.feesQuote,
        fundingQuote: item.fundingQuote,
      });
    }
    return portfolioNetPnlQuote;
  }

  private evaluateLossGuardAfterMetrics(): void {
    const guard = this.deps.lossGuard;
    if (guard === undefined) return;
    const net = this.computePortfolioNetPnlQuote();
    const nowMs = this.deps.monotonicNowMs();
    const state = guard.evaluate({
      sessionPnlQuote: net,
      dailyPnlQuote: net,
      nowMs,
    });
    if (state === "halted") {
      this.broadcast({ type: "HALT_QUOTING", reason: "session_loss_cap" });
    }
  }

  private recordError(symbol: string, message: string): void {
    const m = this.metrics.get(symbol);
    if (m === undefined) return;
    m.lastError = message.slice(0, 160);
  }

  private async onWorkerExit(symbol: string): Promise<void> {
    await this.deps.cancelAllForSymbol(symbol, { reason: "worker_thread_exit" });
    this.deps.log?.error({ event: "worker.exit", symbol }, "worker.exit");
  }
}
