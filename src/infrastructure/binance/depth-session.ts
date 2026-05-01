/**
 * Per-symbol depth session: pending queue, bridge microtask batching, single-flight resync.
 * Owns one {@link DepthOrderBook} and the dispatch rules from RFC §4.3 (Option C).
 *
 * **Microtask invariant:** `queueMicrotask` only coalesces synchronous WS `onMessage` bursts.
 * Anything that `await`s (REST snapshot, timers) ends the synchronous turn; the next diff
 * is not batched with the prior microtask flush unless it arrives in the same sync stack.
 *
 * **Transport vs gap resync:** When the WebSocket drops, {@link notifyTransportDisconnect} desyncs
 * the book and pauses downstream via hooks; the adapter reconnects and calls {@link bootstrapFromRest}.
 * While {@link transportConnected} is false, sequence-gap-driven {@link scheduleResync} does not run
 * (REST snapshot without a live diff stream is delegated to the reconnect/bootstrap path).
 */
import type { BookSnapshot, DepthDiffEvent } from "../../domain/market-data/types.js";
import type { LoggerPort } from "../../application/ports/logger-port.js";
import { monotonicNowMs } from "../../shared/monotonic.js";
import type { DepthBookMetricsSink } from "./depth-book-metrics.js";
import {
  DepthOrderBook,
  orderDepthDiffsForBridge,
  type DepthSnapshotRaw,
} from "./depth-order-book.js";
import type { DepthSnapshotGatePort } from "./depth-snapshot-gate.js";
import { isRetriableDepthSnapshotError, restResyncBackoffMs, sleepMs } from "./depth-resync-policy.js";
import type { BinanceRestClient } from "./rest-client.js";

/** Optional hooks for gap/resync coordination (SPEC-04). */
export interface DepthSessionHooks {
  readonly onGap?: (symbol: string) => void;
}

export const DEFAULT_MAX_PENDING_DEPTH_EVENTS = 8000;
const REST_SNAPSHOT_MAX_ATTEMPTS = 8;
const STARVATION_LOG_COOLDOWN_MS = 60_000;

export interface DepthSessionDeps {
  readonly symbol: string;
  readonly tickSize: number;
  readonly rest: BinanceRestClient;
  readonly snapshotGate: DepthSnapshotGatePort;
  readonly log?: LoggerPort;
  readonly hooks?: DepthSessionHooks;
  /** Injected parse step (`BinanceBookFeedAdapter` wires `parseDepthStreamMessage`). */
  readonly parseFrame: (symbol: string, text: string) => DepthDiffEvent | null;
  readonly onEmit: (snapshot: BookSnapshot) => void;
  readonly metrics?: DepthBookMetricsSink;
  readonly monotonicNowMs?: () => number;
  /**
   * When the transport is connected and the book is synchronized, emit `book.starvation_warn`
   * if staleness exceeds this threshold (P4.4; typically align with `quoting.maxBookStalenessMs`).
   */
  readonly starvationWarnStalenessMs?: number;
  /** Override pending diff cap (default {@link DEFAULT_MAX_PENDING_DEPTH_EVENTS}). */
  readonly maxPendingDepthEvents?: number;
}

/**
 * Stateful depth pipeline for one symbol: WS diffs + REST snapshots, gap detection, resync.
 */
export class DepthSession {
  private readonly book: DepthOrderBook;
  private readonly deps: DepthSessionDeps;
  private readonly nowMs: () => number;
  private readonly maxPendingDepthEvents: number;
  private pendingDepth: DepthDiffEvent[] = [];
  private bridgeFlushMicrotaskScheduled = false;
  private resyncInflight: Promise<void> | undefined;
  private resyncCount = 0;
  private disposed = false;
  private transportConnected = false;
  private bookEpoch = 0;
  private lastStarvationWarnAt = 0;

  constructor(deps: DepthSessionDeps) {
    this.deps = deps;
    this.nowMs = deps.monotonicNowMs ?? monotonicNowMs;
    this.maxPendingDepthEvents = deps.maxPendingDepthEvents ?? DEFAULT_MAX_PENDING_DEPTH_EVENTS;
    this.book = new DepthOrderBook(deps.symbol, deps.tickSize, { nowMs: this.nowMs });
  }

  getOrderBook(): DepthOrderBook {
    return this.book;
  }

  getResyncCount(): number {
    return this.resyncCount;
  }

  /** Called by the adapter when the depth WebSocket is open (before bootstrap) and cleared on close. */
  setTransportConnected(connected: boolean): void {
    this.transportConnected = connected;
  }

  /**
   * WebSocket lost: invalidate book state so downstream pauses until the next REST snapshot on reconnect.
   * Does not schedule REST resync here — the adapter reconnects and runs {@link bootstrapFromRest}.
   */
  notifyTransportDisconnect(): void {
    this.bookEpoch++;
    this.book.forceDesyncForGap();
    this.pendingDepth = [];
    this.bridgeFlushMicrotaskScheduled = false;
    this.deps.hooks?.onGap?.(this.deps.symbol);
  }

  /**
   * After WS `whenOpen`, load REST depth and publish initial snapshot + flush any pre-sync buffer.
   * @returns whether a snapshot was applied (false when REST exhausted or session superseded).
   */
  async bootstrapFromRest(): Promise<boolean> {
    if (this.disposed) return false;
    const epochAtStart = this.bookEpoch;
    const snap = await this.fetchDepthSnapshotWithRetry("bootstrap", REST_SNAPSHOT_MAX_ATTEMPTS);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- dispose races async bootstrap
    if (this.disposed) return false;
    if (epochAtStart !== this.bookEpoch) return false;
    if (snap === undefined) return false;
    const initial = this.book.applySnapshot(snap);
    this.deps.onEmit(initial);
    this.flushPendingDepth();
    return true;
  }

  /**
   * One decoded WebSocket text frame (caller handles connection lifecycle).
   */
  ingestWsText(text: string): void {
    if (this.disposed) return;
    this.deps.metrics?.depthFramesIn?.();
    let evt: DepthDiffEvent | null;
    try {
      evt = this.deps.parseFrame(this.deps.symbol, text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.deps.metrics?.depthParseError?.();
      this.deps.log?.debug(
        { event: "book.depth_parse_error", symbol: this.deps.symbol, msg },
        "book.depth_parse_error",
      );
      this.checkStarvationWarn();
      return;
    }
    if (evt === null) {
      this.checkStarvationWarn();
      return;
    }

    if (this.book.getResyncRequired()) {
      this.enqueueDepthEvent(evt);
      this.checkStarvationWarn();
      return;
    }
    /** Applying live while `awaitingSnapshotBridge` false-gaps if the overlapping `[U,u]` packet is still in flight. */
    if (this.book.getBridgeAnchorWhenAwaiting() !== undefined) {
      this.enqueueDepthEvent(evt);
      this.scheduleDebouncedBridgeFlush();
      this.checkStarvationWarn();
      return;
    }
    this.applyDepthEvent(evt);
    this.checkStarvationWarn();
  }

  dispose(): void {
    this.disposed = true;
    this.pendingDepth = [];
    this.bridgeFlushMicrotaskScheduled = false;
    this.transportConnected = false;
  }

  private checkStarvationWarn(): void {
    const threshold = this.deps.starvationWarnStalenessMs;
    if (threshold === undefined || !this.transportConnected) return;
    if (this.book.getResyncRequired()) return;
    const now = this.nowMs();
    const staleness = this.book.getStalenessMs(now);
    if (staleness === undefined || staleness <= threshold) return;
    if (now - this.lastStarvationWarnAt < STARVATION_LOG_COOLDOWN_MS) return;
    this.lastStarvationWarnAt = now;
    this.deps.log?.debug(
      {
        event: "book.starvation_warn",
        symbol: this.deps.symbol,
        stalenessMs: staleness,
        thresholdMs: threshold,
      },
      "book.starvation_warn",
    );
  }

  private async fetchDepthSnapshotWithRetry(
    phase: "bootstrap" | "resync",
    maxAttempts: number,
  ): Promise<DepthSnapshotRaw | undefined> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (this.disposed) return undefined;
      this.deps.metrics?.depthResyncAttempt?.();
      this.deps.log?.debug(
        { event: "book.projection.resync_start", symbol: this.deps.symbol, phase, attempt },
        "book.projection.resync_start",
      );
      try {
        const snap = await this.deps.snapshotGate.runExclusive(() =>
          this.deps.rest.requestJson<DepthSnapshotRaw>({
            path: "/fapi/v1/depth",
            query: { symbol: this.deps.symbol, limit: 1000 },
          }),
        );
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- stopSymbol/dispose during REST
        if (this.disposed) {
          return undefined;
        }
        this.deps.log?.debug(
          { event: "book.projection.resync_ok", symbol: this.deps.symbol, phase, attempt },
          "book.projection.resync_ok",
        );
        return snap;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.deps.log?.warn(
          {
            event: "book.projection.resync_fail",
            symbol: this.deps.symbol,
            phase,
            attempt,
            msg,
          },
          "book.projection.resync_fail",
        );
        const terminal = !isRetriableDepthSnapshotError(err) || attempt === maxAttempts - 1;
        if (terminal) {
          this.deps.log?.warn(
            {
              event: "book.resync_exhausted",
              symbol: this.deps.symbol,
              phase,
              attempts: attempt + 1,
              msg,
            },
            "book.resync_exhausted",
          );
          return undefined;
        }
        await sleepMs(restResyncBackoffMs(attempt));
      }
    }
    return undefined;
  }

  private enqueueDepthEvent(evt: DepthDiffEvent): void {
    this.pendingDepth.push(evt);
    let dropped = 0;
    while (this.pendingDepth.length > this.maxPendingDepthEvents) {
      this.pendingDepth.shift();
      dropped += 1;
    }
    if (dropped > 0) {
      this.deps.metrics?.depthPendingDrop?.(dropped);
      this.deps.log?.warn(
        { event: "book.depth_pending_drop", symbol: this.deps.symbol, dropped },
        "book.depth_pending_drop",
      );
    }
  }

  /** Collapse multiple synchronous WS callbacks into one flush so bridge reorder sees the full batch. */
  private scheduleDebouncedBridgeFlush(): void {
    if (this.bridgeFlushMicrotaskScheduled) return;
    this.bridgeFlushMicrotaskScheduled = true;
    queueMicrotask(() => {
      this.bridgeFlushMicrotaskScheduled = false;
      this.flushPendingDepth();
    });
  }

  private flushPendingDepth(): void {
    if (this.disposed) return;
    if (this.pendingDepth.length === 0) return;

    const anchor = this.book.getBridgeAnchorWhenAwaiting();
    const ordered =
      anchor !== undefined
        ? orderDepthDiffsForBridge(anchor, this.pendingDepth)
        : ({ ok: true as const, events: this.pendingDepth });

    if (!ordered.ok) {
      this.book.forceDesyncForGap();
      /** Snapshots cannot use this buffer; keeping it caused stale diffs to block follow-up REST. */
      this.pendingDepth = [];
      this.emitGapAndScheduleResync();
      return;
    }

    this.pendingDepth = [];

    for (let i = 0; i < ordered.events.length; i++) {
      if (this.book.getResyncRequired()) {
        const tail = ordered.events.slice(i);
        if (tail.length > 0) {
          this.pendingDepth = [...tail, ...this.pendingDepth];
        }
        break;
      }
      const evt = ordered.events[i];
      if (evt === undefined) break;
      this.applyDepthEvent(evt);
    }
  }

  private emitGapAndScheduleResync(): void {
    this.resyncCount += 1;
    this.deps.metrics?.depthGap?.();
    this.deps.log?.debug({ event: "book.resync_required", symbol: this.deps.symbol }, "book.resync_required");
    this.deps.hooks?.onGap?.(this.deps.symbol);
    this.scheduleResync();
  }

  private applyDepthEvent(evt: DepthDiffEvent): void {
    const result = this.book.applyDiff(evt);
    if (result.kind === "updated") {
      this.deps.metrics?.depthApplyOk?.();
      this.deps.onEmit(result.snapshot);
    } else if (result.kind === "gap") {
      this.emitGapAndScheduleResync();
    }
  }

  /**
   * Gaps during {@link resyncDepth} → {@link flushPendingDepth} call {@link emitGapAndScheduleResync}
   * while `resyncInflight` is still set, so {@link scheduleResync} no-ops. Without a follow-up, the
   * book stays desynced until the next unrelated gap. Re-queue here when the job finishes.
   */
  private scheduleResync(): void {
    if (this.disposed) return;
    if (!this.transportConnected) return;
    if (this.resyncInflight !== undefined) return;
    const epochAtSchedule = this.bookEpoch;
    const job = this.resyncDepth(epochAtSchedule).finally(() => {
      this.resyncInflight = undefined;
      if (this.disposed) return;
      if (this.book.getResyncRequired() && this.transportConnected) {
        this.scheduleResync();
      }
    });
    this.resyncInflight = job;
    void job;
  }

  private async resyncDepth(epochAtStart: number): Promise<void> {
    if (this.disposed) return;
    const snap = await this.fetchDepthSnapshotWithRetry("resync", REST_SNAPSHOT_MAX_ATTEMPTS);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- dispose races async resync
    if (this.disposed) return;
    if (epochAtStart !== this.bookEpoch) return;
    if (snap === undefined) return;
    const snapshot = this.book.applySnapshot(snap);
    this.deps.onEmit(snapshot);
    this.flushPendingDepth();
  }
}
