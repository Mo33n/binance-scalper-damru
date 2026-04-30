# Per-symbol worker

One **logical runner per symbol**: implementation targets `worker_threads` or child processes; the supervisor owns lifecycle and heartbeats (see this folder’s lifecycle section below).

## Lifecycle (target)

1. Supervisor receives validated symbol list from bootstrap.
2. For each symbol: spawn worker, pass `SymbolSpec` + ports (Epic G).
3. Worker connects market data, runs signal + quoting loop.
4. Worker emits **heartbeat** on `runtime/messaging` contract; on miss, supervisor cancels orders (§10.5).
5. On shutdown: stop accepting new work → cancel resting → join worker.

This folder will hold `symbol-worker.ts` and related when Epic G lands.
