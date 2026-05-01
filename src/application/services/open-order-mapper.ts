import type { OpenOrderView } from "../../domain/liquidity/target-book.js";

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

/** Map Binance USD-M `GET /fapi/v1/openOrders` JSON array to resting LIMIT legs (remaining qty). */
export function mapBinanceOpenOrdersResponse(raw: unknown): OpenOrderView[] {
  if (!Array.isArray(raw)) return [];
  const out: OpenOrderView[] = [];
  for (const row of raw) {
    if (!isRecord(row)) continue;
    const type = String(row["type"] ?? "");
    const status = String(row["status"] ?? "");
    if (type !== "LIMIT") continue;
    if (status !== "NEW" && status !== "PARTIALLY_FILLED") continue;
    const orderId = Number(row["orderId"]);
    const side = String(row["side"]);
    if (side !== "BUY" && side !== "SELL") continue;
    const price = Number(row["price"]);
    const orig = Number(row["origQty"] ?? "0");
    const exec = Number(row["executedQty"] ?? "0");
    const rem = orig - exec;
    if (!Number.isFinite(orderId) || !Number.isFinite(price) || !Number.isFinite(rem) || rem <= 0) {
      continue;
    }
    out.push({
      orderId,
      side,
      price,
      quantity: rem,
    });
  }
  return out;
}
