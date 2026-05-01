import type { BookFeed, TapeFeed, Unsubscribe } from "../../application/ports/market-data.js";
import type { BookSnapshot, TapeTrade } from "../../domain/market-data/types.js";
import { parseAggTrade, type BinanceAggTradeRaw } from "./agg-trades.js";
import type { BinanceRestClient } from "./rest-client.js";
import type { WsClient, WsConnection } from "./ws-client.js";
import type { LoggerPort } from "../../application/ports/logger-port.js";
import type { SymbolSpec } from "./types.js";
import type { DepthBookMetricsSink } from "./depth-book-metrics.js";
import { DepthSession, type DepthSessionHooks } from "./depth-session.js";
import { demuxCombinedDepthFrames, parseDepthStreamMessage } from "./depth-stream-parse.js";
import type { DepthSnapshotGatePort } from "./depth-snapshot-gate.js";
import { sharedDepthSnapshotGate } from "./depth-snapshot-gate.js";
import { sleepMs, wsReconnectBackoffMs } from "./depth-resync-policy.js";
import { binanceCombinedDepthStreamPath } from "./constants.js";

type Handler<T> = (item: T) => void;

/** @deprecated Use {@link DepthSessionHooks}; kept for call-site stability. */
export type BinanceBookFeedHooks = DepthSessionHooks;

export interface BinanceBookFeedAdapterOptions {
  readonly depthSnapshotGate?: DepthSnapshotGatePort;
  /** Forwarded to {@link DepthSession} for `book.starvation_warn` (e.g. `quoting.maxBookStalenessMs`). */
  readonly starvationWarnStalenessMs?: number;
  readonly metrics?: DepthBookMetricsSink;
  /** Override depth diff backlog cap (tests / constrained hosts). */
  readonly maxPendingDepthEvents?: number;
  /**
   * When true, one `/stream?streams=…` connection multiplexes depth for every spec in the ctor list.
   * Call {@link BinanceBookFeedAdapter.registerDepthHooks} per symbol when hooks differ (shared-book main thread).
   */
  readonly combinedDepth?: boolean;
}

interface FirstBootstrapDeferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (err: unknown) => void;
}

export class BinanceBookFeedAdapter implements BookFeed {
  private readonly rest: BinanceRestClient;
  private readonly ws: WsClient;
  private readonly log: LoggerPort | undefined;
  private readonly hooks: DepthSessionHooks | undefined;
  private readonly hooksBySymbol = new Map<string, DepthSessionHooks>();
  private readonly sessions = new Map<string, DepthSession>();
  private readonly conns = new Map<string, WsConnection>();
  private readonly subs = new Map<string, Set<Handler<BookSnapshot>>>();
  private readonly symbols = new Map<string, SymbolSpec>();
  private readonly depthSnapshotGate: DepthSnapshotGatePort;
  private readonly adapterOptions: BinanceBookFeedAdapterOptions;
  private readonly combinedDepth: boolean;
  private readonly combinedStreamPath: string;
  private readonly lifecycleAbort = new Map<string, AbortController>();
  private readonly firstBootstrap = new Map<string, FirstBootstrapDeferred>();
  /** Symbols with a reconnect loop running (between start and stop). */
  private readonly depthLifecycleActive = new Set<string>();
  /** Combined mode: symbols with {@link startSymbol} not yet stopped. */
  private readonly combinedActiveSymbols = new Set<string>();
  private combinedLifecycleAbort: AbortController | undefined;
  private combinedTransportOpen = false;

  constructor(
    rest: BinanceRestClient,
    ws: WsClient,
    specs: readonly SymbolSpec[],
    log?: LoggerPort,
    hooks?: DepthSessionHooks,
    options?: BinanceBookFeedAdapterOptions,
  ) {
    this.rest = rest;
    this.ws = ws;
    this.log = log;
    this.hooks = hooks;
    this.depthSnapshotGate = options?.depthSnapshotGate ?? sharedDepthSnapshotGate;
    this.adapterOptions = options ?? {};
    this.combinedDepth = this.adapterOptions.combinedDepth === true;
    this.combinedStreamPath = this.combinedDepth ? binanceCombinedDepthStreamPath(specs) : "";
    for (const s of specs) this.symbols.set(s.symbol, s);
  }

  /** Per-symbol gap hooks when one adapter is shared across symbols (combined depth). */
  registerDepthHooks(symbol: string, hooks: DepthSessionHooks): void {
    this.hooksBySymbol.set(symbol, hooks);
  }

  private resolveHooks(symbol: string): DepthSessionHooks | undefined {
    return this.hooksBySymbol.get(symbol) ?? this.hooks;
  }

  private createDepthSession(symbol: string, spec: SymbolSpec): DepthSession {
    const parseFrame = (sym: string, text: string) => {
      const r = parseDepthStreamMessage(sym, text);
      if (!r.ok) {
        this.log?.debug(
          { event: "book.depth_parse_skip", symbol: sym, reason: r.reason },
          "book.depth_parse_skip",
        );
        return null;
      }
      return r.event;
    };
    const h = this.resolveHooks(symbol);
    return new DepthSession({
      symbol,
      tickSize: spec.tickSize,
      rest: this.rest,
      snapshotGate: this.depthSnapshotGate,
      parseFrame,
      onEmit: (snapshot) => {
        this.emitBook(symbol, snapshot);
      },
      ...(this.log !== undefined ? { log: this.log } : {}),
      ...(h !== undefined ? { hooks: h } : {}),
      ...(this.adapterOptions.metrics !== undefined ? { metrics: this.adapterOptions.metrics } : {}),
      ...(this.adapterOptions.starvationWarnStalenessMs !== undefined
        ? { starvationWarnStalenessMs: this.adapterOptions.starvationWarnStalenessMs }
        : {}),
      ...(this.adapterOptions.maxPendingDepthEvents !== undefined
        ? { maxPendingDepthEvents: this.adapterOptions.maxPendingDepthEvents }
        : {}),
    });
  }

  private rejectAllPendingCombinedBootstraps(err: unknown): void {
    for (const sym of this.combinedActiveSymbols) {
      const d = this.firstBootstrap.get(sym);
      if (d !== undefined) {
        d.reject(err);
        this.firstBootstrap.delete(sym);
      }
    }
  }

  private dispatchCombinedDepthMessage(text: string): void {
    const r = demuxCombinedDepthFrames(text);
    if (!r.ok) {
      this.log?.debug(
        { event: "book.depth_combined_demux_skip", reason: r.reason },
        "book.depth_combined_demux_skip",
      );
      return;
    }
    for (const { symbol: sym, frameText } of r.items) {
      const session = this.sessions.get(sym);
      if (session === undefined) continue;
      session.ingestWsText(frameText);
    }
  }

  private async runCombinedDepthWsLifecycle(signal: AbortSignal): Promise<void> {
    let wsAttempt = 0;
    while (!signal.aborted) {
      const conn = this.ws.connect(this.combinedStreamPath);
      const untilClosed = new Promise<void>((resolve) => {
        conn.onClose((code) => {
          if (!signal.aborted) {
            this.log?.warn({ event: "book.ws_closed", mode: "combined_depth", code }, "book.ws_closed");
          }
          resolve();
        });
        conn.onError((err) => {
          if (!signal.aborted) {
            this.log?.error(
              { event: "book.ws_error", mode: "combined_depth", msg: err.message },
              "book.ws_error",
            );
          }
          resolve();
        });
      });

      conn.onMessage((text) => {
        this.dispatchCombinedDepthMessage(text);
      });

      try {
        await conn.whenOpen();
      } catch {
        conn.close();
        await sleepMs(wsReconnectBackoffMs(wsAttempt++));
        continue;
      }

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- signal may flip during await
      if (signal.aborted) {
        conn.close();
        return;
      }

      this.log?.info({ event: "book.ws_connected", mode: "combined_depth" }, "book.ws_connected");

      let bootstrapFailed = false;
      for (const sym of [...this.combinedActiveSymbols].sort()) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- combinedActiveSymbols may clear during await
        if (signal.aborted) break;
        const session = this.sessions.get(sym);
        if (session === undefined) continue;
        session.setTransportConnected(true);
        const ok = await session.bootstrapFromRest();
        if (!ok) {
          bootstrapFailed = true;
          break;
        }
        const d = this.firstBootstrap.get(sym);
        d?.resolve();
        this.firstBootstrap.delete(sym);
      }

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- AbortSignal narrows poorly across await
      if (signal.aborted) {
        conn.close();
        return;
      }

      if (bootstrapFailed) {
        this.rejectAllPendingCombinedBootstraps(new Error("book.bootstrap_exhausted"));
        for (const sym of this.combinedActiveSymbols) {
          this.sessions.get(sym)?.setTransportConnected(false);
          this.sessions.get(sym)?.notifyTransportDisconnect();
        }
        conn.close();
        await sleepMs(wsReconnectBackoffMs(wsAttempt++));
        continue;
      }

      this.combinedTransportOpen = true;
      wsAttempt = 0;

      await untilClosed;

      this.combinedTransportOpen = false;
      for (const sym of this.combinedActiveSymbols) {
        this.sessions.get(sym)?.setTransportConnected(false);
        this.sessions.get(sym)?.notifyTransportDisconnect();
      }
      conn.close();
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- AbortSignal narrows poorly across await
      if (signal.aborted) return;
      await sleepMs(wsReconnectBackoffMs(wsAttempt++));
    }
  }

  private bootstrapLateJoiner(symbol: string, deferred: FirstBootstrapDeferred): void {
    const session = this.sessions.get(symbol);
    if (session === undefined) {
      deferred.reject(new Error(`depth_session_missing:${symbol}`));
      this.firstBootstrap.delete(symbol);
      return;
    }
    void session.bootstrapFromRest().then((ok) => {
      if (!ok) {
        deferred.reject(new Error("book.bootstrap_exhausted"));
        this.firstBootstrap.delete(symbol);
        return;
      }
      deferred.resolve();
      this.firstBootstrap.delete(symbol);
    });
  }

  private async startSymbolCombined(symbol: string): Promise<void> {
    const spec = this.symbols.get(symbol);
    if (spec === undefined) throw new Error(`Unknown symbol spec: ${symbol}`);

    const waitFirst = this.firstBootstrap.get(symbol);
    if (waitFirst !== undefined) return waitFirst.promise;

    if (this.combinedActiveSymbols.has(symbol) && this.sessions.has(symbol)) {
      return Promise.resolve();
    }

    this.combinedActiveSymbols.add(symbol);

    let session = this.sessions.get(symbol);
    if (session === undefined) {
      session = this.createDepthSession(symbol, spec);
      this.sessions.set(symbol, session);
    }

    const deferred = this.createFirstBootstrapDeferred();
    this.firstBootstrap.set(symbol, deferred);

    try {
      if (this.combinedLifecycleAbort === undefined) {
        const ac = new AbortController();
        this.combinedLifecycleAbort = ac;
        void this.runCombinedDepthWsLifecycle(ac.signal).finally(() => {
          if (this.combinedLifecycleAbort === ac) {
            this.combinedLifecycleAbort = undefined;
          }
          this.combinedTransportOpen = false;
        });
      } else if (this.combinedTransportOpen) {
        this.bootstrapLateJoiner(symbol, deferred);
      }
    } catch (err) {
      this.firstBootstrap.delete(symbol);
      this.combinedActiveSymbols.delete(symbol);
      deferred.reject(err);
      throw err;
    }

    return deferred.promise;
  }

  async startSymbol(symbol: string): Promise<void> {
    if (this.combinedDepth) {
      return this.startSymbolCombined(symbol);
    }

    const spec = this.symbols.get(symbol);
    if (spec === undefined) throw new Error(`Unknown symbol spec: ${symbol}`);

    const waitFirst = this.firstBootstrap.get(symbol);
    if (waitFirst !== undefined) return waitFirst.promise;
    if (this.depthLifecycleActive.has(symbol)) return Promise.resolve();

    this.depthLifecycleActive.add(symbol);

    const deferred = this.createFirstBootstrapDeferred();
    this.firstBootstrap.set(symbol, deferred);

    try {
      const session = this.createDepthSession(symbol, spec);
      this.sessions.set(symbol, session);

      const ac = new AbortController();
      this.lifecycleAbort.set(symbol, ac);

      let firstBootstrapPending = true;
      const settleFirstOk = (): void => {
        if (!firstBootstrapPending) return;
        firstBootstrapPending = false;
        deferred.resolve();
        this.firstBootstrap.delete(symbol);
      };
      const settleFirstFail = (err: unknown): void => {
        if (!firstBootstrapPending) return;
        firstBootstrapPending = false;
        deferred.reject(err);
        this.firstBootstrap.delete(symbol);
      };

      void this.runDepthWsLifecycle(symbol, session, ac.signal, {
        onFirstBootstrapOk: settleFirstOk,
        onFirstBootstrapFail: settleFirstFail,
      }).finally(() => {
        this.depthLifecycleActive.delete(symbol);
        if (this.lifecycleAbort.get(symbol) === ac) {
          this.lifecycleAbort.delete(symbol);
        }
        if (firstBootstrapPending) {
          firstBootstrapPending = false;
          deferred.resolve();
          this.firstBootstrap.delete(symbol);
        }
      });
    } catch (err) {
      this.depthLifecycleActive.delete(symbol);
      this.firstBootstrap.delete(symbol);
      throw err;
    }

    return deferred.promise;
  }

  private createFirstBootstrapDeferred(): FirstBootstrapDeferred {
    let resolve: (() => void) | undefined;
    let reject: ((err: unknown) => void) | undefined;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    if (resolve === undefined || reject === undefined) {
      throw new Error("First-bootstrap promise failed to initialize");
    }
    return { promise, resolve, reject };
  }

  /**
   * Reconnect loop with exponential backoff (task list P3.1). First successful bootstrap settles
   * {@link startSymbol}'s promise; later reconnects are transparent to callers.
   */
  private async runDepthWsLifecycle(
    symbol: string,
    session: DepthSession,
    signal: AbortSignal,
    firstBoot: {
      readonly onFirstBootstrapOk: () => void;
      readonly onFirstBootstrapFail: (err: unknown) => void;
    },
  ): Promise<void> {
    const stream = `/ws/${symbol.toLowerCase()}@depth`;
    let wsAttempt = 0;

    while (!signal.aborted) {
      const conn = this.ws.connect(stream);
      this.conns.set(symbol, conn);

      const untilClosed = new Promise<void>((resolve) => {
        conn.onClose((code) => {
          if (!signal.aborted) {
            this.log?.warn({ event: "book.ws_closed", symbol, code }, "book.ws_closed");
          }
          resolve();
        });
        conn.onError((err) => {
          if (!signal.aborted) {
            this.log?.error({ event: "book.ws_error", symbol, msg: err.message }, "book.ws_error");
          }
          resolve();
        });
      });

      conn.onMessage((text) => {
        session.ingestWsText(text);
      });

      try {
        await conn.whenOpen();
      } catch {
        this.conns.delete(symbol);
        await sleepMs(wsReconnectBackoffMs(wsAttempt++));
        continue;
      }

      /* Abort can race `whenOpen` resolution; close stray socket before bootstrap. */
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- signal may flip during await
      if (signal.aborted) {
        conn.close();
        this.conns.delete(symbol);
        return;
      }

      session.setTransportConnected(true);
      this.log?.info({ event: "book.ws_connected", symbol }, "book.ws_connected");

      const bootstrapPromise = session.bootstrapFromRest();
      const raced = await Promise.race([
        bootstrapPromise.then((ok) => ({ tag: "boot" as const, ok })),
        untilClosed.then(() => ({ tag: "close" as const })),
      ]);

      if (raced.tag === "close") {
        session.setTransportConnected(false);
        session.notifyTransportDisconnect();
        void bootstrapPromise.then(() => {});
        conn.close();
        this.conns.delete(symbol);
        await sleepMs(wsReconnectBackoffMs(wsAttempt++));
        continue;
      }

      if (!raced.ok) {
        session.setTransportConnected(false);
        session.notifyTransportDisconnect();
        conn.close();
        this.conns.delete(symbol);
        firstBoot.onFirstBootstrapFail(new Error("book.bootstrap_exhausted"));
        await sleepMs(wsReconnectBackoffMs(wsAttempt++));
        continue;
      }

      firstBoot.onFirstBootstrapOk();

      await untilClosed;

      session.setTransportConnected(false);
      session.notifyTransportDisconnect();
      conn.close();
      this.conns.delete(symbol);
      await sleepMs(wsReconnectBackoffMs(wsAttempt++));
    }
  }

  stopSymbol(symbol: string): Promise<void> {
    if (this.combinedDepth) {
      const boot = this.firstBootstrap.get(symbol);
      if (boot !== undefined) {
        this.firstBootstrap.delete(symbol);
        boot.resolve();
      }
      this.hooksBySymbol.delete(symbol);
      this.combinedActiveSymbols.delete(symbol);
      const session = this.sessions.get(symbol);
      session?.dispose();
      this.sessions.delete(symbol);
      if (this.combinedActiveSymbols.size === 0) {
        this.combinedLifecycleAbort?.abort();
      }
      return Promise.resolve();
    }

    const boot = this.firstBootstrap.get(symbol);
    if (boot !== undefined) {
      this.firstBootstrap.delete(symbol);
      boot.resolve();
    }
    this.depthLifecycleActive.delete(symbol);
    this.lifecycleAbort.get(symbol)?.abort();
    this.lifecycleAbort.delete(symbol);
    const conn = this.conns.get(symbol);
    if (conn !== undefined) conn.close();
    this.conns.delete(symbol);
    const session = this.sessions.get(symbol);
    session?.dispose();
    this.sessions.delete(symbol);
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
    return this.sessions.get(symbol)?.getOrderBook().getSnapshot();
  }

  getBookStalenessMs(symbol: string): number | undefined {
    return this.sessions.get(symbol)?.getOrderBook().getStalenessMs();
  }

  getBookResyncCount(symbol: string): number {
    return this.sessions.get(symbol)?.getResyncCount() ?? 0;
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
