import type { StatsSink, PortfolioSnapshot } from "../../application/ports/stats-sink.js";
import type { LoggerPort } from "../../application/ports/logger-port.js";

/**
 * Default §11.2 sink: one structured log line (JSON) per snapshot; extend to pretty table later.
 */
export function createStdoutStatsSink(log: LoggerPort): StatsSink {
  return {
    emitSnapshot(snapshot: PortfolioSnapshot): void {
      log.info(
        {
          event: "supervisor.stats",
          at: snapshot.emittedAtUtcIso,
          portfolioNetPnlQuote: snapshot.portfolioNetPnlQuote,
          portfolioVolumeQuote: snapshot.portfolioVolumeQuote,
          perSymbol: snapshot.lines,
        },
        "portfolio_snapshot",
      );
    },
  };
}
