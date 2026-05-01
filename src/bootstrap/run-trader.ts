/**
 * Async orchestration entry (SPEC-01): config → exchange bootstrap → session handoff.
 * `--help` / `-h` MUST short-circuit before any config load or network I/O (see top of `runTrader`).
 */
import { createAppContext, logStartupConfig } from "./composition.js";
import { bootstrapExchangeContext } from "../application/services/bootstrap-exchange.js";
import {
  attachDevKeepAlive,
  shouldAttachDevKeepAlive,
  type DevKeepAliveHandle,
} from "../runtime/dev-keep-alive.js";
import { shutdownTradingProcess } from "../runtime/shutdown-coordinator.js";
import { SnapshotScheduler } from "../runtime/supervisor/snapshot-scheduler.js";
import { STARTUP_EVENTS } from "../shared/startup-events.js";
import { selectAcceptedSymbolSpecs } from "./select-accepted-symbols.js";
import { createTradingVenueHandles } from "./venue-factory.js";
import type { TradingSession } from "./trading-session-types.js";
import type { AppConfig } from "../config/schema.js";
import { PositionLedger, type PositionLedgerConfig } from "../application/services/position-ledger.js";
import { AccountUserStreamCoordinator } from "../application/services/account-user-stream-coordinator.js";
import { reconcileLedgerPositionsVsExchange } from "../application/services/position-reconcile.js";
import { fetchUsdMNetPositionQty } from "../infrastructure/binance/reconcile-rest.js";
import { createWsClient } from "../infrastructure/binance/ws-client.js";
import { MainThreadSymbolRunner } from "../runtime/worker/main-thread-symbol-runner.js";
import type { SymbolRunnerPort } from "../runtime/worker/symbol-runner.js";
import { WorkerSymbolRunnerPort } from "../runtime/worker/worker-symbol-runner-port.js";
import { LossGuard } from "../application/services/loss-guard.js";
import { TimerRegistry } from "../runtime/timer-registry.js";
import { Supervisor } from "../runtime/supervisor/supervisor.js";

export const STARTUP_TRADING_EVENTS = {
  noTradableSymbols: "bootstrap.no_tradable_symbols",
  bootstrapComplete: "trading.session.bootstrap_complete",
} as const;

let activeSupervisor: Supervisor | undefined;
let activeUserStreamCoordinator: AccountUserStreamCoordinator | undefined;
let activeTimerRegistry: TimerRegistry | undefined;
let activeSnapshotScheduler: SnapshotScheduler | undefined;
let activeDevKeepAliveHandle: DevKeepAliveHandle | undefined;
let activeShutdownHandler: (() => void) | undefined;

function clearTradingRuntimeRefs(): void {
  activeTimerRegistry = undefined;
  activeSnapshotScheduler = undefined;
  activeUserStreamCoordinator = undefined;
  activeSupervisor = undefined;
  activeDevKeepAliveHandle = undefined;
}

function positionLedgerConfigFromRisk(risk: AppConfig["risk"]): PositionLedgerConfig {
  return {
    maxAbsQty: risk.maxAbsQty,
    maxAbsNotional: risk.maxAbsNotional,
    globalMaxAbsNotional: risk.globalMaxAbsNotional,
    inventoryEpsilon: risk.inventoryEpsilon,
    maxTimeAboveEpsilonMs: risk.maxTimeAboveEpsilonMs,
  };
}

/** Stops the SPEC-03 supervisor + runners; for tests that start `runTrader` with timers. */
export async function stopSupervisorForTests(): Promise<void> {
  if (activeShutdownHandler !== undefined) {
    process.off("SIGINT", activeShutdownHandler);
    process.off("SIGTERM", activeShutdownHandler);
    activeShutdownHandler = undefined;
  }
  activeTimerRegistry?.clearAll();
  activeTimerRegistry = undefined;
  activeSnapshotScheduler?.stop();
  activeSnapshotScheduler = undefined;
  activeDevKeepAliveHandle?.dispose();
  activeDevKeepAliveHandle = undefined;
  if (activeSupervisor !== undefined) {
    await activeSupervisor.stopAll();
    activeSupervisor = undefined;
  }
  await activeUserStreamCoordinator?.stop();
  activeUserStreamCoordinator = undefined;
}

/** Placeholder for SPEC-03+ runtime wiring; logs completion only. */
export function continueTradingSession(session: TradingSession): Promise<void> {
  session.log.info(
    {
      event: STARTUP_TRADING_EVENTS.bootstrapComplete,
      symbolCount: session.bootstrap.symbols.length,
      tradingMode: session.venue.mode,
    },
    "trading.session.bootstrap_complete",
  );
  return Promise.resolve();
}

export async function runTrader(argv: readonly string[]): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    return;
  }

  const ctx = createAppContext();

  // Single config load path via createAppContext; log once before network bootstrap.
  logStartupConfig(ctx.log, ctx.config);

  let bootstrapResult;
  try {
    bootstrapResult = await bootstrapExchangeContext(ctx.config, ctx.log);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.log.error({ event: STARTUP_EVENTS.failed, errorMessage: msg }, "bootstrap.exchange_failed");
    process.exitCode = 1;
    return;
  }

  const decisionBySymbol = new Map(bootstrapResult.decisions.map((d) => [d.symbol, d]));
  for (const spec of bootstrapResult.symbols) {
    if (!decisionBySymbol.has(spec.symbol)) {
      ctx.log.warn(
        { event: "bootstrap.symbol.no_decision", symbol: spec.symbol },
        "bootstrap.symbol.no_decision",
      );
    }
  }

  const accepted = selectAcceptedSymbolSpecs(bootstrapResult);
  const narrowedBootstrap = Object.freeze({
    ...bootstrapResult,
    symbols: accepted,
  });

  if (accepted.length === 0) {
    const rejectedCount = bootstrapResult.decisions.filter((d) => d.status === "rejected").length;
    ctx.log.error(
      { event: STARTUP_TRADING_EVENTS.noTradableSymbols, rejectedCount },
      "bootstrap.no_tradable_symbols",
    );
    process.exitCode = 1;
    return;
  }

  const bootstrapOnly = {
    config: ctx.config,
    bootstrap: narrowedBootstrap,
    log: ctx.log,
    clock: ctx.clock,
  };

  const venue = createTradingVenueHandles({
    cfg: ctx.config,
    log: ctx.log,
    argv,
  });

  const session: TradingSession = {
    ...bootstrapOnly,
    venue,
  };

  ctx.log.info({ event: STARTUP_EVENTS.ready, exchange: ctx.exchange.environment }, "bootstrap.ready");

  await continueTradingSession(session);

  const specs = selectAcceptedSymbolSpecs(session.bootstrap);
  const attachMarketData = process.env["DAMRU_DISABLE_MARKET_DATA"] !== "1";

  activeUserStreamCoordinator = undefined;

  const timerRegistry = new TimerRegistry();
  activeTimerRegistry = timerRegistry;

  const positionLedger = new PositionLedger(positionLedgerConfigFromRisk(session.config.risk), session.log);

  const lossGuard = new LossGuard({
    sessionLossCapQuote: session.config.risk.sessionLossCapQuote,
    dailyLossCapQuote: session.config.risk.dailyLossCapQuote ?? session.config.risk.sessionLossCapQuote,
    cooldownMs: 60_000,
    allowTradingAfterKill: false,
  });
  const apiKey = session.config.credentials.apiKey;
  const apiSecret = session.config.credentials.apiSecret;
  if (apiKey && apiSecret) {
    activeUserStreamCoordinator = new AccountUserStreamCoordinator({
      rest: session.venue.rest,
      creds: { apiKey, apiSecret },
      ws: createWsClient(session.config.binance.wsBaseUrl, session.log),
      log: session.log,
      monotonicNowMs: () => session.clock.monotonicNowMs(),
      execution: session.venue.execution,
    });
  }

  const runners: SymbolRunnerPort = session.config.features.useWorkerThreads
    ? new WorkerSymbolRunnerPort({ session })
    : new MainThreadSymbolRunner({
        session,
        monotonicNowMs: () => session.clock.monotonicNowMs(),
        positionLedger,
        attachMarketData,
      });

  for (const s of specs) {
    activeUserStreamCoordinator?.registerSymbol(s.symbol, positionLedger);
  }

  activeUserStreamCoordinator?.registerFillListener((fill) => {
    runners.relayLedgerFill?.(fill);
  });
  const cancelAllForSymbol = async (sym: string): Promise<void> => {
    await session.venue.execution?.cancelAll(sym);
  };
  const supervisor = new Supervisor(
    {
      heartbeatIntervalMs: session.config.heartbeatIntervalMs,
      heartbeatMissThreshold: session.config.heartbeatMissThreshold,
    },
    {
      runners,
      statsSink: ctx.statsSink,
      nowUtcIso: () => session.clock.utcIsoTimestamp(),
      monotonicNowMs: () => session.clock.monotonicNowMs(),
      cancelAllForSymbol,
      log: session.log,
      lossGuard,
    },
  );
  activeSupervisor = supervisor;
  supervisor.startSymbols(specs.map((s) => s.symbol));

  await activeUserStreamCoordinator?.start({ timerRegistry });

  if (session.venue.execution !== undefined && apiKey && apiSecret) {
    const creds = { apiKey, apiSecret };
    const symbols = specs.map((s) => s.symbol);
    timerRegistry.register(
      "ledger_reconcile",
      setInterval(() => {
        void reconcileLedgerPositionsVsExchange({
          symbols,
          ledger: positionLedger,
          fetchNetQty: (sym) => fetchUsdMNetPositionQty(session.venue.rest, creds, sym),
          log: session.log,
          requestQuotingHalt: (sym) => {
            supervisor.broadcast({ type: "HALT_QUOTING", reason: `position_drift:${sym}` });
          },
        });
      }, session.config.reconciliationIntervalMs),
    );
  }

  const snapshotScheduler = new SnapshotScheduler();
  activeSnapshotScheduler = snapshotScheduler;
  snapshotScheduler.startEvery60s(supervisor, timerRegistry);

  timerRegistry.register(
    "supervisor_heartbeat_check",
    setInterval(() => {
      void supervisor.checkHeartbeats().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        session.log.error(
          { event: "supervisor.heartbeat_check_failed", msg },
          "supervisor.heartbeat_check_failed",
        );
      });
    }, session.config.heartbeatIntervalMs),
  );

  activeShutdownHandler = () => {
    void shutdownTradingProcess({
      supervisor,
      timerRegistry,
      userStream: activeUserStreamCoordinator,
      snapshotScheduler: activeSnapshotScheduler,
      devKeepAlive: activeDevKeepAliveHandle,
      log: session.log,
    }).finally(() => {
      if (activeShutdownHandler !== undefined) {
        process.off("SIGINT", activeShutdownHandler);
        process.off("SIGTERM", activeShutdownHandler);
        activeShutdownHandler = undefined;
      }
      clearTradingRuntimeRefs();
      process.exit(0);
    });
  };
  process.once("SIGINT", activeShutdownHandler);
  process.once("SIGTERM", activeShutdownHandler);

  if (shouldAttachDevKeepAlive(argv)) {
    activeDevKeepAliveHandle = attachDevKeepAlive(session.log, session.config, {
      registerSignalHandlers: false,
      timerRegistry,
    });
  }
}
