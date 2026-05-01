import { describe, expect, it } from "vitest";
import { shouldAttachDevKeepAlive } from "../../../src/runtime/dev-keep-alive.js";

describe("shouldAttachDevKeepAlive", () => {
  it("is false by default", () => {
    expect(shouldAttachDevKeepAlive(["node", "main.ts"], {})).toBe(false);
  });

  it("is true with --stay-alive", () => {
    expect(shouldAttachDevKeepAlive(["node", "main.ts", "--stay-alive"], {})).toBe(true);
  });

  it("respects DAMRU_STAY_ALIVE", () => {
    expect(shouldAttachDevKeepAlive(["node", "main.ts"], { DAMRU_STAY_ALIVE: "1" })).toBe(true);
    expect(shouldAttachDevKeepAlive(["node", "main.ts"], { DAMRU_STAY_ALIVE: "true" })).toBe(true);
    expect(shouldAttachDevKeepAlive(["node", "main.ts"], { DAMRU_STAY_ALIVE: "yes" })).toBe(true);
    expect(shouldAttachDevKeepAlive(["node", "main.ts"], { DAMRU_STAY_ALIVE: "0" })).toBe(false);
  });
});
