import { describe, it, expect, vi } from "vitest";
import { BinanceBookFeedAdapter, BinanceTapeFeedAdapter } from "../../../src/infrastructure/binance/binance-market-data-adapters.js";
import type { WsClient, WsConnection } from "../../../src/infrastructure/binance/ws-client.js";
import type { SymbolSpec } from "../../../src/infrastructure/binance/types.js";
import { BinanceRestError } from "../../../src/infrastructure/binance/rest-client.js";
import { DepthSnapshotConcurrencyGate } from "../../../src/infrastructure/binance/depth-snapshot-gate.js";

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

class RecordingFakeWs implements WsClient {
  readonly paths: string[] = [];
  readonly conns: FakeConn[] = [];
  connect(path: string): WsConnection {
    this.paths.push(path);
    const c = new FakeConn();
    this.conns.push(c);
    return c;
  }
}

function getTestConn(ws: FakeWs): FakeConn {
  const c = ws.conns[0];
  if (c === undefined) throw new Error("expected fake ws connection");
  return c;
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
        if (body === undefined) throw new Error(`unexpected REST call index ${String(restCall)}`);
        return Promise.resolve(body);
      }),
    };
    const adapter = new BinanceBookFeedAdapter(rest as never, ws, specs);
    await adapter.startSymbol("BTCUSDT");
    const conn = getTestConn(ws);
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
    const conn = getTestConn(ws);
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

  it("does not emit post-gap bestBid qty until REST resync snapshot (C1)", async () => {
    const ws = new FakeWs();
    const rest = {
      requestJson: vi.fn(() => {
        const n = rest.requestJson.mock.calls.length;
        const lastUpdateId = n === 1 ? 100 : 700;
        return Promise.resolve({
          lastUpdateId,
          bids: [["50000", "1"]],
          asks: [["50000.1", "1"]],
        });
      }),
    };
    const adapter = new BinanceBookFeedAdapter(rest as never, ws, specs);
    const seenQtys: number[] = [];
    adapter.subscribeBook("BTCUSDT", (b) => {
      if (b.bestBid !== undefined) seenQtys.push(b.bestBid.qty);
    });
    await adapter.startSymbol("BTCUSDT");
    const conn = getTestConn(ws);
    conn.emitMessage({
      U: 100,
      u: 101,
      pu: 99,
      b: [["50000", "3"]],
      a: [["50000.1", "1"]],
    });
    await Promise.resolve();
    expect(seenQtys).toContain(3);
    conn.emitMessage({
      U: 103,
      u: 103,
      pu: 50,
      b: [["50000", "999"]],
      a: [["50000.1", "1"]],
    });
    await Promise.resolve();
    expect(seenQtys).not.toContain(999);
    await vi.waitUntil(() => rest.requestJson.mock.calls.length >= 2);
    await vi.waitUntil(() => seenQtys.length >= 3);
    expect(seenQtys).not.toContain(999);
    conn.emitMessage({
      U: 698,
      u: 702,
      pu: 697,
      b: [["50000", "5"]],
      a: [["50000.1", "1"]],
    });
    await vi.waitUntil(() => seenQtys.includes(5));
    await adapter.stopSymbol("BTCUSDT");
  });

  it("drops oldest pending depth events when cap exceeded and reports metric (C8)", async () => {
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
    const pendingDrop = vi.fn();
    const adapter = new BinanceBookFeedAdapter(rest as never, ws, specs, undefined, undefined, {
      maxPendingDepthEvents: 4,
      metrics: {
        depthPendingDrop: (n: number): void => {
          pendingDrop(n);
        },
      },
    });
    await adapter.startSymbol("BTCUSDT");
    const conn = getTestConn(ws);
    conn.emitMessage({
      U: 102,
      u: 102,
      pu: 98,
      b: [],
      a: [],
    });
    await Promise.resolve();
    for (let i = 0; i < 12; i++) {
      conn.emitMessage({
        U: 200 + i,
        u: 200 + i,
        pu: 199 + i,
        b: [],
        a: [],
      });
    }
    expect(pendingDrop.mock.calls.length).toBeGreaterThan(0);
    await adapter.stopSymbol("BTCUSDT");
  });

  it("retries bootstrap REST after 429 (C2)", async () => {
    const ws = new FakeWs();
    let n = 0;
    const rest = {
      requestJson: vi.fn(() => {
        n += 1;
        if (n === 1) {
          return Promise.reject(new BinanceRestError("throttled", 429, "{}"));
        }
        return Promise.resolve({
          lastUpdateId: 100,
          bids: [["50000", "1"]],
          asks: [["50000.1", "1"]],
        });
      }),
    };
    const gate = new DepthSnapshotConcurrencyGate(4);
    const adapter = new BinanceBookFeedAdapter(rest as never, ws, specs, undefined, undefined, {
      depthSnapshotGate: gate,
    });
    await adapter.startSymbol("BTCUSDT");
    expect(rest.requestJson.mock.calls.length).toBeGreaterThanOrEqual(2);
    await adapter.stopSymbol("BTCUSDT");
  });

  it("combined depth multiplexes one connection and routes by stream (P6)", async () => {
    const ws = new RecordingFakeWs();
    const dual: SymbolSpec[] = [
      {
        symbol: "BTCUSDT",
        status: "TRADING",
        tickSize: 0.1,
        stepSize: 0.001,
        minNotional: 5,
        contractSize: 1,
      },
      {
        symbol: "ETHUSDT",
        status: "TRADING",
        tickSize: 0.01,
        stepSize: 0.001,
        minNotional: 5,
        contractSize: 1,
      },
    ];
    const rest = {
      requestJson: vi.fn((req: { query?: { symbol?: string } }) => {
        const sym = req.query?.symbol ?? "BTCUSDT";
        const id = sym === "ETHUSDT" ? 200 : 100;
        return Promise.resolve({
          lastUpdateId: id,
          bids: [[sym === "ETHUSDT" ? "3000" : "50000", "1"]],
          asks: [[sym === "ETHUSDT" ? "3000.1" : "50000.1", "1"]],
        });
      }),
    };
    const adapter = new BinanceBookFeedAdapter(rest as never, ws, dual, undefined, undefined, {
      combinedDepth: true,
    });
    const btc: number[] = [];
    const eth: number[] = [];
    adapter.subscribeBook("BTCUSDT", (b) => btc.push(b.bestBid?.price ?? 0));
    adapter.subscribeBook("ETHUSDT", (b) => eth.push(b.bestBid?.price ?? 0));

    await Promise.all([adapter.startSymbol("BTCUSDT"), adapter.startSymbol("ETHUSDT")]);

    expect(ws.paths).toEqual(["/stream?streams=btcusdt@depth/ethusdt@depth"]);
    expect(rest.requestJson.mock.calls.length).toBeGreaterThanOrEqual(2);

    const conn = ws.conns[0];
    if (conn === undefined) throw new Error("expected ws conn");
    conn.emitMessage({
      stream: "btcusdt@depth",
      data: {
        U: 100,
        u: 101,
        pu: 99,
        b: [["50000", "2"]],
        a: [["50000.1", "1"]],
      },
    });
    conn.emitMessage({
      stream: "ethusdt@depth",
      data: {
        U: 200,
        u: 201,
        pu: 199,
        b: [["3000", "3"]],
        a: [["3000.1", "1"]],
      },
    });
    expect(btc.some((p) => p === 50000)).toBe(true);
    expect(eth.some((p) => p === 3000)).toBe(true);

    await adapter.stopSymbol("BTCUSDT");
    await adapter.stopSymbol("ETHUSDT");
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
