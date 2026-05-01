import type { ClockPort } from "../ports/clock-port.js";
import type { BookSnapshot, TapeTrade } from "../../domain/market-data/types.js";
import type { QuotingInputs, ToxicitySnapshot } from "../../domain/signals/types.js";
import { VpinBuckets } from "../../domain/signals/vpin-buckets.js";
import { RealizedVolatility } from "../../domain/signals/realized-vol.js";
import type { LoggerPort } from "../ports/logger-port.js";

export interface SignalEngineConfig {
  readonly targetBucketVolume: number;
  readonly basis: "base" | "quote";
  readonly ewmaN: number;
  readonly staleFlushMs: number;
  readonly rvEnabled: boolean;
  readonly rvTau: number;
}

export class SignalEngine {
  private readonly vpin: VpinBuckets;
  private readonly rv: RealizedVolatility | undefined;
  private readonly clock: ClockPort;
  private readonly log: LoggerPort | undefined;
  private lastSpreadTicks: number | undefined;

  constructor(cfg: SignalEngineConfig, clock: ClockPort, log?: LoggerPort) {
    this.vpin = new VpinBuckets({
      targetBucketVolume: cfg.targetBucketVolume,
      basis: cfg.basis,
      ewmaN: cfg.ewmaN,
      staleFlushMs: cfg.staleFlushMs,
    });
    this.rv = cfg.rvEnabled ? new RealizedVolatility(cfg.rvTau) : undefined;
    this.clock = clock;
    this.log = log;
  }

  onTapeEvent(trade: TapeTrade): void {
    const now = this.clock.monotonicNowMs();
    this.vpin.onTrade(trade, now);
    const flushed = this.vpin.flushIfStale(now);
    if (flushed !== undefined) {
      this.log?.warn(
        { event: "signals.stale_bucket_flush", symbol: trade.symbol, index: flushed.index },
        "signals.stale_bucket_flush",
      );
    }
  }

  onBookEvent(book: BookSnapshot): void {
    if (book.bestBid !== undefined && book.bestAsk !== undefined) {
      const mid = (book.bestBid.price + book.bestAsk.price) / 2;
      this.rv?.onMid(mid);
    }
    this.lastSpreadTicks = book.spreadTicks;
  }

  getSnapshot(): ToxicitySnapshot {
    return this.vpin.getSnapshot();
  }

  getQuotingInputs(): QuotingInputs {
    return {
      toxicityScore: this.vpin.getSnapshot().toxicityScore,
      rvRegime: this.rv?.getRegime() ?? "normal",
      ...(this.lastSpreadTicks !== undefined ? { touchSpreadTicks: this.lastSpreadTicks } : {}),
    };
  }
}
