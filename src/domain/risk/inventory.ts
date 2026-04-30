export interface PositionState {
  readonly netQty: number;
  readonly avgEntryPrice?: number;
}

export interface FillLike {
  readonly side: "BUY" | "SELL";
  readonly quantity: number;
  readonly price: number;
}

export interface InventorySkew {
  readonly bidSizeMultiplier: number;
  readonly askSizeMultiplier: number;
}

export function applyFillToPosition(state: PositionState, fill: FillLike): PositionState {
  const signedQty = fill.side === "BUY" ? fill.quantity : -fill.quantity;
  const nextNet = state.netQty + signedQty;
  if (Math.abs(nextNet) < 1e-12) return { netQty: 0 };

  const prevAbs = Math.abs(state.netQty);
  const nextAbs = Math.abs(nextNet);
  const prevAvg = state.avgEntryPrice ?? fill.price;
  const sameDirection = state.netQty === 0 || Math.sign(state.netQty) === Math.sign(nextNet);

  if (!sameDirection) {
    if (nextAbs < prevAbs) {
      return { netQty: nextNet, avgEntryPrice: prevAvg };
    }
    return { netQty: nextNet, avgEntryPrice: fill.price };
  }

  const weighted = prevAvg * prevAbs + fill.price * Math.abs(signedQty);
  return { netQty: nextNet, avgEntryPrice: weighted / nextAbs };
}

export function computeInventorySkew(netQty: number, maxAbsQty: number): InventorySkew {
  const ratio = Math.min(1, Math.abs(netQty) / Math.max(1e-12, maxAbsQty));
  if (netQty > 0) {
    // long inventory: reduce bid aggressiveness, increase ask
    return {
      bidSizeMultiplier: 1 - 0.5 * ratio,
      askSizeMultiplier: 1 + 0.5 * ratio,
    };
  }
  if (netQty < 0) {
    return {
      bidSizeMultiplier: 1 + 0.5 * ratio,
      askSizeMultiplier: 1 - 0.5 * ratio,
    };
  }
  return { bidSizeMultiplier: 1, askSizeMultiplier: 1 };
}
