import { parentPort, workerData } from "node:worker_threads";
import { PositionLedger, type PositionLedgerConfig } from "../../application/services/position-ledger.js";
import type { SupervisorCommand } from "../messaging/types.js";
import type { FillEvent } from "../../infrastructure/binance/user-stream.js";
import { createWorkerExecutionService } from "../../bootstrap/worker-venue-factory.js";
import { createRateLimitedBinanceRestClient } from "../../application/services/rate-limited-binance-rest-client.js";
import { createPinoLogger, toLoggerPort } from "../../infrastructure/logging/pino-logger-adapter.js";
import { createSystemClock } from "../../infrastructure/time/system-clock.js";
import { parseWorkerBootstrapPayload } from "../messaging/worker-bootstrap.js";
import { parseEnvelope, serializeEnvelope } from "../messaging/envelope.js";
import { SymbolLoopRuntime } from "./symbol-loop.js";
import {
  createDepthSnapshotGate,
  createSharedDepthSnapshotGate,
} from "../../infrastructure/binance/depth-snapshot-gate.js";

function main(): void {
  let workerId = "unknown";
  let symbol = "unknown";

  try {
    const wd = workerData as { payload?: unknown; depthGateSab?: SharedArrayBuffer };
    const payload = parseWorkerBootstrapPayload(wd.payload);
    workerId = payload.workerId;
    symbol = payload.symbol;

    const log = toLoggerPort(createPinoLogger(`sym:${payload.symbol}`, payload.configSubset.logLevel));
    const clock = createSystemClock();
    const rest = createRateLimitedBinanceRestClient(
      { baseUrl: payload.configSubset.binance.restBaseUrl, log },
      () => clock.monotonicNowMs(),
    );
    const execution = createWorkerExecutionService(payload.configSubset.features, rest, log);
    const lc: PositionLedgerConfig = {
      maxAbsQty: payload.configSubset.risk.maxAbsQty,
      maxAbsNotional: payload.configSubset.risk.maxAbsNotional,
      globalMaxAbsNotional: payload.configSubset.risk.globalMaxAbsNotional,
      inventoryEpsilon: payload.configSubset.risk.inventoryEpsilon,
      maxTimeAboveEpsilonMs: payload.configSubset.risk.maxTimeAboveEpsilonMs,
    };
    const ledger = new PositionLedger(lc, log);
    const attachMarketData = process.env["DAMRU_DISABLE_MARKET_DATA"] !== "1";

    const binanceCfg = payload.configSubset.binance;
    const depthGate =
      wd.depthGateSab !== undefined
        ? createSharedDepthSnapshotGate(wd.depthGateSab, binanceCfg.depthSnapshotMinIntervalMs)
        : createDepthSnapshotGate(binanceCfg);

    const loop = SymbolLoopRuntime.start({
      workerId: payload.workerId,
      symbol: payload.symbol,
      spec: payload.spec,
      clock,
      binance: payload.configSubset.binance,
      depthSnapshotGate: depthGate,
      risk: payload.configSubset.risk,
      quoting: payload.configSubset.quoting,
      features: payload.configSubset.features,
      heartbeatIntervalMs: payload.configSubset.heartbeatIntervalMs,
      fees: payload.fees,
      decisions: payload.decisions,
      emitEnvelope: (msg) => {
        parentPort?.postMessage(msg);
      },
      monotonicNowMs: () => clock.monotonicNowMs(),
      attachMarketData,
      positionLedger: ledger,
      execution,
      log,
      rest,
    });

    parentPort?.on("message", (data: unknown) => {
      let env;
      try {
        env = parseEnvelope(String(data));
      } catch {
        return;
      }
      if (env.kind === "supervisor_cmd") {
        loop.sendCommand(env.payload as SupervisorCommand);
        return;
      }
      if (env.kind === "ledger_fill") {
        loop.applyLedgerFill(env.payload as FillEvent, clock.monotonicNowMs());
        return;
      }
      if (env.kind === "request_shutdown") {
        void loop.stop().catch(() => {});
      }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    parentPort?.postMessage(
      serializeEnvelope({
        v: 1,
        kind: "worker_fatal",
        payload: {
          workerId,
          symbol,
          errorName: err instanceof Error ? err.name : "Error",
          errorMessage: msg.slice(0, 500),
        },
      }),
    );
    throw err;
  }
}

try {
  main();
} catch {
  process.exit(1);
}
