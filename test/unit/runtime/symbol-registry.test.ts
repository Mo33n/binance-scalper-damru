import { describe, it, expect } from "vitest";
import { SymbolRegistry } from "../../../src/runtime/supervisor/symbol-registry.js";

describe("SymbolRegistry", () => {
  it("replaces symbol set", () => {
    const r = new SymbolRegistry();
    r.replaceAll(["A", "B"]);
    expect(r.list()).toEqual(["A", "B"]);
    r.replaceAll(["C"]);
    expect(r.has("A")).toBe(false);
    expect(r.has("C")).toBe(true);
  });
});
