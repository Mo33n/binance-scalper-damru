import type { TimerRegistryPort } from "../application/ports/timer-registry-port.js";

/** SPEC-09 H4 — central registry; `clearAll` before supervisor stop in shutdown. */
export class TimerRegistry implements TimerRegistryPort {
  private readonly timers = new Map<string, ReturnType<typeof setInterval>>();

  register(id: string, timer: ReturnType<typeof setInterval>): void {
    const prev = this.timers.get(id);
    if (prev !== undefined) clearInterval(prev);
    this.timers.set(id, timer);
  }

  clearAll(): void {
    for (const t of this.timers.values()) {
      clearInterval(t);
    }
    this.timers.clear();
  }
}
