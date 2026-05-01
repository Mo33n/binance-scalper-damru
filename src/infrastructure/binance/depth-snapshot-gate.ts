import type { AppConfig } from "../../config/schema.js";
import { sleepMs } from "./depth-resync-policy.js";

/** Anything that serializes REST `/fapi/v1/depth` snapshot calls (`DepthSession`). */
export interface DepthSnapshotGatePort {
  runExclusive<T>(fn: () => Promise<T>): Promise<T>;
}

/** Shared lock buffer: Int32 lock @ 0, BigInt64 last snapshot start wall ms @ 8 (aligned). */
export const DEPTH_GATE_SHARED_BUFFER_BYTES = 16;

/**
 * Allocate zeroed {@link SharedArrayBuffer} for {@link SharedDepthSnapshotGate} (worker_threads).
 */
export function allocateDepthGateSharedBuffer(): SharedArrayBuffer {
  return new SharedArrayBuffer(DEPTH_GATE_SHARED_BUFFER_BYTES);
}

/**
 * Process-wide gate across threads: one in-flight REST depth snapshot at a time + optional min spacing.
 * Intended for `worker_threads` where each symbol used its own {@link DepthSnapshotConcurrencyGate}, multiplying traffic.
 *
 * **Use only from worker threads** (or any thread where `Atomics.wait` is acceptable). Do not call from the Node main thread.
 */
export class SharedDepthSnapshotGate implements DepthSnapshotGatePort {
  private readonly sab: SharedArrayBuffer;
  private readonly lock: Int32Array;
  private readonly lastStartWallMs: BigInt64Array;
  private readonly minIntervalMs: number;

  constructor(sharedBuffer: SharedArrayBuffer, minIntervalMs: number) {
    if (sharedBuffer.byteLength < DEPTH_GATE_SHARED_BUFFER_BYTES) {
      throw new Error(
        `SharedDepthSnapshotGate: SharedArrayBuffer must be at least ${DEPTH_GATE_SHARED_BUFFER_BYTES} bytes`,
      );
    }
    this.sab = sharedBuffer;
    this.lock = new Int32Array(this.sab, 0, 1);
    this.lastStartWallMs = new BigInt64Array(this.sab, 8, 1);
    this.minIntervalMs = minIntervalMs;
  }

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquireLock();
    try {
      await this.enforceMinSpacing();
      return await fn();
    } finally {
      this.releaseLock();
    }
  }

  private async enforceMinSpacing(): Promise<void> {
    if (this.minIntervalMs <= 0) return;
    const prev = this.lastStartWallMs[0];
    if (prev !== 0n) {
      const now = Date.now();
      const elapsed = now - Number(prev);
      const wait = this.minIntervalMs - elapsed;
      if (wait > 0) {
        await sleepMs(wait);
      }
    }
    this.lastStartWallMs[0] = BigInt(Date.now());
  }

  private async acquireLock(): Promise<void> {
    for (;;) {
      const prev = Atomics.compareExchange(this.lock, 0, 0, 1);
      if (prev === 0) return;
      Atomics.wait(this.lock, 0, 1);
    }
  }

  private releaseLock(): void {
    Atomics.store(this.lock, 0, 0);
    Atomics.notify(this.lock, 0, Number.POSITIVE_INFINITY);
  }
}

export function createSharedDepthSnapshotGate(
  sharedBuffer: SharedArrayBuffer,
  minIntervalMs: number,
): SharedDepthSnapshotGate {
  return new SharedDepthSnapshotGate(sharedBuffer, minIntervalMs);
}

/**
 * Limits concurrent REST `/fapi/v1/depth` snapshot fetches process-wide (RFC §11 SC4).
 * Optional minimum spacing between *starting* snapshots reduces bursty 429s when many symbols resync.
 */
export class DepthSnapshotConcurrencyGate implements DepthSnapshotGatePort {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly maxConcurrent: number;
  private readonly minIntervalMs: number;
  private lastSnapshotStartWallMs = 0;

  constructor(maxConcurrent = 4, minIntervalMs = 0) {
    this.maxConcurrent = maxConcurrent;
    this.minIntervalMs = minIntervalMs;
  }

  /** @internal Tests observe in-flight snapshot calls. */
  getActiveCountForTest(): number {
    return this.active;
  }

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquireSlot();
    await this.enforceMinSpacing();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private async enforceMinSpacing(): Promise<void> {
    if (this.minIntervalMs <= 0) return;
    const now = Date.now();
    const wait = this.lastSnapshotStartWallMs + this.minIntervalMs - now;
    if (wait > 0) {
      await sleepMs(wait);
    }
    this.lastSnapshotStartWallMs = Date.now();
  }

  private async acquireSlot(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next !== undefined) next();
  }
}

/** Build gate from loaded config (run-trader / single-thread symbol runners). */
export function createDepthSnapshotGate(binance: AppConfig["binance"]): DepthSnapshotConcurrencyGate {
  return new DepthSnapshotConcurrencyGate(
    binance.maxConcurrentDepthSnapshots,
    binance.depthSnapshotMinIntervalMs,
  );
}

/** Legacy tests / callers that omit `TradingSession.depthSnapshotGate` (max 4, no spacing). */
export const sharedDepthSnapshotGate = new DepthSnapshotConcurrencyGate(4, 0);
