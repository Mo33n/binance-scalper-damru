import type { RvRegime } from "./types.js";

export class RealizedVolatility {
  private readonly tau: number;
  private readonly alpha: number;
  private lastMid?: number;
  private ewmaVar = 0;

  constructor(tau: number, ewmaN = 10) {
    this.tau = tau;
    this.alpha = 2 / (ewmaN + 1);
  }

  onMid(mid: number): void {
    if (!Number.isFinite(mid) || mid <= 0) return;
    if (this.lastMid !== undefined) {
      const r = Math.log(mid / this.lastMid);
      const v = r * r;
      this.ewmaVar = this.ewmaVar === 0 ? v : this.alpha * v + (1 - this.alpha) * this.ewmaVar;
    }
    this.lastMid = mid;
  }

  getVariance(): number {
    return this.ewmaVar;
  }

  getRegime(): RvRegime {
    return this.ewmaVar >= this.tau ? "stressed" : "normal";
  }
}
