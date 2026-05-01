/**
 * USD-M futures depth stream parsing — isolated from I/O so it is unit-testable.
 * Binance may wrap payloads in `{ data: { ... } }` for combined streams.
 */
import type { DepthDiffEvent } from "../../domain/market-data/types.js";

/** Default cap to reduce DoS risk from oversized WS frames (RFC orderbook rewrite §10). */
export const DEFAULT_MAX_DEPTH_FRAME_BYTES = 2 * 1024 * 1024;

export type DepthParseFailureReason = "oversized" | "json" | "shape" | "sequence_ids";

export type ParseDepthStreamResult =
  | { readonly ok: true; readonly event: DepthDiffEvent }
  | { readonly ok: false; readonly reason: DepthParseFailureReason };

interface DepthStreamRaw {
  readonly e?: string;
  readonly E?: number;
  readonly U: number;
  readonly u: number;
  readonly pu?: number;
  readonly b: readonly [string, string][];
  readonly a: readonly [string, string][];
}

/** Combined-stream envelopes wrap the diff under `data`. */
interface DepthStreamEnvelope {
  readonly data?: DepthStreamRaw;
}

export interface ParseDepthStreamOptions {
  /** Reject frames larger than this (UTF-8 byte length approximation via string length). */
  readonly maxFrameBytes?: number;
}

/**
 * Parse a single WebSocket text frame into a {@link DepthDiffEvent}.
 * Does not mutate the order book — projection happens in {@link DepthSession}.
 */
export function parseDepthStreamMessage(
  symbol: string,
  text: string,
  options?: ParseDepthStreamOptions,
): ParseDepthStreamResult {
  const maxBytes = options?.maxFrameBytes ?? DEFAULT_MAX_DEPTH_FRAME_BYTES;
  if (text.length > maxBytes) {
    return { ok: false, reason: "oversized" };
  }

  let outer: DepthStreamRaw & DepthStreamEnvelope;
  try {
    outer = JSON.parse(text) as DepthStreamRaw & DepthStreamEnvelope;
  } catch {
    return { ok: false, reason: "json" };
  }

  const payload: unknown = outer.data ?? outer;
  if (payload === null || typeof payload !== "object") {
    return { ok: false, reason: "shape" };
  }
  const row = payload as Record<string, unknown>;
  if (
    !Array.isArray(row["b"]) ||
    !Array.isArray(row["a"]) ||
    typeof row["U"] !== "number" ||
    typeof row["u"] !== "number"
  ) {
    return { ok: false, reason: "shape" };
  }
  const U = row["U"];
  const u = row["u"];
  if (!Number.isFinite(U) || !Number.isFinite(u)) {
    return { ok: false, reason: "sequence_ids" };
  }

  const bids = mapLevels(row["b"] as readonly [string, string][]);
  const asks = mapLevels(row["a"] as readonly [string, string][]);
  const pu = row["pu"];
  const eventTime = row["E"];
  return {
    ok: true,
    event: {
      symbol,
      firstUpdateId: U,
      finalUpdateId: u,
      bids,
      asks,
      ...(typeof pu === "number" && Number.isFinite(pu) ? { prevFinalUpdateId: pu } : {}),
      ...(typeof eventTime === "number" && Number.isFinite(eventTime) ? { eventTimeMs: eventTime } : {}),
    },
  };
}

function mapLevels(rows: readonly [string, string][]): { price: number; qty: number }[] {
  const out: { price: number; qty: number }[] = [];
  for (const [p, q] of rows) {
    const price = Number(p);
    const qty = Number(q);
    /** Skip malformed rows; Binance normally sends valid decimals. */
    if (!Number.isFinite(price) || !Number.isFinite(qty)) continue;
    out.push({ price, qty });
  }
  return out;
}

export interface CombinedDepthDemuxItem {
  readonly symbol: string;
  /** Original envelope JSON (includes `stream` + `data`) for {@link parseDepthStreamMessage}. */
  readonly frameText: string;
}

export type DemuxCombinedDepthResult =
  | { readonly ok: true; readonly items: readonly CombinedDepthDemuxItem[] }
  | { readonly ok: false; readonly reason: "oversized" | "json" | "shape" };

function streamKeyToSymbol(streamKey: string): string | null {
  const at = streamKey.indexOf("@");
  const sym = at < 0 ? streamKey : streamKey.slice(0, at);
  if (sym.length === 0) return null;
  return sym.toUpperCase();
}

function recordEventTimeMs(obj: Record<string, unknown>): number {
  const data = obj["data"];
  if (data !== null && typeof data === "object") {
    const E = (data as Record<string, unknown>)["E"];
    if (typeof E === "number" && Number.isFinite(E)) return E;
  }
  const top = obj["E"];
  if (typeof top === "number" && Number.isFinite(top)) return top;
  return 0;
}

/** RFC §5.2 — order within a combined batch: `(finalUpdateId, firstUpdateId)` then event time. */
function combinedBatchSortKey(obj: Record<string, unknown>): [number, number, number] {
  const data = obj["data"];
  const row = data !== null && typeof data === "object" ? (data as Record<string, unknown>) : obj;
  const u = row["u"];
  const U = row["U"];
  const uf = typeof u === "number" && Number.isFinite(u) ? u : 0;
  const Uf = typeof U === "number" && Number.isFinite(U) ? U : 0;
  return [uf, Uf, recordEventTimeMs(obj)];
}

/**
 * Demultiplex Binance combined-stream depth frames (`{ stream, data }` or an array of them).
 * Sorts batch elements deterministically before apply (tasks P6.2 / RFC §5.2).
 */
export function demuxCombinedDepthFrames(
  text: string,
  options?: Pick<ParseDepthStreamOptions, "maxFrameBytes">,
): DemuxCombinedDepthResult {
  const maxBytes = options?.maxFrameBytes ?? DEFAULT_MAX_DEPTH_FRAME_BYTES;
  if (text.length > maxBytes) {
    return { ok: false, reason: "oversized" };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "json" };
  }
  const packets: unknown[] = Array.isArray(raw) ? raw.slice() : [raw];
  if (packets.some((p) => p === null || typeof p !== "object")) {
    return { ok: false, reason: "shape" };
  }
  const objs = packets as Record<string, unknown>[];
  objs.sort((a, b) => {
    const [ua, Ua, Ea] = combinedBatchSortKey(a);
    const [ub, Ub, Eb] = combinedBatchSortKey(b);
    if (ua !== ub) return ua - ub;
    if (Ua !== Ub) return Ua - Ub;
    return Ea - Eb;
  });
  const items: CombinedDepthDemuxItem[] = [];
  for (const obj of objs) {
    const stream = obj["stream"];
    if (typeof stream !== "string") {
      return { ok: false, reason: "shape" };
    }
    const symbol = streamKeyToSymbol(stream);
    if (symbol === null) {
      return { ok: false, reason: "shape" };
    }
    items.push({ symbol, frameText: JSON.stringify(obj) });
  }
  return { ok: true, items };
}
