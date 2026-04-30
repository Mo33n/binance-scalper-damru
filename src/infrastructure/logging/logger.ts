/**
 * @deprecated Prefer `createPinoLogger` / `toLoggerPort` from `./pino-logger-adapter.js` for composition.
 * Kept for backward compatibility with `import { createLogger } from ".../logger.js"`.
 */
export { createPinoLogger as createLogger, toLoggerPort } from "./pino-logger-adapter.js";
export type { Logger } from "pino";
