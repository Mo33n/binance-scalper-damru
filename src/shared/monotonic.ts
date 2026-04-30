import { performance } from "node:perf_hooks";

/** Monotonic milliseconds since arbitrary origin — use for intervals (RFC §12.1). */
export function monotonicNowMs(): number {
  return performance.now();
}
