import type { LoggerPort } from "../ports/logger-port.js";
import type { FillEvent } from "../../infrastructure/binance/user-stream.js";
import { applyFillToPosition, computeInventorySkew, type PositionState } from "../../domain/risk/inventory.js";

export interface PositionLedgerConfig {
  readonly maxAbsQty: number;
  readonly maxAbsNotional: number;
  readonly globalMaxAbsNotional: number;
  readonly inventoryEpsilon: number;
  readonly maxTimeAboveEpsilonMs: number;
}

export type InventoryStressLevel = "none" | "breach";

export class PositionLedger {
  private readonly cfg: PositionLedgerConfig;
  private readonly log: LoggerPort | undefined;
  private readonly positions = new Map<string, PositionState>();
  private readonly seenFills = new Set<string>();
  private readonly fillListeners = new Set<(fill: FillEvent) => void>();
  private readonly aboveEpsilonSince = new Map<string, number>();
  private globalNotional = 0;

  constructor(cfg: PositionLedgerConfig, log?: LoggerPort) {
    this.cfg = cfg;
    this.log = log;
  }

  /** SPEC-09 — invoked once per deduped fill after ledger mutation (e.g. markout). */
  registerFillListener(listener: (fill: FillEvent) => void): void {
    this.fillListeners.add(listener);
  }

  applyFill(fill: FillEvent, nowMs: number): void {
    const key = `${fill.symbol}:${String(fill.orderId)}:${String(fill.tradeId)}`;
    if (this.seenFills.has(key)) return;
    this.seenFills.add(key);

    const prev = this.positions.get(fill.symbol) ?? { netQty: 0 };
    const next = applyFillToPosition(prev, {
      side: fill.side,
      quantity: fill.quantity,
      price: fill.price,
    });
    this.positions.set(fill.symbol, next);
    this.globalNotional = this.computeGlobalNotional(fill.price);

    if (Math.abs(next.netQty) > this.cfg.inventoryEpsilon) {
      if (!this.aboveEpsilonSince.has(fill.symbol)) this.aboveEpsilonSince.set(fill.symbol, nowMs);
    } else {
      this.aboveEpsilonSince.delete(fill.symbol);
    }

    for (const fn of this.fillListeners) {
      try {
        fn(fill);
      } catch {
        this.log?.warn({ event: "ledger.fill_listener_error", symbol: fill.symbol }, "ledger.fill_listener_error");
      }
    }
  }

  getPosition(symbol: string): PositionState {
    return this.positions.get(symbol) ?? { netQty: 0 };
  }

  getStressLevel(symbol: string, markPrice: number, nowMs: number): InventoryStressLevel {
    const pos = this.getPosition(symbol);
    const absQty = Math.abs(pos.netQty);
    const absNotional = absQty * markPrice;
    if (absQty > this.cfg.maxAbsQty || absNotional > this.cfg.maxAbsNotional) {
      this.log?.warn({ event: "risk.limit_breach", symbol, metric: "symbol_limit" }, "risk.limit_breach");
      return "breach";
    }
    if (this.globalNotional > this.cfg.globalMaxAbsNotional) {
      this.log?.warn({ event: "risk.limit_breach", symbol, metric: "global_notional" }, "risk.limit_breach");
      return "breach";
    }
    const since = this.aboveEpsilonSince.get(symbol);
    if (since !== undefined && nowMs - since > this.cfg.maxTimeAboveEpsilonMs) {
      this.log?.warn({ event: "risk.limit_breach", symbol, metric: "time_at_risk" }, "risk.limit_breach");
      return "breach";
    }
    return "none";
  }

  getSkew(symbol: string) {
    const pos = this.getPosition(symbol);
    return computeInventorySkew(pos.netQty, this.cfg.maxAbsQty);
  }

  private computeGlobalNotional(markPrice: number): number {
    let total = 0;
    for (const p of this.positions.values()) total += Math.abs(p.netQty) * markPrice;
    return total;
  }
}
