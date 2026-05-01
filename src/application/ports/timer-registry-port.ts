/**
 * SPEC-09 — register `setInterval` handles so shutdown can clear them in one place.
 * Implemented by `TimerRegistry` in `src/runtime/timer-registry.ts`.
 */
export interface TimerRegistryPort {
  register(id: string, timer: ReturnType<typeof setInterval>): void;
}
