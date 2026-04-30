import { monotonicNowMs } from "../../shared/monotonic.js";
import type { LoggerPort } from "../../application/ports/logger-port.js";

export class BinanceRestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly bodyText: string,
  ) {
    super(message);
    this.name = "BinanceRestError";
  }
}

export interface RestClientOptions {
  readonly baseUrl: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly log?: LoggerPort;
}

export interface JsonRequest {
  readonly method?: "GET" | "POST" | "DELETE" | "PUT";
  readonly path: string;
  readonly query?: Record<string, string | number | boolean | undefined>;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

export class BinanceRestClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly log: LoggerPort | undefined;

  constructor(opts: RestClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.log = opts.log;
  }

  async requestJson<T>(req: JsonRequest): Promise<T> {
    const method = req.method ?? "GET";
    const url = `${this.baseUrl}${req.path}${toQueryString(req.query)}`;
    const controller = new AbortController();
    const start = monotonicNowMs();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);
    try {
      const init: RequestInit = { method, signal: controller.signal };
      if (req.headers !== undefined) init.headers = req.headers;
      if (req.body !== undefined) init.body = req.body;
      const res = await this.fetchImpl(url, init);
      const elapsedMs = Math.round(monotonicNowMs() - start);
      this.log?.info(
        {
          event: "binance.rest",
          method,
          path: req.path,
          status: res.status,
          elapsedMs,
        },
        "binance.rest",
      );
      const text = await res.text();
      if (!res.ok) {
        throw new BinanceRestError(
          `Binance REST ${String(res.status)} on ${req.path}`,
          res.status,
          text,
        );
      }
      return (text.length === 0 ? ({} as T) : (JSON.parse(text) as T));
    } catch (err) {
      if (err instanceof BinanceRestError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Binance REST request failed (${req.path}): ${msg}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

function toQueryString(
  q: Record<string, string | number | boolean | undefined> | undefined,
): string {
  if (q === undefined) return "";
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined) continue;
    params.set(k, String(v));
  }
  const s = params.toString();
  return s.length > 0 ? `?${s}` : "";
}
