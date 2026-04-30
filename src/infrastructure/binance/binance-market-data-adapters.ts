import type { BookFeed, TapeFeed, Unsubscribe } from "../../application/ports/market-data.js";
import type { BookSnapshot, DepthDiffEvent, TapeTrade } from "../../domain/market-data/types.js";
import { DepthOrderBook, type DepthSnapshotRaw } from "./depth-order-book.js";
import { parseAggTrade, type BinanceAggTradeRaw } from "./agg-trades.js";
import type { BinanceRestClient } from "./rest-client.js";
import type { WsClient, WsConnection } from "./ws-client.js";
import type { LoggerPort } from "../../application/ports/logger-port.js";
import type { SymbolSpec } from "./types.js";

type Handler<T> = (item: T) => void;

interface DepthStreamRaw {
  readonly e?: string;
  readonly E?: number;
  readonly U: number;
  readonly u: number;
  readonly pu?: number;
  readonly b: readonly [string, string][];
  readonly a: readonly [string, string][];
}

export class BinanceBookFeedAdapter implements BookFeed {
  private readonly rest: BinanceRestClient;
  private readonly ws: WsClient;
  private readonly log: LoggerPort | undefined;
  private readonly books = new Map<string, DepthOrderBook>();
  private readonly conns = new Map<string, WsConnection>();
  private readonly subs = new Map<string, Set<Handler<BookSnapshot>>>();
  private readonly resyncCountBySymbol = new Map<string, number>();
  private readonly symbols = new Map<string, SymbolSpec>();

  constructor(rest: BinanceRestClient, ws: WsClient, specs: readonly SymbolSpec[], log?: LoggerPort) {
    this.rest = rest;
    this.ws = ws;
    this.log = log;
    for (const s of specs) this.symbols.set(s.symbol, s);
  }

  async startSymbol(symbol: string): Promise<void> {
    if (this.conns.has(symbol)) return;
    const spec = this.symbols.get(symbol);
    if (spec === undefined) throw new Error(`Unknown symbol spec: ${symbol}`);
    const book = new DepthOrderBook(symbol, spec.tickSize);
    this.books.set(symbol, book);

    const snap = await this.rest.requestJson<DepthSnapshotRaw>({
      path: "/fapi/v1/depth",
      query: { symbol, limit: 1000 },
    });
    const initial = book.applySnapshot(snap);
    this.emitBook(symbol, initial);

    const stream = `/ws/${symbol.toLowerCase()}@depth@100ms`;
    const conn = this.ws.connect(stream);
    conn.onMessage((text) => {
      const raw = JSON.parse(text) as DepthStreamRaw;
      const evt: DepthDiffEvent = {
        symbol,
        firstUpdateId: raw.U,
        finalUpdateId: raw.u,
        bids: raw.b.map(([p, q]) => ({ price: Number(p), qty: Number(q) })),
        asks: raw.a.map(([p, q]) => ({ price: Number(p), qty: Number(q) })),
        ...(raw.pu !== undefined ? { prevFinalUpdateId: raw.pu } : {}),
        ...(raw.E !== undefined ? { eventTimeMs: raw.E } : {}),
      };
      const result = book.applyDiff(evt);
      if (result.kind === "updated") {
        this.emitBook(symbol, result.snapshot);
      } else if (result.kind === "gap") {
        this.resyncCountBySymbol.set(symbol, (this.resyncCountBySymbol.get(symbol) ?? 0) + 1);
        this.log?.warn({ event: "book.resync_required", symbol }, "book.resync_required");
      }
    });
    conn.onClose((code) => {
      this.log?.warn({ event: "ws.close", symbol, code }, "ws.close");
      this.conns.delete(symbol);
    });
    conn.onError((err) => {
      this.log?.error({ event: "ws.error", symbol, msg: err.message }, "ws.error");
    });
    this.conns.set(symbol, conn);
  }

  stopSymbol(symbol: string): Promise<void> {
    const conn = this.conns.get(symbol);
    if (conn !== undefined) conn.close();
    this.conns.delete(symbol);
    this.books.delete(symbol);
    return Promise.resolve();
  }

  subscribeBook(symbol: string, handler: Handler<BookSnapshot>): Unsubscribe {
    const set = this.subs.get(symbol) ?? new Set<Handler<BookSnapshot>>();
    set.add(handler);
    this.subs.set(symbol, set);
    return () => {
      const cur = this.subs.get(symbol);
      cur?.delete(handler);
    };
  }

  getLatestBookSnapshot(symbol: string): BookSnapshot | undefined {
    return this.books.get(symbol)?.getSnapshot();
  }

  getBookStalenessMs(symbol: string): number | undefined {
    return this.books.get(symbol)?.getStalenessMs();
  }

  getBookResyncCount(symbol: string): number {
    return this.resyncCountBySymbol.get(symbol) ?? 0;
  }

  private emitBook(symbol: string, snapshot: BookSnapshot): void {
    for (const h of this.subs.get(symbol) ?? []) h(snapshot);
  }
}

export class BinanceTapeFeedAdapter implements TapeFeed {
  private readonly ws: WsClient;
  private readonly log: LoggerPort | undefined;
  private readonly conns = new Map<string, WsConnection>();
  private readonly subs = new Map<string, Set<Handler<TapeTrade>>>();

  constructor(ws: WsClient, log?: LoggerPort) {
    this.ws = ws;
    this.log = log;
  }

  startSymbol(symbol: string): Promise<void> {
    if (this.conns.has(symbol)) return Promise.resolve();
    const stream = `/ws/${symbol.toLowerCase()}@aggTrade`;
    const conn = this.ws.connect(stream);
    conn.onMessage((text) => {
      const raw = JSON.parse(text) as BinanceAggTradeRaw;
      const trade = parseAggTrade(raw);
      for (const h of this.subs.get(symbol) ?? []) h(trade);
    });
    conn.onClose((code) => {
      this.log?.warn({ event: "ws.close", symbol, code }, "ws.close");
      this.conns.delete(symbol);
    });
    conn.onError((err) => {
      this.log?.error({ event: "ws.error", symbol, msg: err.message }, "ws.error");
    });
    this.conns.set(symbol, conn);
    return Promise.resolve();
  }

  stopSymbol(symbol: string): Promise<void> {
    const conn = this.conns.get(symbol);
    if (conn !== undefined) conn.close();
    this.conns.delete(symbol);
    return Promise.resolve();
  }

  subscribeTape(symbol: string, handler: Handler<TapeTrade>): Unsubscribe {
    const set = this.subs.get(symbol) ?? new Set<Handler<TapeTrade>>();
    set.add(handler);
    this.subs.set(symbol, set);
    return () => {
      const cur = this.subs.get(symbol);
      cur?.delete(handler);
    };
  }
}
