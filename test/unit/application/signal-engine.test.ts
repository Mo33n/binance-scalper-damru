import { describe, it, expect } from "vitest";
import { SignalEngine } from "../../../src/application/services/signal-engine.js";
import type { ClockPort } from "../../../src/application/ports/clock-port.js";

function fakeClock(now: number): ClockPort {
  return {
    monotonicNowMs: () => now,
    utcIsoTimestamp: () => new Date(0).toISOString(),
  };
}

describe("SignalEngine", () => {
  it("produces toxicity snapshot from tape events", () => {
    const eng = new SignalEngine(
      {
        targetBucketVolume: 1,
        basis: "base",
        ewmaN: 3,
        staleFlushMs: 1000,
        rvEnabled: false,
        rvTau: 0.001,
      },
      fakeClock(0),
    );
    eng.onTapeEvent({
      symbol: "BTCUSDT",
      tradeId: 1,
      price: 100,
      quantity: 1,
      side: "buy",
      eventTimeMs: 0,
    });
    const snap = eng.getSnapshot();
    expect(snap.bucketIndex).toBe(1);
    expect(snap.toxicityScore).toBeGreaterThanOrEqual(0);
  });

  it("updates RV regime from book mids", () => {
    const eng = new SignalEngine(
      {
        targetBucketVolume: 10,
        basis: "base",
        ewmaN: 3,
        staleFlushMs: 1000,
        rvEnabled: true,
        rvTau: 1e-10,
      },
      fakeClock(0),
    );
    eng.onBookEvent({
      symbol: "BTCUSDT",
      bids: [{ price: 100, qty: 1 }],
      asks: [{ price: 101, qty: 1 }],
      bestBid: { price: 100, qty: 1 },
      bestAsk: { price: 101, qty: 1 },
      spreadTicks: 1,
    });
    eng.onBookEvent({
      symbol: "BTCUSDT",
      bids: [{ price: 120, qty: 1 }],
      asks: [{ price: 121, qty: 1 }],
      bestBid: { price: 120, qty: 1 },
      bestAsk: { price: 121, qty: 1 },
      spreadTicks: 1,
    });
    expect(eng.getQuotingInputs().rvRegime).toBe("stressed");
  });

  it("getRvEwmaSigmaLn returns sqrt variance after mids", () => {
    const eng = new SignalEngine(
      {
        targetBucketVolume: 10,
        basis: "base",
        ewmaN: 10,
        staleFlushMs: 1000,
        rvEnabled: true,
        rvTau: 1,
      },
      fakeClock(0),
    );
    expect(eng.getRvEwmaSigmaLn()).toBeUndefined();
    eng.onBookEvent({
      symbol: "BTCUSDT",
      bids: [{ price: 100, qty: 1 }],
      asks: [{ price: 101, qty: 1 }],
      bestBid: { price: 100, qty: 1 },
      bestAsk: { price: 101, qty: 1 },
      spreadTicks: 1,
    });
    eng.onBookEvent({
      symbol: "BTCUSDT",
      bids: [{ price: 110, qty: 1 }],
      asks: [{ price: 111, qty: 1 }],
      bestBid: { price: 110, qty: 1 },
      bestAsk: { price: 111, qty: 1 },
      spreadTicks: 1,
    });
    const sigma = eng.getRvEwmaSigmaLn();
    expect(sigma).toBeDefined();
    expect(sigma!).toBeGreaterThan(0);
  });
});
