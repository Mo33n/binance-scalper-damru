/**
 * Dev / tsx: worker threads do not reliably apply `--import tsx` to nested ESM resolution
 * (e.g. `position-ledger.js` → `position-ledger.ts`). Register tsx hooks in this isolate,
 * then load the real worker module.
 */
import { register } from "tsx/esm/api";

register();

await import(new URL("./symbol-worker.ts", import.meta.url).href);
