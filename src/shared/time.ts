/** Wall clock timestamp in UTC ISO8601 for operator-facing logs. */
export function utcNowIso(): string {
  return new Date().toISOString();
}
