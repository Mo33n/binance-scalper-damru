import type { ToxicitySnapshot } from "../../domain/signals/types.js";

/** Narrow book fields the quoting orchestrator reads (SPEC-05). */
export interface QuotingReadModelView {
  readonly quotingPausedForBookResync: boolean;
  readonly bestBidPx: number | undefined;
  readonly bestAskPx: number | undefined;
}

export interface QuotingSnapshot {
  readonly readModel: QuotingReadModelView;
  /** Ms since last book apply; `Infinity` when never applied. */
  readonly stalenessMs: number;
  readonly toxicity: ToxicitySnapshot;
  readonly rvRegime: "normal" | "stressed";
}
