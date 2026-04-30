import WebSocket from "ws";
import type { LoggerPort } from "../../application/ports/logger-port.js";

export interface WsConnection {
  close(): void;
  onMessage(cb: (text: string) => void): void;
  onClose(cb: (code: number) => void): void;
  onError(cb: (err: Error) => void): void;
}

export interface WsClient {
  connect(path: string): WsConnection;
}

export function createWsClient(baseWsUrl: string, log?: LoggerPort): WsClient {
  const base = baseWsUrl.replace(/\/+$/, "");
  return {
    connect(path: string): WsConnection {
      const ws = new WebSocket(`${base}${path}`);
      ws.on("open", () => {
        log?.info({ event: "ws.open", path }, "ws.open");
      });
      const conn: WsConnection = {
        close() {
          ws.close();
        },
        onMessage(cb) {
          ws.on("message", (raw: WebSocket.RawData) => {
            const text =
              typeof raw === "string"
                ? raw
                : Buffer.isBuffer(raw)
                  ? raw.toString("utf8")
                  : Array.isArray(raw)
                    ? Buffer.concat(raw).toString("utf8")
                    : Buffer.from(raw).toString("utf8");
            cb(text);
          });
        },
        onClose(cb) {
          ws.on("close", (code: number) => {
            cb(code);
          });
        },
        onError(cb) {
          ws.on("error", (err: Error) => {
            cb(err instanceof Error ? err : new Error(String(err)));
          });
        },
      };
      return conn;
    },
  };
}
