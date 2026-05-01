# Testnet limitations

Binance **USD-M futures testnet** is useful for integration testing but **does not replicate production trading**. Treat fills, liquidity, and operational behavior as **non-representative** when tuning economics or risk.

## Liquidity

- Order books are often **thin**; quoted spreads and queue priority **will not** match live markets.
- Large clips can move the touch or fail POST_ONLY constraints in ways that rarely occur on production books.

## Fees and economics

- Fee tiers and maker/taker economics may **differ** from production; fee endpoints still matter for plumbing tests, not for final PnL calibration.
- Use production fee schedules only when validating **live** configs (see [promotion-checklist.md](./promotion-checklist.md)).

## WebSocket stability

- Depth and aggTrade streams may **disconnect or lag** more often than production.
- The codebase applies **book resync / staleness** guards; expect more `marketdata.book_resync` or skip logs on testnet than on live.

## Fill realism

- Fill rates, partial fills, and latency **do not** predict production microstructure.
- **Markout** and adverse-selection metrics from testnet are **directional only**—do not promote size on testnet markout alone.

## URL matrix (testnet vs production)

| Traffic | Testnet (typical config) | Production |
|--------|---------------------------|------------|
| REST base | `https://testnet.binancefuture.com` (example—confirm in [Binance docs](https://binance-docs.github.io/apidocs/futures/en/)) | `https://fapi.binance.com` |
| WS base | `wss://stream.binancefuture.com/ws` (testnet stream host per your profile) | `wss://fstream.binance.com/ws` |

Always set `environment`, `credentialProfile`, and URL triples **consistently** (see [config/README.md](../../config/README.md)).

---

*Last reviewed: 2026-05-01*
