export interface FillMarkoutInput {
  readonly fillId: string;
  readonly symbol: string;
  readonly side: "BUY" | "SELL";
  readonly fillPrice: number;
  readonly midAtFill?: number;
  readonly fillAtMs: number;
}

export interface MarkoutSample {
  readonly fillId: string;
  readonly horizonMs: number;
  readonly value: number;
  readonly reliable: boolean;
  /** Set when `noteLiquidityRegimeState` was called before the fill (liquidity FSM + markout both on). */
  readonly liquidityRegimeState?: string;
}

interface PendingFill {
  readonly input: FillMarkoutInput;
  readonly dueAtMs: number[];
  readonly liquidityRegimeStateAtFill?: string;
}

export class MarkoutTracker {
  private readonly horizonsMs: readonly number[];
  private readonly maxPending: number;
  private pending = new Map<string, PendingFill>();
  private midBySymbol = new Map<string, { mid: number; atMs: number }>();
  private ewma = 0;
  private alpha = 0.2;
  private lastLiquidityRegimeState: string | undefined;

  constructor(horizonsMs: readonly number[], maxPending = 1024) {
    this.horizonsMs = [...horizonsMs].sort((a, b) => a - b);
    this.maxPending = maxPending;
  }

  onMid(symbol: string, mid: number, atMs: number): void {
    this.midBySymbol.set(symbol, { mid, atMs });
  }

  onFill(input: FillMarkoutInput): void {
    if (this.pending.size >= this.maxPending) {
      const oldest = this.pending.keys().next().value;
      if (oldest !== undefined) this.pending.delete(oldest);
    }
    this.pending.set(input.fillId, {
      input,
      dueAtMs: this.horizonsMs.map((h) => input.fillAtMs + h),
      ...(this.lastLiquidityRegimeState !== undefined
        ? { liquidityRegimeStateAtFill: this.lastLiquidityRegimeState }
        : {}),
    });
  }

  collectDueSamples(nowMs: number): readonly MarkoutSample[] {
    const out: MarkoutSample[] = [];
    for (const [fillId, p] of this.pending.entries()) {
      const midEntry = this.midBySymbol.get(p.input.symbol);
      const remaining: number[] = [];
      for (const due of p.dueAtMs) {
        if (due > nowMs) {
          remaining.push(due);
          continue;
        }
        const reliable = p.input.midAtFill !== undefined && midEntry !== undefined;
        const midNow = midEntry?.mid ?? p.input.fillPrice;
        const signed = p.input.side === "BUY" ? 1 : -1;
        const value = reliable ? signed * (midNow - p.input.fillPrice) : 0;
        out.push({
          fillId,
          horizonMs: due - p.input.fillAtMs,
          value,
          reliable,
          ...(p.liquidityRegimeStateAtFill !== undefined
            ? { liquidityRegimeState: p.liquidityRegimeStateAtFill }
            : {}),
        });
        this.ewma = this.alpha * value + (1 - this.alpha) * this.ewma;
      }
      if (remaining.length === 0) this.pending.delete(fillId);
      else
        this.pending.set(fillId, {
          input: p.input,
          dueAtMs: remaining,
          ...(p.liquidityRegimeStateAtFill !== undefined
            ? { liquidityRegimeStateAtFill: p.liquidityRegimeStateAtFill }
            : {}),
        });
    }
    return out;
  }

  getEwma(): number {
    return this.ewma;
  }

  getPendingCount(): number {
    return this.pending.size;
  }

  /** RFC P3 — last FSM state from orchestrator; copied onto fills at `onFill` time. */
  noteLiquidityRegimeState(state: string): void {
    this.lastLiquidityRegimeState = state;
  }
}
