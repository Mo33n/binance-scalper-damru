import type { TapeTrade } from "../market-data/types.js";
import type { ClosedBucket, ToxicitySnapshot, VpinConfig } from "./types.js";

export class VpinBuckets {
  private readonly cfg: VpinConfig;
  private readonly epsilon: number;
  private buy = 0;
  private sell = 0;
  private total = 0;
  private bucketIndex = 0;
  private staleFlushCount = 0;
  private partialStartedAtMs: number | undefined;
  private lastClosed: ClosedBucket = {
    index: 0,
    buyVolume: 0,
    sellVolume: 0,
    imbalance: 0,
  };
  private ewma?: number;

  constructor(cfg: VpinConfig) {
    this.cfg = cfg;
    this.epsilon = cfg.epsilon ?? 1e-12;
  }

  onTrade(trade: TapeTrade, monotonicMs: number): ClosedBucket | undefined {
    const volume = this.cfg.basis === "quote" ? trade.price * trade.quantity : trade.quantity;
    if (!Number.isFinite(volume) || volume <= 0) return undefined;

    if (this.partialStartedAtMs === undefined) {
      this.partialStartedAtMs = monotonicMs;
    }
    if (trade.side === "buy") this.buy += volume;
    else this.sell += volume;
    this.total += volume;

    if (this.total < this.cfg.targetBucketVolume) return undefined;
    return this.closeBucket();
  }

  flushIfStale(monotonicMs: number): ClosedBucket | undefined {
    if (this.partialStartedAtMs === undefined) return undefined;
    if (this.total <= 0) return undefined;
    const age = monotonicMs - this.partialStartedAtMs;
    if (age < this.cfg.staleFlushMs) return undefined;
    this.staleFlushCount += 1;
    return this.closeBucket();
  }

  getSnapshot(): ToxicitySnapshot {
    return {
      bucketIndex: this.bucketIndex,
      lastImbalance: this.lastClosed.imbalance,
      toxicityScore: this.ewma ?? this.lastClosed.imbalance,
      totalBuyVolume: this.lastClosed.buyVolume,
      totalSellVolume: this.lastClosed.sellVolume,
      staleFlushCount: this.staleFlushCount,
    };
  }

  private closeBucket(): ClosedBucket {
    this.bucketIndex += 1;
    const denom = this.buy + this.sell + this.epsilon;
    const imbalance = Math.abs(this.buy - this.sell) / denom;
    const closed: ClosedBucket = {
      index: this.bucketIndex,
      buyVolume: this.buy,
      sellVolume: this.sell,
      imbalance,
    };
    this.lastClosed = closed;
    this.updateEwma(imbalance);
    this.buy = 0;
    this.sell = 0;
    this.total = 0;
    this.partialStartedAtMs = undefined;
    return closed;
  }

  private updateEwma(value: number): void {
    const alpha = 2 / (this.cfg.ewmaN + 1);
    this.ewma = this.ewma === undefined ? value : alpha * value + (1 - alpha) * this.ewma;
  }
}
