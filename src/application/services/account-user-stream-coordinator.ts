import type { BinanceRestClient } from "../../infrastructure/binance/rest-client.js";
import type { SignedCredentials } from "../../infrastructure/binance/signed-rest.js";
import type { WsClient } from "../../infrastructure/binance/ws-client.js";
import {
  closeListenKey,
  createListenKey,
  keepAliveListenKey,
} from "../../infrastructure/binance/user-stream.js";
import type { LoggerPort } from "../ports/logger-port.js";
import type { FillEvent } from "../../infrastructure/binance/user-stream.js";
import type { ExecutionService } from "./execution-service.js";
import type { TimerRegistryPort } from "../ports/timer-registry-port.js";
import type { PositionLedger } from "./position-ledger.js";
import { routeUserStreamJsonToLedgers } from "./user-stream-ledger-router.js";

const KEEPALIVE_MS = 25 * 60 * 1000;

export function maskListenKeySuffix(listenKey: string): string {
  if (listenKey.length <= 4) return "***";
  return `***${listenKey.slice(-4)}`;
}

export interface AccountUserStreamCoordinatorDeps {
  readonly rest: BinanceRestClient;
  readonly creds: SignedCredentials;
  readonly ws: WsClient;
  readonly log: LoggerPort;
  readonly monotonicNowMs: () => number;
  readonly execution: ExecutionService | undefined;
}

export class AccountUserStreamCoordinator {
  private readonly deps: AccountUserStreamCoordinatorDeps;
  private readonly symbolLedgers = new Map<string, PositionLedger>();
  private readonly fillListeners = new Set<(fill: FillEvent) => void>();
  private listenKey: string | undefined;
  private keepAliveTimer: ReturnType<typeof setInterval> | undefined;
  private conn: ReturnType<WsClient["connect"]> | undefined;
  private active = false;

  constructor(deps: AccountUserStreamCoordinatorDeps) {
    this.deps = deps;
  }

  registerSymbol(symbol: string, ledger: PositionLedger): void {
    const prev = this.symbolLedgers.get(symbol);
    if (prev === ledger) return;
    if (prev !== undefined) {
      this.deps.log.warn(
        { event: "userstream.register_symbol_replaced", symbol },
        "userstream.register_symbol_replaced",
      );
    }
    this.symbolLedgers.set(symbol, ledger);
  }

  /** SPEC-08 — relay fills to worker threads (no secrets; numeric fill payload only). */
  registerFillListener(listener: (fill: FillEvent) => void): void {
    this.fillListeners.add(listener);
  }

  async start(opts?: { readonly timerRegistry?: TimerRegistryPort }): Promise<void> {
    if (this.active) return;

    if (this.deps.execution === undefined) {
      this.deps.log.info({ event: "userstream.skipped_read_only" }, "userstream.skipped_read_only");
      return;
    }

    const key = await createListenKey(this.deps.rest, this.deps.creds);
    this.listenKey = key;
    this.deps.log.info(
      { event: "userstream.listenkey.created", listenKeyMasked: maskListenKeySuffix(key) },
      "userstream.listenkey.created",
    );

    const path = `/${key}`;
    const conn = this.deps.ws.connect(path);
    this.conn = conn;
    conn.onMessage((text) => {
      try {
        const raw = JSON.parse(text) as Record<string, unknown>;
        const fill = routeUserStreamJsonToLedgers(raw, this.symbolLedgers, this.deps.monotonicNowMs());
        if (fill !== undefined) {
          for (const fn of this.fillListeners) {
            try {
              fn(fill);
            } catch {
              this.deps.log.warn({ event: "userstream.fill_listener_error", symbol: fill.symbol }, "userstream.fill_listener_error");
            }
          }
        }
      } catch {
        this.deps.log.warn({ event: "userstream.parse_error" }, "userstream.parse_error");
      }
    });
    conn.onClose((code) => {
      this.deps.log.warn({ event: "userstream.ws_closed", code }, "userstream.ws_closed");
    });
    conn.onError((err) => {
      this.deps.log.warn({ event: "userstream.ws_error", msg: err.message }, "userstream.ws_error");
    });

    this.keepAliveTimer = setInterval(() => {
      void keepAliveListenKey(this.deps.rest, this.deps.creds, key).catch(() => {
        this.deps.log.warn({ event: "userstream.keepalive_failed" }, "userstream.keepalive_failed");
      });
    }, KEEPALIVE_MS);
    opts?.timerRegistry?.register("userstream_listenkey_keepalive", this.keepAliveTimer);

    this.active = true;
  }

  async stop(): Promise<void> {
    if (this.keepAliveTimer !== undefined) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = undefined;
    }
    this.conn?.close();
    this.conn = undefined;

    const key = this.listenKey;
    this.listenKey = undefined;
    this.active = false;

    if (key !== undefined) {
      try {
        await closeListenKey(this.deps.rest, this.deps.creds, key);
      } catch {
        this.deps.log.warn({ event: "userstream.listenkey.close_failed" }, "userstream.listenkey.close_failed");
      }
    }
  }
}
