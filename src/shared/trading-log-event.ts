/**
 * Typed observability events (architecture §7). Redaction happens in infrastructure.
 */
export type TradingLogEventName =
  | "order.submit"
  | "order.ack"
  | "order.reject"
  | "fill"
  | "cancel"
  | "risk.limit"
  | "supervisor.stats";

export interface TradingLogEvent {
  readonly event: TradingLogEventName;
  readonly symbol?: string;
  readonly orderId?: string;
  readonly clientOrderId?: string;
  /** Non-secret business fields only */
  readonly extra?: Record<string, unknown>;
}
