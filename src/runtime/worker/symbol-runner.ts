import type { FillEvent } from "../../infrastructure/binance/user-stream.js";
import type { SupervisorCommand } from "../messaging/types.js";

export interface SymbolRunnerHandle {
  readonly workerId: string;
  readonly symbol: string;
  stop(): Promise<void>;
  sendCommand(cmd: SupervisorCommand): void;
}

export interface SymbolRunnerPort {
  startSymbolRunner(input: {
    symbol: string;
    workerId: string;
    onMessage(raw: string): void;
    onExit(): void;
  }): SymbolRunnerHandle;
  /** SPEC-08 — worker threads mirror venue fills into worker-local ledgers. */
  relayLedgerFill?(fill: FillEvent): void;
}
