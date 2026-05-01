/**
 * SPEC-04: Live testnet WebSocket smoke belongs here when wired with mocks or env gates.
 * Kept skipped in CI; extend with `vi.mock("ws")` or recorded fixtures as needed.
 */
import { describe, it } from "vitest";

describe.skip("market-data-runner integration (SPEC-04)", () => {
  it("reserved — connect depth + aggTrade against testnet or mocked transport", () => {});
});
