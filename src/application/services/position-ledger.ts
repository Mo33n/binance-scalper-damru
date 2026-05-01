import type { LoggerPort } from "../ports/logger-port.js";
import type { FillEvent } from "../../infrastructure/binance/user-stream.js";
import { applyFillToPosition, computeInventorySkew, type PositionState } from "../../domain/risk/inventory.js";

export interface PositionLedgerConfig {
  readonly maxAbsQty: number;
  readonly maxAbsNotional: number;
  readonly globalMaxAbsNotional: number;
  readonly inventoryEpsilon: number;
  readonly maxTimeAboveEpsilonMs: number;
  /** Wall-clock gap between repeated `risk.limit_breach` warns for the same key; `0` disables throttling. */
  readonly riskLimitBreachLogCooldownMs: number;
}

export type InventoryStressLevel = "none" | "breach";

export class PositionLedger {
  private readonly cfg: PositionLedgerConfig;
  private readonly log: LoggerPort | undefined;
  private readonly positions = new Map<string, PositionState>();
  private readonly seenFills = new Set<string>();
  private readonly fillListeners = new Set<(fill: FillEvent) => void>();
  private readonly aboveEpsilonSince = new Map<string, number>();
  /** Keys: `symbol_limit:<sym>`, `time_at_risk:<sym>`, or `global_notional` (global breach is one stream). */
  private readonly lastRiskLimitBreachLogAt = new Map<string, number>();
  private globalNotional = 0;

  constructor(cfg: PositionLedgerConfig, log?: LoggerPort) {
    this.cfg = cfg;
    this.log = log;
  }

  /** SPEC-09 — invoked once per deduped fill after ledger mutation (e.g. markout). */
  registerFillListener(listener: (fill: FillEvent) => void): void {
    this.fillListeners.add(listener);
  }

  /**
   * RFC X3 — set net qty from REST bootstrap (no synthetic fills). Idempotent per symbol.
   * Zero qty removes the symbol entry. Does not touch `globalNotional`; call `applySeedMarksForGlobalNotional` after batch seed.
   */
  seedPosition(symbol: string, netQty: number, nowMs: number): void {
    if (Math.abs(netQty) < 1e-12) {
      this.positions.delete(symbol);
      this.aboveEpsilonSince.delete(symbol);
      return;
    }
    this.positions.set(symbol, { netQty });
    if (Math.abs(netQty) > this.cfg.inventoryEpsilon) {
      if (!this.aboveEpsilonSince.has(symbol)) this.aboveEpsilonSince.set(symbol, nowMs);
    } else {
      this.aboveEpsilonSince.delete(symbol);
    }
    this.log?.debug({ event: "ledger.position_seeded", symbol, netQty }, "ledger.position_seeded");
  }

  /**
   * After seeding positions, set cross-symbol gross notional using marks from `GET /fapi/v2/positionRisk`.
   */
  applySeedMarksForGlobalNotional(marks: ReadonlyMap<string, number>): void {
    let total = 0;
    for (const [sym, pos] of this.positions) {
      const m = marks.get(sym);
      if (m !== undefined && Number.isFinite(m) && m > 0) {
        total += Math.abs(pos.netQty) * m;
      }
    }
    this.globalNotional = total;
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

    this.log?.info(
      {
        event: "execution.fill",
        symbol: fill.symbol,
        orderId: fill.orderId,
        tradeId: fill.tradeId,
        side: fill.side,
        quantity: fill.quantity,
        price: fill.price,
        netQtyBefore: prev.netQty,
        netQtyAfter: next.netQty,
        ...(next.avgEntryPrice !== undefined ? { avgEntryPrice: next.avgEntryPrice } : {}),
      },
      "execution.fill",
    );
    this.log?.debug(
      {
        event: "execution.fill_debug",
        symbol: fill.symbol,
        orderId: fill.orderId,
        tradeId: fill.tradeId,
        dedupeKey: key,
      },
      "execution.fill_debug",
    );

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
      this.logRiskLimitBreachIfDue(`symbol_limit:${symbol}`, nowMs, {
        event: "risk.limit_breach",
        symbol,
        metric: "symbol_limit",
      });
      return "breach";
    }
    if (this.globalNotional > this.cfg.globalMaxAbsNotional) {
      this.logRiskLimitBreachIfDue("global_notional", nowMs, {
        event: "risk.limit_breach",
        symbol,
        metric: "global_notional",
      });
      return "breach";
    }
    const since = this.aboveEpsilonSince.get(symbol);
    if (since !== undefined && nowMs - since > this.cfg.maxTimeAboveEpsilonMs) {
      this.logRiskLimitBreachIfDue(`time_at_risk:${symbol}`, nowMs, {
        event: "risk.limit_breach",
        symbol,
        metric: "time_at_risk",
      });
      return "breach";
    }
    return "none";
  }

  getSkew(symbol: string) {
    const pos = this.getPosition(symbol);
    return computeInventorySkew(pos.netQty, this.cfg.maxAbsQty);
  }

  private logRiskLimitBreachIfDue(key: string, nowMs: number, meta: Record<string, unknown>): void {
    const cooldown = this.cfg.riskLimitBreachLogCooldownMs;
    if (cooldown <= 0) {
      this.log?.warn(meta, "risk.limit_breach");
      return;
    }
    const last = this.lastRiskLimitBreachLogAt.get(key);
    if (last !== undefined && nowMs - last < cooldown) return;
    this.lastRiskLimitBreachLogAt.set(key, nowMs);
    this.log?.warn(meta, "risk.limit_breach");
  }

  private computeGlobalNotional(markPrice: number): number {
    let total = 0;
    for (const p of this.positions.values()) total += Math.abs(p.netQty) * markPrice;
    return total;
  }
}
