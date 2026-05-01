import { describe, it, expect, vi } from "vitest";
import { BinanceBookFeedAdapter, BinanceTapeFeedAdapter } from "../../../src/infrastructure/binance/binance-market-data-adapters.js";
import type { WsClient, WsConnection } from "../../../src/infrastructure/binance/ws-client.js";
import type { SymbolSpec } from "../../../src/infrastructure/binance/types.js";

class FakeConn implements WsConnection {
  private msg?: (x: string) => void;
  private closeCb?: (code: number) => void;
  private errCb?: (err: Error) => void;
  closed = false;

  whenOpen(): Promise<void> {
    return Promise.resolve();
  }

  emitMessage(payload: unknown): void {
    this.msg?.(JSON.stringify(payload));
  }
  close(): void {
    this.closed = true;
    this.closeCb?.(1000);
  }
  onMessage(cb: (text: string) => void): void {
    this.msg = cb;
  }
  onClose(cb: (code: number) => void): void {
    this.closeCb = cb;
  }
  onError(cb: (err: Error) => void): void {
    this.errCb = cb;
  }
}

class FakeWs implements WsClient {
  readonly conns: FakeConn[] = [];
  connect(): WsConnection {
    const c = new FakeConn();
    this.conns.push(c);
    return c;
  }
}

describe("Binance market data adapters", () => {
  const specs: SymbolSpec[] = [
    {
      symbol: "BTCUSDT",
      status: "TRADING",
      tickSize: 0.1,
      stepSize: 0.001,
      minNotional: 5,
      contractSize: 1,
    },
  ];

  it("book adapter start/stop idempotent and emits snapshots", async () => {
    const ws = new FakeWs();
    const rest = {
      requestJson: () =>
        Promise.resolve({
          lastUpdateId: 100,
          bids: [["50000", "1"]],
          asks: [["50000.1", "1"]],
        } as unknown),
    };
    const adapter = new BinanceBookFeedAdapter(rest as never, ws, specs);
    const books: number[] = [];
    adapter.subscribeBook("BTCUSDT", (b) => {
      books.push(b.bestBid?.price ?? 0);
    });
    await adapter.startSymbol("BTCUSDT");
    await adapter.startSymbol("BTCUSDT");
    ws.conns[0]?.emitMessage({
      U: 100,
      u: 101,
      pu: 99,
      b: [["50000", "2"]],
      a: [["50000.1", "1"]],
    });
    expect(books.length).toBeGreaterThanOrEqual(1);
    await adapter.stopSymbol("BTCUSDT");
    await adapter.stopSymbol("BTCUSDT");
  });

  it("schedules another REST snapshot when flush fails inside an in-flight resync (coalesced gap)", async () => {
    const ws = new FakeWs();
    const snaps = [
      { lastUpdateId: 100, bids: [["50000", "1"]], asks: [["50000.1", "1"]] },
      { lastUpdateId: 300, bids: [["50000", "1"]], asks: [["50000.1", "1"]] },
      { lastUpdateId: 500, bids: [["50000", "1"]], asks: [["50000.1", "1"]] },
    ];
    let restCall = 0;
    const rest = {
      requestJson: vi.fn(() => {
        const body = snaps[restCall];
        restCall += 1;
        if (body === undefined) throw new Error(`unexpected REST call index ${restCall}`);
        return Promise.resolve(body);
      }),
    };
    const adapter = new BinanceBookFeedAdapter(rest as never, ws, specs);
    await adapter.startSymbol("BTCUSDT");
    const conn = ws.conns[0]!;
    conn.emitMessage({
      U: 95,
      u: 105,
      pu: 94,
      b: [["50000", "2"]],
      a: [["50000.1", "1"]],
    });
    conn.emitMessage({
      U: 106,
      u: 106,
      pu: 105,
      b: [["50000", "3"]],
      a: [["50000.1", "1"]],
    });
    conn.emitMessage({
      U: 107,
      u: 107,
      pu: 50,
      b: [["50000", "4"]],
      a: [["50000.1", "1"]],
    });
    conn.emitMessage({
      U: 305,
      u: 305,
      pu: 304,
      b: [["50000", "5"]],
      a: [["50000.1", "1"]],
    });
    await Promise.resolve();
    await vi.waitUntil(() => rest.requestJson.mock.calls.length >= 3);
    expect(rest.requestJson.mock.calls.length).toBeGreaterThanOrEqual(3);
    await adapter.stopSymbol("BTCUSDT");
  });

  it("buffers diffs after REST snapshot until bridge overlaps (live U>L does not false-gap)", async () => {
    const ws = new FakeWs();
    const rest = {
      requestJson: vi.fn(() =>
        Promise.resolve({
          lastUpdateId: 100,
          bids: [["50000", "1"]],
          asks: [["50000.1", "1"]],
        }),
      ),
    };
    const onGap = vi.fn();
    const adapter = new BinanceBookFeedAdapter(rest as never, ws, specs, undefined, { onGap });
    const bestBidQtys: number[] = [];
    adapter.subscribeBook("BTCUSDT", (b) => {
      if (b.bestBid !== undefined) bestBidQtys.push(b.bestBid.qty);
    });
    await adapter.startSymbol("BTCUSDT");
    const conn = ws.conns[0]!;
    conn.emitMessage({
      U: 105,
      u: 105,
      pu: 104,
      b: [["50000", "9"]],
      a: [["50000.1", "1"]],
    });
    conn.emitMessage({
      U: 98,
      u: 102,
      pu: 97,
      b: [["50000", "3"]],
      a: [["50000.1", "1"]],
    });
    await Promise.resolve();
    expect(onGap).not.toHaveBeenCalled();
    expect(bestBidQtys).toContain(3);
    await adapter.stopSymbol("BTCUSDT");
  });

  it("book adapter REST-resynchronizes after depth sequence gap", async () => {
    const ws = new FakeWs();
    let snapLastUpdateId = 100;
    const rest = {
      requestJson: vi.fn(() =>
        Promise.resolve({
          lastUpdateId: snapLastUpdateId,
          bids: [["50000", "1"]],
          asks: [["50000.1", "1"]],
        }),
      ),
    };
    const onGap = vi.fn();
    const adapter = new BinanceBookFeedAdapter(rest as never, ws, specs, undefined, { onGap });
    await adapter.startSymbol("BTCUSDT");
    expect(rest.requestJson).toHaveBeenCalledTimes(1);
    ws.conns[0]?.emitMessage({
      U: 102,
      u: 102,
      pu: 98,
      b: [["50000", "3"]],
      a: [["50000.1", "1"]],
    });
    await Promise.resolve();
    expect(onGap).toHaveBeenCalledWith("BTCUSDT");
    snapLastUpdateId = 900;
    await vi.waitUntil(() => rest.requestJson.mock.calls.length >= 2);
    expect(rest.requestJson.mock.calls.length).toBeGreaterThanOrEqual(2);
    await adapter.stopSymbol("BTCUSDT");
  });

  it("buffers depth updates until REST snapshot returns then applies overlapping diff", async () => {
    const ws = new FakeWs();
    let resolveSnap!: (v: unknown) => void;
    const snapPromise = new Promise<unknown>((resolve) => {
      resolveSnap = resolve;
    });
    const rest = {
      requestJson: vi.fn(() => snapPromise),
    };
    const adapter = new BinanceBookFeedAdapter(rest as never, ws, specs);
    const bestBidQtys: number[] = [];
    adapter.subscribeBook("BTCUSDT", (b) => {
      if (b.bestBid !== undefined) bestBidQtys.push(b.bestBid.qty);
    });
    const started = adapter.startSymbol("BTCUSDT");
    ws.conns[0]?.emitMessage({
      U: 98,
      u: 102,
      pu: 97,
      b: [["50000", "7"]],
      a: [["50000.1", "1"]],
    });
    resolveSnap({
      lastUpdateId: 100,
      bids: [["50000", "1"]],
      asks: [["50000.1", "1"]],
    });
    await started;
    expect(bestBidQtys).toContain(7);
    await adapter.stopSymbol("BTCUSDT");
  });

  it("unwraps combined-stream depth envelope and bridges when a high-U diff was queued before the overlap diff", async () => {
    const ws = new FakeWs();
    let resolveSnap!: (v: unknown) => void;
    const snapPromise = new Promise<unknown>((resolve) => {
      resolveSnap = resolve;
    });
    const rest = { requestJson: vi.fn(() => snapPromise) };
    const adapter = new BinanceBookFeedAdapter(rest as never, ws, specs);
    const bestBidQtys: number[] = [];
    adapter.subscribeBook("BTCUSDT", (b) => {
      if (b.bestBid !== undefined) bestBidQtys.push(b.bestBid.qty);
    });
    const started = adapter.startSymbol("BTCUSDT");
    ws.conns[0]?.emitMessage({
      data: {
        U: 110,
        u: 110,
        pu: 109,
        b: [["50000", "3"]],
        a: [["50000.1", "1"]],
      },
    });
    ws.conns[0]?.emitMessage({
      data: {
        U: 98,
        u: 102,
        pu: 97,
        b: [["50000", "9"]],
        a: [["50000.1", "1"]],
      },
    });
    ws.conns[0]?.emitMessage({
      data: {
        U: 103,
        u: 103,
        pu: 102,
        b: [["50000", "8"]],
        a: [["50000.1", "1"]],
      },
    });
    resolveSnap({
      lastUpdateId: 100,
      bids: [["50000", "1"]],
      asks: [["50000.1", "1"]],
    });
    await started;
    expect(bestBidQtys).toContain(9);
    expect(bestBidQtys).toContain(8);
    await adapter.stopSymbol("BTCUSDT");
  });

  it("tape adapter emits parsed trades and stop is idempotent", async () => {
    const ws = new FakeWs();
    const adapter = new BinanceTapeFeedAdapter(ws);
    const sides: string[] = [];
    adapter.subscribeTape("BTCUSDT", (t) => sides.push(t.side));
    await adapter.startSymbol("BTCUSDT");
    ws.conns[0]?.emitMessage({
      E: 1,
      s: "BTCUSDT",
      a: 1,
      p: "50000",
      q: "0.01",
      m: false,
    });
    expect(sides).toEqual(["buy"]);
    await adapter.stopSymbol("BTCUSDT");
    await adapter.stopSymbol("BTCUSDT");
  });
});
