import { describe, it, expect } from "vitest";
import { parseEnvelope, serializeEnvelope } from "../../../src/runtime/messaging/envelope.js";
import type { HeartbeatPayload } from "../../../src/runtime/messaging/types.js";

describe("MessageEnvelope", () => {
  it("roundtrips heartbeat payload", () => {
    const env = {
      v: 1 as const,
      kind: "heartbeat" as const,
      payload: {
        workerId: "w1",
        symbol: "BTCUSDT",
        seq: 3,
        sentAtMonotonicMs: 1234.5,
      } satisfies HeartbeatPayload,
    };
    const raw = serializeEnvelope(env);
    const back = parseEnvelope(raw);
    expect(back.kind).toBe("heartbeat");
    expect(back.payload).toEqual(env.payload);
  });

  it("rejects bad version", () => {
    expect(() => parseEnvelope(JSON.stringify({ v: 2, kind: "heartbeat", payload: {} }))).toThrow(
      /version/,
    );
  });

  it("accepts metric_delta kind", () => {
    const raw = serializeEnvelope({
      v: 1,
      kind: "metric_delta",
      payload: { workerId: "w1", symbol: "BTCUSDT", quoteVolumeDelta: 10 },
    });
    const back = parseEnvelope(raw);
    expect(back.kind).toBe("metric_delta");
  });
});
