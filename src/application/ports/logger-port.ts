/**
 * Structured logging without binding to pino in domain/application contracts.
 * Implementations: pino wrapper in `infrastructure/logging`.
 */
export interface LoggerPort {
  debug(meta: Record<string, unknown>, msg?: string): void;
  info(meta: Record<string, unknown>, msg?: string): void;
  warn(meta: Record<string, unknown>, msg?: string): void;
  error(meta: Record<string, unknown>, msg?: string): void;
  child(bindings: Record<string, unknown>): LoggerPort;
}
