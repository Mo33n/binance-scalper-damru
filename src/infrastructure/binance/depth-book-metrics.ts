/**
 * Optional hooks for depth pipeline observability (orderbook task list P4.2).
 * Implementations should be cheap; production default is undefined (no overhead).
 */
export interface DepthBookMetricsSink {
  readonly depthFramesIn?: () => void;
  readonly depthApplyOk?: () => void;
  readonly depthGap?: () => void;
  readonly depthResyncAttempt?: () => void;
  readonly depthParseError?: () => void;
  /** C8: oldest pending events dropped when queue exceeds cap (drop-oldest + continue; gap/resync may follow). */
  readonly depthPendingDrop?: (dropped: number) => void;
}
