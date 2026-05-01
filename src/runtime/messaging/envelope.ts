export type MessageKind =
  | "heartbeat"
  | "worker_fatal"
  | "supervisor_cmd"
  | "metric_delta"
  | "request_shutdown"
  /** SPEC-08 — venue fill relay to worker-local ledger (structured clone / JSON-safe). */
  | "ledger_fill"
  /** SPEC-09 — regime / risk: runner requests `HALT_QUOTING` with structured reason. */
  | "halt_request";

export interface MessageEnvelope<T = unknown> {
  readonly v: 1;
  readonly kind: MessageKind;
  readonly payload: T;
}

export function serializeEnvelope<T>(envelope: MessageEnvelope<T>): string {
  return JSON.stringify(envelope);
}

export function parseEnvelope(raw: string): MessageEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("envelope: invalid JSON");
  }
  if (!isRecord(parsed)) {
    throw new Error("envelope: expected object");
  }
  if (parsed["v"] !== 1) {
    throw new Error("envelope: unknown version");
  }
  const kind = parsed["kind"];
  if (
    kind !== "heartbeat" &&
    kind !== "worker_fatal" &&
    kind !== "supervisor_cmd" &&
    kind !== "metric_delta" &&
    kind !== "request_shutdown" &&
    kind !== "ledger_fill" &&
    kind !== "halt_request"
  ) {
    throw new Error("envelope: invalid kind");
  }
  return {
    v: 1,
    kind,
    payload: parsed["payload"],
  };
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}
