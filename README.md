<p align="center">
  <img src="Damru-logo.png" alt="DAMRU — Binance scalping bot" width="380" />
</p>

<p align="center">
  <strong>Binance scalper damru</strong><br />
  <sub>USD-M futures · VPIN-style flow toxicity · hybrid quoting · per-symbol workers · testnet/live aware risk rails</sub>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white" alt="Node 20+" />
  &nbsp;
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white" alt="TypeScript strict" />
</p>

<p align="center">
  <a href="DEVELOPERS.md">Developer guide</a>
  &nbsp;·&nbsp;
  <a href="config/README.md">Config</a>
  &nbsp;·&nbsp;
  <a href="DOCUMENTATION.md">Documentation map</a>
  &nbsp;·&nbsp;
  <a href=".github/PULL_REQUEST_TEMPLATE.md">PR checklist</a>
</p>

---

## Introduction

**Binance scalper damru** is a Node.js / TypeScript codebase for tight-spread micro-scalping on **Binance USD‑M**: VPIN-style flow buckets, hybrid quoting ideas, inventory and margin guardrails, and a supervisor-style runtime shaped for **one logical runner per symbol**. Think of it as a serious skeleton for a serious strategy—strict types, explicit config, and hexagonal boundaries so the scary parts stay testable.

**What you can use it for today**

- **Spin up locally** with `npm run dev`: validated config, structured startup logging, and a wired composition root—good for checking that your environment and JSON line up before you touch the exchange.
- **Learn and extend the strategy layer** in `src/domain/` with tests beside you; the linter keeps domain logic from accidentally depending on REST or WebSockets.
- **Tune risk and rollout** through the Zod-backed config in [config/README.md](config/README.md)—caps, fees, VPIN knobs, and small-live-style bundles—with `verify:rollout` and `verify:secrets` as guardrails in CI or before you push.
- **Optional testnet smoke**: hit public REST (`smoke:exchange-info`) when you want a quick reality check against Binance’s endpoints.

The **full live order loop** (real adapter in the default path, workers in production shape) is still under construction—check `src/infrastructure/binance/` and `src/runtime/worker/` as those areas evolve.

**Disclaimer:** Educational and engineering use only—not investment advice. You own your keys, your sizing, and your outages.

---

## Technical guidelines (how we want code to feel)

These are the rules of the road—short here, deep cuts in [DEVELOPERS.md](DEVELOPERS.md).

| Area | Guideline |
|------|-----------|
| **Architecture** | Hexagonal layout: `src/domain/**` and `src/application/ports/**` stay pure; no imports from `infrastructure/`, `runtime/`, or config loaders. ESLint enforces this—if it complains, fix the dependency direction, not the rule. |
| **Typing** | TypeScript **strict** (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). Public contracts (config, ports, DTOs) should export types where consumers need them. |
| **Config** | Single pipeline: defaults → JSON from `CONFIG_PATH` → env overrides. Documented in [config/README.md](config/README.md). The app does **not** auto-load `.env`; export vars or prefix commands. |
| **Tests & hygiene** | Tests default offline. Before a PR: `typecheck`, `lint`, `test`, `verify:secrets`, `build` (see [DEVELOPERS.md](DEVELOPERS.md)). |
| **Secrets** | Never commit keys. Use `npm run verify:secrets` locally; keep env files tight (`chmod 600` on machines you care about). |

Composition (wiring ports to adapters) lives in `src/bootstrap/composition.ts`—one place to see how the app is glued together.

---

## Community & engagement

- **Issues:** Bug reports, “how does X work?”, and design questions are welcome. A short repro or log snippet gets you faster answers.
- **Pull requests:** Follow [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md). Small, focused diffs beat kitchen-sink refactors.
- **Docs:** [DOCUMENTATION.md](DOCUMENTATION.md) links the in-repo map; [DEVELOPERS.md](DEVELOPERS.md) is the day-one handbook.
- **Star / fork:** If you’re building similar infra, a star helps others find the project; forks for experiments are encouraged.

We’re building in public with sharp tools and blunt honesty about what’s done and what isn’t. Come for the types; stay for the supervisor.

---

## Run and test locally

### Prerequisites

- **Node.js 20+** (see `package.json` → `engines`)
- **npm** (or compatible client)

### 1. Install

```bash
git clone <your-fork-or-repo-url>
cd binance-scalper-damru
npm install
```

### 2. Configuration

See [config/README.md](config/README.md) for merge order and schema.

**Important:** No automatic `.env` loading—values must be in `process.env` when the process starts.

- Copy [.env.example](.env.example) as a checklist of variable names, or export them in your shell.
- Point `CONFIG_PATH` at a file under `config/examples/`:

| File | Use |
|------|-----|
| `config/examples/minimal.json` | Minimal valid config (testnet-oriented) |
| `config/examples/testnet.json` | Testnet-oriented sample |
| `config/examples/live.json` | Live URLs + caps (do not commit real keys) |
| `config/examples/small-live.json` | First live tranche template |

- **`TRADING_ENV`** (or `APP_ENV`): `testnet` (default) or `live`. Must stay consistent with URLs; host allowlists enforce that at load time.

```bash
export TRADING_ENV=testnet
export CONFIG_PATH=config/examples/testnet.json
# Optional: API keys for real calls (never commit)
# export BINANCE_API_KEY=...
# export BINANCE_API_SECRET=...
```

### 3. Run

**Development (tsx):**

```bash
CONFIG_PATH=config/examples/testnet.json TRADING_ENV=testnet npm run dev
```

**Help:** `npm run dev -- --help`

**Production-style:**

```bash
npm run build
CONFIG_PATH=config/examples/testnet.json TRADING_ENV=testnet npm start
```

The entrypoint validates **config + bootstrap** and wires the stub exchange adapter today.

### 4. Tests, lint, hygiene

```bash
npm test
npm run test:watch
npm run typecheck
npm run lint
npm run verify:secrets
npm run verify:rollout
```

### 5. Optional: testnet REST smoke (network)

```bash
TESTNET_SMOKE=1 CONFIG_PATH=config/examples/testnet.json npm run smoke:exchange-info
```

If `TESTNET_SMOKE` is not `1`, the script exits 0 without calling the network.

### Quick reference

```bash
npm install
npm run typecheck && npm run lint && npm test
npm run verify:secrets
npm run verify:rollout
CONFIG_PATH=config/examples/testnet.json npm run dev
npm run build && CONFIG_PATH=config/examples/testnet.json npm start -- --help
```

---

## Security

- Never commit API keys or `.env` with real secrets.
- Use separate key material per environment; rotate via deployment env + restart.
- `credentialProfile` in config must match `environment` when set (see [config/README.md](config/README.md)).

---

## Contributing

Follow [DEVELOPERS.md](DEVELOPERS.md) and [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md). Good conversations start with a failing test or a clear issue.
