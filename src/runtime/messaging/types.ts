/**
 * Worker ↔ supervisor messages (RFC §4.2.3, §10.5).
 * Config: `heartbeatIntervalMs`, `heartbeatMissThreshold` in `AppConfig`.
 */
export type SupervisorCommand =
  | { readonly type: "HALT_QUOTING"; readonly reason: string }
  | { readonly type: "RESUME_QUOTING" }
  | { readonly type: "CANCEL_ALL"; readonly symbol: string };

export interface HeartbeatPayload {
  readonly workerId: string;
  readonly symbol: string;
  readonly seq: number;
  readonly sentAtMonotonicMs: number;
}

export interface WorkerFatalPayload {
  readonly workerId: string;
  readonly symbol: string;
  readonly errorName: string;
  readonly errorMessage: string;
}

export interface MetricDeltaPayload {
  readonly workerId: string;
  readonly symbol: string;
  readonly quoteVolumeDelta?: number;
  readonly pnlDeltaQuote?: number;
  readonly feesDeltaQuote?: number;
  readonly fundingDeltaQuote?: number;
  readonly disconnectsDelta?: number;
  readonly errorMessage?: string;
}

export interface RequestShutdownPayload {
  readonly workerId: string;
  readonly symbol: string;
  readonly reason: string;
}

/** SPEC-09 — runner asks supervisor to halt **this symbol only** (`haltQuotingForSymbol`). */
export interface HaltRequestPayload {
  readonly workerId: string;
  readonly symbol: string;
  readonly reason: string;
}
