import { describe, expect, it, vi } from "vitest";
import { createGracefulShutdown } from "../../../src/runtime/shutdown.js";

describe("shutdown", () => {
  it("broadcasts halt, cancels symbols, then stops supervisor", async () => {
    const calls: string[] = [];
    const supervisor = {
      broadcast: vi.fn(() => {
        calls.push("broadcast");
      }),
      stopAll: vi.fn(() => {
        calls.push("stopAll");
        return Promise.resolve();
      }),
    };
    const shutdown = createGracefulShutdown({
      supervisor: supervisor as never,
      symbols: () => ["BTCUSDT", "ETHUSDT"],
      cancelAllForSymbol: (symbol) => {
        calls.push(`cancel:${symbol}`);
        return Promise.resolve();
      },
    });
    await shutdown();
    expect(calls).toEqual(["broadcast", "cancel:BTCUSDT", "cancel:ETHUSDT", "stopAll"]);
  });
});
