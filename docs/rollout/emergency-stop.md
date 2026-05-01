# Emergency stop

How to **stop trading quickly** when running DAMRU (or any automated Binance client).

## Graceful process stop (preferred)

1. **SIGINT / SIGTERM** — send from the terminal (`Ctrl+C`) or process manager. The trading path SHOULD run the shutdown coordinator: broadcast `HALT_QUOTING`, clear interval registry, stop supervisor/runners, stop user stream, dispose dev keep-alive (SPEC-07 / SPEC-09).
2. Confirm in logs: `shutdown.complete` (or equivalent) and no recurring heartbeat/reconcile logs.

## Hard kill caveat (`kill -9`)

- **Immediate** termination: no graceful WS close, no guaranteed cancel-all burst.
- Open orders may remain until **Binance cancel TTL** or manual action.
- Use only when the process is wedged; follow with **manual cancel** (UI or API).

## Cancel via Binance UI

1. Log into **Binance Futures** with the same account as the API key.
2. Open **Positions / Orders** and **cancel all open orders** for the relevant symbol(s).
3. Optionally **close positions** if flattening is required (strategy-dependent).

## Disable API keys

1. Binance **API Management**: delete or **disable** the key used by the bot.
2. Rotate keys if compromise is suspected; update deployment secrets only on secure channels.

## Loss guard / supervisor halt

- Portfolio loss beyond configured caps triggers **`HALT_QUOTING`** with reason `session_loss_cap` (SPEC-09).
- Regime trips emit **`halt_request`** reasons such as `regime_book_stress` (SPEC-09).
- These reduce new quotes but **do not replace** process hygiene—still verify open orders on the exchange.

## Binance support / status

- Incidents: check Binance **official status** / announcements before blaming local code.
- Support channels are account-specific; keep ticket IDs out of public repos.

---

*Last reviewed: 2026-05-01*
