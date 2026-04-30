import { describe, expect, it, vi } from "vitest";
import { ReconciliationService, classifyReconcileDiff } from "../../../src/application/services/reconciliation.js";

describe("reconciliation", () => {
  it("classifies unknown exchange order as critical", () => {
    const diff = classifyReconcileDiff(
      [{ symbol: "BTCUSDT", orderId: 1, price: 100, quantity: 1 }],
      [{ symbol: "BTCUSDT", orderId: 2, price: 100, quantity: 1 }],
      { symbol: "BTCUSDT", netQty: 0.1 },
      { symbol: "BTCUSDT", netQty: 0.1 },
    );
    expect(diff.severity).toBe("critical");
  });

  it("cancel-all executes on critical reconcile", async () => {
    const svc = new ReconciliationService();
    const cancelAll = vi.fn(async () => {});
    const out = await svc.reconcileOnce(
      {
        symbol: "BTCUSDT",
        localOrders: [{ symbol: "BTCUSDT", orderId: 1, price: 100, quantity: 1 }],
        localPosition: { symbol: "BTCUSDT", netQty: 0 },
      },
      {
        fetchOpenOrders: () => Promise.resolve([{ symbol: "BTCUSDT", orderId: 2, price: 101, quantity: 1 }]),
        fetchPosition: () => Promise.resolve({ symbol: "BTCUSDT", netQty: 0 }),
        fetchAccount: () => Promise.resolve({}),
        cancelAll,
      },
    );
    expect(out.diff.severity).toBe("critical");
    expect(cancelAll).toHaveBeenCalledTimes(1);
  });
});
