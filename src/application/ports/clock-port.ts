/**
 * Time abstraction: monotonic intervals vs UTC wall clock (RFC §12.1).
 * Implementations: `infrastructure/time/system-clock.ts`
 */
export interface ClockPort {
  monotonicNowMs(): number;
  utcIsoTimestamp(): string;
}
