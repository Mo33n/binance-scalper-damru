/**
 * Supervisor emits consolidated snapshots (RFC §11.2).
 */
export interface PortfolioSnapshotLine {
  readonly symbol: string;
  readonly quoteVolume?: number;
  readonly netPnlQuote?: number;
}

export interface PortfolioSnapshot {
  readonly emittedAtUtcIso: string;
  readonly portfolioNetPnlQuote?: number;
  readonly portfolioVolumeQuote?: number;
  readonly lines: readonly PortfolioSnapshotLine[];
}

export interface StatsSink {
  emitSnapshot(snapshot: PortfolioSnapshot): void;
}
