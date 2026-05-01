/**
 * Session-local mid cache for portfolio gross (RFC §4.3.4).
 * Each symbol runner records its latest mid; readers take a snapshot for pre-trade portfolio gate.
 * With `worker_threads`, only the local worker’s symbol is updated — global gross is incomplete unless IPC/shared marks exist.
 */
export class PortfolioMarkCoordinator {
  private readonly mids = new Map<string, number>();

  record(symbol: string, mid: number): void {
    if (Number.isFinite(mid) && mid > 0) {
      this.mids.set(symbol, mid);
    }
  }

  getMarks(): Record<string, number> {
    return Object.fromEntries(this.mids);
  }
}
