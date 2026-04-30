export interface ExchangeOrder {
  readonly symbol: string;
  readonly orderId: number;
  readonly price: number;
  readonly quantity: number;
}

export interface LocalOrder {
  readonly symbol: string;
  readonly orderId: number;
  readonly price: number;
  readonly quantity: number;
}

export interface PositionSnapshot {
  readonly symbol: string;
  readonly netQty: number;
}

export interface MarginSnapshot {
  readonly totalWalletBalance?: number;
  readonly totalUnrealizedProfit?: number;
}

export type ReconcileSeverity = "none" | "minor" | "critical";

export interface ReconcileDiff {
  readonly severity: ReconcileSeverity;
  readonly reasons: readonly string[];
}

export interface ReconcileDeps {
  fetchOpenOrders(symbol: string): Promise<readonly ExchangeOrder[]>;
  fetchPosition(symbol: string): Promise<PositionSnapshot>;
  fetchAccount(): Promise<MarginSnapshot>;
  cancelAll(symbol: string): Promise<void>;
}

export interface ReconcileStateInput {
  readonly symbol: string;
  readonly localOrders: readonly LocalOrder[];
  readonly localPosition: PositionSnapshot;
}

export interface ReconcileResult {
  readonly diff: ReconcileDiff;
  readonly reconcileRuns: number;
  readonly reconcileFailures: number;
}

export class ReconciliationService {
  private runs = 0;
  private failures = 0;

  async reconcileOnce(input: ReconcileStateInput, deps: ReconcileDeps): Promise<ReconcileResult> {
    this.runs += 1;
    try {
      const [exchangeOrders, exchangePos] = await Promise.all([
        deps.fetchOpenOrders(input.symbol),
        deps.fetchPosition(input.symbol),
        deps.fetchAccount(),
      ]);
      const diff = classifyReconcileDiff(input.localOrders, exchangeOrders, input.localPosition, exchangePos);
      if (diff.severity === "critical") {
        await deps.cancelAll(input.symbol);
      }
      return { diff, reconcileRuns: this.runs, reconcileFailures: this.failures };
    } catch {
      this.failures += 1;
      return {
        diff: { severity: "critical", reasons: ["reconcile_fetch_failed"] },
        reconcileRuns: this.runs,
        reconcileFailures: this.failures,
      };
    }
  }
}

export function classifyReconcileDiff(
  localOrders: readonly LocalOrder[],
  exchangeOrders: readonly ExchangeOrder[],
  localPosition: PositionSnapshot,
  exchangePosition: PositionSnapshot,
): ReconcileDiff {
  const reasons: string[] = [];
  const localIds = new Set(localOrders.map((o) => o.orderId));
  const exchangeIds = new Set(exchangeOrders.map((o) => o.orderId));
  for (const id of exchangeIds) {
    if (!localIds.has(id)) reasons.push("unknown_exchange_order");
  }
  for (const id of localIds) {
    if (!exchangeIds.has(id)) reasons.push("missing_exchange_order");
  }
  if (Math.abs(localPosition.netQty - exchangePosition.netQty) > 1e-9) {
    reasons.push("position_drift");
  }
  if (reasons.includes("unknown_exchange_order")) {
    return { severity: "critical", reasons };
  }
  if (reasons.length > 0) return { severity: "minor", reasons };
  return { severity: "none", reasons };
}
