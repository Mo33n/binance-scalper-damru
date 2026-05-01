import type { LoggerPort } from "../../application/ports/logger-port.js";
import type { BookFeed, TapeFeed } from "../../application/ports/market-data.js";
import type { SignalEngine } from "../../application/services/signal-engine.js";
import type { AppConfig } from "../../config/schema.js";
import type { TradingVenueHandles } from "../../bootstrap/venue-types.js";
import type { BookSnapshot, TapeTrade } from "../../domain/market-data/types.js";
import {
  BinanceBookFeedAdapter,
  BinanceTapeFeedAdapter,
  type BinanceBookFeedHooks,
} from "../../infrastructure/binance/binance-market-data-adapters.js";
import { BoundedQueue } from "../../infrastructure/binance/bounded-queue.js";
import type { SymbolSpec } from "../../infrastructure/binance/types.js";
import { createWsClient } from "../../infrastructure/binance/ws-client.js";
import { MarketDataReadModelStore, type MarketDataReadModel } from "./market-data-read-model.js";

const TAPE_BACKLOG_LOG_MIN_GAP_MS = 1000;

export interface MarketDataControllerDeps {
  readonly symbol: string;
  readonly signalEngine: SignalEngine;
  readonly monotonicNowMs: () => number;
  readonly log: LoggerPort;
  readonly book: BookFeed;
  readonly tape: TapeFeed;
  readonly readModel: MarketDataReadModelStore;
  readonly tapeQueueMaxSize: number;
}

/**
 * Per-symbol market data: depth → book + VPIN/RV path; tape → bounded queue → SignalEngine (SPEC-04).
 */
export class MarketDataController {
  private readonly symbol: string;
  private readonly signalEngine: SignalEngine;
  private readonly monotonicNowMs: () => number;
  private readonly log: LoggerPort;
  private readonly book: BookFeed;
  private readonly tape: TapeFeed;
  private readonly readModel: MarketDataReadModelStore;
  private readonly tapeQueue: BoundedQueue<TapeTrade>;
  private tapeFlushScheduled = false;
  private lastTapeBacklogLogMono = Number.NEGATIVE_INFINITY;
  private unsubBook: (() => void) | undefined = undefined;
  private unsubTape: (() => void) | undefined = undefined;
  private stopped = false;

  constructor(deps: MarketDataControllerDeps) {
    this.symbol = deps.symbol;
    this.signalEngine = deps.signalEngine;
    this.monotonicNowMs = deps.monotonicNowMs;
    this.log = deps.log;
    this.book = deps.book;
    this.tape = deps.tape;
    this.readModel = deps.readModel;
    this.tapeQueue = new BoundedQueue<TapeTrade>(deps.tapeQueueMaxSize);
  }

  async start(): Promise<void> {
    if (this.stopped) return;
    await this.book.startSymbol(this.symbol);
    await this.tape.startSymbol(this.symbol);
    this.unsubBook = this.book.subscribeBook(this.symbol, (b) => {
      this.onBook(b);
    });
    this.unsubTape = this.tape.subscribeTape(this.symbol, (t) => {
      this.onTape(t);
    });
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.unsubBook?.();
    this.unsubTape?.();
    this.unsubBook = undefined;
    this.unsubTape = undefined;
    /** SPEC-04 §6.2: tape stream closed before depth (documented order). */
    await this.tape.stopSymbol(this.symbol);
    await this.book.stopSymbol(this.symbol);
    this.flushTapePendingSync();
  }

  getReadModel(): MarketDataReadModel {
    return this.readModel.getReadModel();
  }

  getSignalEngine(): SignalEngine {
    return this.signalEngine;
  }

  private onBook(book: BookSnapshot): void {
    const now = this.monotonicNowMs();
    this.readModel.onBookApplied(book, now);
    this.signalEngine.onBookEvent(book);
  }

  private onTape(trade: TapeTrade): void {
    if (this.stopped) return;
    const droppedBefore = this.tapeQueue.getDroppedCount();
    this.tapeQueue.push(trade);
    const droppedAfter = this.tapeQueue.getDroppedCount();
    if (droppedAfter > droppedBefore) {
      const now = this.monotonicNowMs();
      if (now - this.lastTapeBacklogLogMono >= TAPE_BACKLOG_LOG_MIN_GAP_MS) {
        this.lastTapeBacklogLogMono = now;
        this.log.warn(
          {
            event: "marketdata.tape_backlog",
            symbol: this.symbol,
            dropped: droppedAfter - droppedBefore,
          },
          "marketdata.tape_backlog",
        );
      }
    }
    if (!this.tapeFlushScheduled) {
      this.tapeFlushScheduled = true;
      queueMicrotask(() => {
        this.flushTapePendingSync();
      });
    }
  }

  private flushTapePendingSync(): void {
    this.tapeFlushScheduled = false;
    for (const t of this.tapeQueue.drain()) {
      this.signalEngine.onTapeEvent(t);
    }
  }
}

/** Minimal host shape for USD-M WS + REST depth (main thread or worker). */
export interface MarketDataHostContext {
  readonly config: Pick<AppConfig, "binance">;
  readonly venue: Pick<TradingVenueHandles, "rest">;
}

export function createMarketDataControllerForSession(
  session: MarketDataHostContext,
  spec: SymbolSpec,
  signalEngine: SignalEngine,
  monotonicNowMs: () => number,
  log: LoggerPort,
  tapeQueueMaxSize?: number,
): MarketDataController {
  const readModel = new MarketDataReadModelStore();
  const ws = createWsClient(session.config.binance.wsBaseUrl, log);

  const hooks: BinanceBookFeedHooks = {
    onGap: (symbol) => {
      readModel.setQuotingPaused(true);
      log.warn(
        { event: "marketdata.book_resync", symbol, reason: "depth_sequence_gap" },
        "marketdata.book_resync",
      );
    },
  };

  const bookFeed = new BinanceBookFeedAdapter(session.venue.rest, ws, [spec], log, hooks);
  const tapeFeed = new BinanceTapeFeedAdapter(ws, log);

  return new MarketDataController({
    symbol: spec.symbol,
    signalEngine,
    monotonicNowMs,
    log,
    book: bookFeed,
    tape: tapeFeed,
    readModel,
    tapeQueueMaxSize: tapeQueueMaxSize ?? 4096,
  });
}
