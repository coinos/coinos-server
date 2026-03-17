# Coinos

Coinos is a web-based bitcoin and nostr client. You can use it as a front end to your personal bitcoin and lightning nodes or host a public instance that allows anyone to register with a username and password. Try ours at https://coinos.io

This repository contains the code for the API server. The frontend code is at <a href="https://github.com/coinos/coinos-ui">https://github.com/coinos/coinos-ui</a>

## Quick Start (regtest)

```bash
git clone https://github.com/coinos/coinos-server.git
cd coinos-server
./setup.sh
```

The setup script handles everything automatically:

- Installs Docker if needed (Linux)
- Downloads a pre-built regtest snapshot (~2MB) with wallets, blocks, and Lightning channels
- Pulls container images (~500MB total, all sharing a common base)
- Starts all services

If the snapshot isn't available, it falls back to generating everything from scratch (wallets, blocks, channels). Use `./setup.sh --no-snapshot` to force this.

After setup:

| Service | URL |
|---|---|
| API server | http://localhost:3119 |
| Esplora (block explorer) | http://localhost:3000 |
| Nostr relay | ws://localhost:7777 |

To start the frontend: `cd ~/coinos-ui && bun dev`

## Requirements

- Linux or macOS
- [Docker](https://docs.docker.com/get-docker/) with the Compose plugin
- ~2GB free disk space

On Linux, the setup script installs Docker automatically. On macOS, install [Docker Desktop](https://docs.docker.com/desktop/install/mac-install/) first.

## Architecture

**Core services** (always running):
- **Coinos Server** — Hono/Bun API server
- **[Bitcoin Core](https://github.com/bitcoin/bitcoin)** — Bitcoin node (regtest)
- **[Core Lightning](https://docs.corelightning.org/)** — Lightning Network (3 nodes for testing)
- **[Valkey](https://valkey.io/)** — Redis-compatible database
- **[TigerBeetle](https://tigerbeetle.com/)** — Double-entry accounting ledger
- **[Liquid](https://liquid.net/)** — Bitcoin sidechain
- **[strfry](https://github.com/hoytech/strfry)** — Nostr relay
- **[Esplora](https://github.com/nicolgit/nigiri)** — Block explorer API (Chopsticks + Electrs)
- **[Kvrocks](https://kvrocks.apache.org/)** — Archive cache

**Optional** (commented out in `compose.yml`, uncomment to enable):
- **[Ark](https://arkade.fun/)** — Off-chain UTXO protocol
- **[Cashu Nutshell](https://github.com/cashubtc/nutshell)** — Ecash mint

All `asoltys/*` images share a common `coinos-base` layer, so Docker only downloads the base once.

## Useful Commands

```bash
# Mine a block
docker exec bc bitcoin-cli -regtest generatetoaddress 1 \
  $(docker exec bc bitcoin-cli -regtest getnewaddress)

# Check Lightning node
docker exec cl lightning-cli --network=regtest getinfo

# View logs
docker compose logs -f app

# Restart a service
docker compose restart app

# Stop everything
docker compose down

# Regenerate the regtest snapshot (maintainers)
./setup.sh snapshot
```

## Configuration

- `config.ts` — App config (generated from `config.ts.sample`)
- `compose.yml` — Docker Compose services (generated from `compose.yml.sample`)
- `data/` — Runtime data for all services

To reset: `rm -rf data config.ts compose.yml` and re-run `./setup.sh`.
