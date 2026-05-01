import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LoggerPort } from "../../../src/application/ports/logger-port.js";
import type { BookFeed, TapeFeed } from "../../../src/application/ports/market-data.js";
import { SignalEngine } from "../../../src/application/services/signal-engine.js";
import type { BookSnapshot, TapeTrade } from "../../../src/domain/market-data/types.js";
import { MarketDataController } from "../../../src/runtime/worker/market-data-controller.js";
import { MarketDataReadModelStore } from "../../../src/runtime/worker/market-data-read-model.js";

class FakeBookFeed implements BookFeed {
  readonly startSymbol = vi.fn(async () => {});
  readonly stopSymbol = vi.fn(async () => {});
  private readonly handlers = new Map<string, (b: BookSnapshot) => void>();

  subscribeBook(symbol: string, handler: (b: BookSnapshot) => void): () => void {
    this.handlers.set(symbol, handler);
    return () => this.handlers.delete(symbol);
  }

  getLatestBookSnapshot(): BookSnapshot | undefined {
    return undefined;
  }

  getBookStalenessMs(): number | undefined {
    return undefined;
  }

  emit(symbol: string, book: BookSnapshot): void {
    this.handlers.get(symbol)?.(book);
  }
}

class FakeTapeFeed implements TapeFeed {
  readonly startSymbol = vi.fn(async () => {});
  readonly stopSymbol = vi.fn(async () => {});
  private readonly handlers = new Map<string, (t: TapeTrade) => void>();

  subscribeTape(symbol: string, handler: (t: TapeTrade) => void): () => void {
    this.handlers.set(symbol, handler);
    return () => this.handlers.delete(symbol);
  }

  emit(symbol: string, trade: TapeTrade): void {
    this.handlers.get(symbol)?.(trade);
  }
}

describe("MarketDataController (SPEC-04)", () => {
  const symbol = "BTCUSDT";
  let fakeBook: FakeBookFeed;
  let fakeTape: FakeTapeFeed;
  let engine: SignalEngine;
  let readModel: MarketDataReadModelStore;
  let log: LoggerPort;
  let warnCallMock: ReturnType<typeof vi.fn>;
  let mono: number;

  beforeEach(() => {
    fakeBook = new FakeBookFeed();
    fakeTape = new FakeTapeFeed();
    mono = 10_000;
    warnCallMock = vi.fn();
    engine = new SignalEngine(
      {
        targetBucketVolume: 1,
        basis: "base",
        ewmaN: 5,
        staleFlushMs: 60_000,
        rvEnabled: false,
        rvTau: 0.0005,
      },
      { monotonicNowMs: () => mono, utcIsoTimestamp: () => "2026-01-01T00:00:00.000Z" },
    );
    readModel = new MarketDataReadModelStore();
    log = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: warnCallMock as unknown as LoggerPort["warn"],
      error: vi.fn(),
      child(): LoggerPort {
        return log;
      },
    };
  });

  function makeController(tapeMax: number = 4096): MarketDataController {
    return new MarketDataController({
      symbol,
      signalEngine: engine,
      monotonicNowMs: () => mono,
      log,
      book: fakeBook,
      tape: fakeTape,
      readModel,
      tapeQueueMaxSize: tapeMax,
    });
  }

  it("T01: book updates refresh read model touch and mid", async () => {
    const c = makeController();
    await c.start();
    const book: BookSnapshot = {
      symbol,
      bids: [],
      asks: [],
      bestBid: { price: 50_000, qty: 1 },
      bestAsk: { price: 50_000.1, qty: 1 },
      spreadTicks: 1,
    };
    fakeBook.emit(symbol, book);
    const rm = c.getReadModel();
    expect(rm.touchSpreadTicks).toBe(1);
    expect(rm.bestBidQty).toBe(1);
    expect(rm.bestAskQty).toBe(1);
    expect(rm.lastMid).toBeCloseTo(50_000.05);
    expect(rm.lastBookApplyMonotonicMs).toBe(10_000);
    await c.stop();
  });

  it("T03: tape events reach SignalEngine after microtask flush", async () => {
    const c = makeController();
    const spy = vi.spyOn(engine, "onTapeEvent");
    await c.start();
    const trade: TapeTrade = {
      symbol,
      tradeId: 1,
      price: 100,
      quantity: 0.01,
      side: "buy",
      eventTimeMs: 1,
    };
    fakeTape.emit(symbol, trade);
    expect(spy).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(spy).toHaveBeenCalledTimes(1);
    const firstArg = spy.mock.calls[0]?.[0];
    expect(firstArg).toEqual(trade);
    await c.stop();
  });

  it("tape backlog logs when bounded queue drops (burst before microtask)", async () => {
    const c = makeController(2);
    await c.start();
    for (let i = 0; i < 5; i++) {
      fakeTape.emit(symbol, {
        symbol,
        tradeId: i,
        price: 100,
        quantity: 0.01,
        side: "buy",
        eventTimeMs: i,
      });
    }
    await Promise.resolve();
    expect(warnCallMock.mock.calls.length).toBeGreaterThan(0);
    const warnArg = warnCallMock.mock.calls.find(
      (c: unknown[]) => (c[0] as { event?: string }).event === "marketdata.tape_backlog",
    );
    expect(warnArg).toBeDefined();
    await c.stop();
  });

  it("T04: stop closes feeds in order (tape then book)", async () => {
    const c = makeController();
    await c.start();
    await c.stop();
    const tapeOrder = fakeTape.stopSymbol.mock.invocationCallOrder[0];
    const bookOrder = fakeBook.stopSymbol.mock.invocationCallOrder[0];
    expect(tapeOrder).toBeTypeOf("number");
    expect(bookOrder).toBeTypeOf("number");
    expect(tapeOrder as number).toBeLessThan(bookOrder as number);
    expect(fakeTape.stopSymbol).toHaveBeenCalledWith(symbol);
    expect(fakeBook.stopSymbol).toHaveBeenCalledWith(symbol);
  });

  it("stop is idempotent", async () => {
    const c = makeController();
    await c.start();
    await c.stop();
    await c.stop();
    expect(fakeTape.stopSymbol).toHaveBeenCalledTimes(1);
    expect(fakeBook.stopSymbol).toHaveBeenCalledTimes(1);
  });
});
