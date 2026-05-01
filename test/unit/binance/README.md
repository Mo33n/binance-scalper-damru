# Unit tests — Binance / market data

| Module | File | Notes |
|--------|------|--------|
| `DepthOrderBook` | `depth-order-book.test.ts` | Bridge reorder, gaps, stale `u`, injected clock |
| `parseDepthStreamMessage` | `depth-stream-parse.test.ts` | Frame limits, combined envelope |
| Golden vectors | `depth-golden.test.ts` | JSON under `test/fixtures/depth/` |
| Resync policy | `depth-policy.test.ts` | Retriable HTTP, backoff bounds |
| Snapshot gate | `depth-snapshot-gate.test.ts` | ≤K concurrent REST depth fetches |
| Adapters + session | `binance-market-data-adapters.test.ts` | Fake WS/REST, gap/resync, C6-style re-queue |

**Gaps vs RFC §5–6:** C1 (no touch after gap until snapshot), C3 (disconnect mid-bootstrap), C8 (pending cap), and REST backoff are covered in `binance-market-data-adapters.test.ts` and `depth-*` tests; combined-stream demux (C9) remains optional (P6).
