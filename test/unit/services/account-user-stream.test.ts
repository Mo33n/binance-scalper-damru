import { describe, expect, it } from "vitest";
import { maskListenKeySuffix } from "../../../src/application/services/account-user-stream-coordinator.js";

describe("AccountUserStreamCoordinator helpers", () => {
  it("masks listen key for logs", () => {
    expect(maskListenKeySuffix("abcd")).toBe("***");
    expect(maskListenKeySuffix("abcdefghijklmnop")).toBe("***mnop");
  });
});
