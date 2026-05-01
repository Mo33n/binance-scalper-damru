export interface InventorySkewParams {
  readonly netQty: number;
  readonly maxAbsQty: number;
  readonly kappaTicks: number;
  readonly tickSize: number;
  readonly bidPx: number;
  readonly askPx: number;
  /** Cap \|shift\| in ticks (symmetric). */
  readonly maxShiftTicks?: number;
}

function roundToTick(price: number, tickSize: number): number {
  const rounded = Math.round(price / tickSize) * tickSize;
  const d = tickDecimals(tickSize);
  return Number(rounded.toFixed(d));
}

function tickDecimals(step: number): number {
  const s = step.toString();
  const idx = s.indexOf(".");
  return idx === -1 ? 0 : s.length - idx - 1;
}

/**
 * Inventory-aware price shift: **long** inventory shifts **both** bid and ask **down** by the same
 * amount (sell resting offers somewhat cheaper; bid less aggressive) — monotonic risk reduction on MM book.
 */
export function applyInventorySkew(params: InventorySkewParams): { readonly bidPx: number; readonly askPx: number } {
  const cap = params.maxAbsQty;
  if (!(cap > 0) || !Number.isFinite(cap)) {
    return { bidPx: params.bidPx, askPx: params.askPx };
  }
  const inv = params.netQty / cap;
  const shiftTicksRaw = params.kappaTicks * inv;
  let shiftTicks = Math.trunc(shiftTicksRaw);
  if (params.maxShiftTicks !== undefined) {
    const lim = Math.floor(params.maxShiftTicks);
    if (shiftTicks > lim) shiftTicks = lim;
    if (shiftTicks < -lim) shiftTicks = -lim;
  }
  const delta = shiftTicks * params.tickSize;
  return {
    bidPx: roundToTick(params.bidPx - delta, params.tickSize),
    askPx: roundToTick(params.askPx - delta, params.tickSize),
  };
}
