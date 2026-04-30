import { describe, it, expect } from "vitest";
import { RealizedVolatility } from "../../../src/domain/signals/realized-vol.js";

describe("RealizedVolatility", () => {
  it("stays normal for flat mid", () => {
    const rv = new RealizedVolatility(0.001, 5);
    rv.onMid(100);
    rv.onMid(100);
    expect(rv.getRegime()).toBe("normal");
  });

  it("becomes stressed on sharp move", () => {
    const rv = new RealizedVolatility(1e-10, 5);
    rv.onMid(100);
    rv.onMid(120);
    expect(rv.getRegime()).toBe("stressed");
  });
});
