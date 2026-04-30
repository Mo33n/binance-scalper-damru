import type { ClockPort } from "../../application/ports/clock-port.js";
import { monotonicNowMs } from "../../shared/monotonic.js";
import { utcNowIso } from "../../shared/time.js";

export function createSystemClock(): ClockPort {
  return {
    monotonicNowMs,
    utcIsoTimestamp: utcNowIso,
  };
}
