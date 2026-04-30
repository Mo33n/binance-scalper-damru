import { describe, it, expect } from "vitest";
import { utcNowIso } from "../../../src/shared/time.js";

describe("utcNowIso", () => {
  it("returns an ISO UTC timestamp string", () => {
    const ts = utcNowIso();
    expect(() => new Date(ts)).not.toThrow();
    expect(ts).toMatch(/Z$/);
  });
});
