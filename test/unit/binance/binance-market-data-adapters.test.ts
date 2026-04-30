import { describe, it, expect } from "vitest";
import { BinanceBookFeedAdapter, BinanceTapeFeedAdapter } from "../../../src/infrastructure/binance/binance-market-data-adapters.js";
import type { WsClient, WsConnection } from "../../../src/infrastructure/binance/ws-client.js";
import type { SymbolSpec } from "../../../src/infrastructure/binance/types.js";

class FakeConn implements WsConnection {
  private msg?: (x: string) => void;
  private closeCb?: (code: number) => void;
  private errCb?: (err: Error) => void;
  closed = false;

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
      U: 101,
      u: 101,
      pu: 100,
      b: [["50000", "2"]],
      a: [["50000.1", "1"]],
    });
    expect(books.length).toBeGreaterThanOrEqual(1);
    await adapter.stopSymbol("BTCUSDT");
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
