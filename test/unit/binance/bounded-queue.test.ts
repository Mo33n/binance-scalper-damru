import { describe, it, expect } from "vitest";
import { BoundedQueue } from "../../../src/infrastructure/binance/bounded-queue.js";

describe("BoundedQueue", () => {
  it("drops oldest entries when full", () => {
    const q = new BoundedQueue<number>(2);
    q.push(1);
    q.push(2);
    q.push(3);
    expect(q.getDroppedCount()).toBe(1);
    expect(q.drain()).toEqual([2, 3]);
  });
});
