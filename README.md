# Coinos

A bitcoin web wallet with built-in support for Lightning, Liquid, Nostr, and Ark. Run it as a personal wallet on top of your own node, or deploy a public instance like [coinos.io](https://coinos.io).

This repo is the API server. The frontend is at [coinos/coinos-ui](https://github.com/coinos/coinos-ui).

## Getting Started

```bash
bash <(curl -s https://raw.githubusercontent.com/coinos/coinos-server/staging/setup.sh)
```

Or clone and run manually:

```bash
git clone https://github.com/coinos/coinos-server.git
cd coinos-server
./setup.sh
```

That's it. The script installs Docker if needed, downloads a pre-built regtest snapshot with funded wallets and Lightning channels, pulls ~500MB of container images, and starts everything. Takes a few minutes on first run.

```
API server     http://localhost:3119
Block explorer http://localhost:3000
Nostr relay    ws://localhost:7777
```

Start the frontend in a separate terminal:

```bash
cd ~/coinos-ui && bun dev
```

### Requirements

- Linux or macOS (Docker auto-installed on Linux; install [Docker Desktop](https://docs.docker.com/desktop/install/mac-install/) on macOS)
- ~2GB disk space

## How It Works

The server runs as a set of Docker containers orchestrated by `compose.yml`:

| Container | Image | What it does |
|-----------|-------|-------------|
| **app** | coinos-base | API server (Hono/Bun), bind-mounted from this repo |
| **bc** | bitcoin:30.2 | Bitcoin Core (regtest) |
| **lq** | elements:23.3.2 | Liquid sidechain |
| **cl, clb, clc** | lightningd:v25.12.1 | Core Lightning nodes (3 for testing) |
| **db** | valkey:8.0-alpine | User data (Redis-compatible) |
| **tb** | tigerbeetle | Double-entry accounting ledger |
| **sf** | strsrv | Nostr relay (strfry) |
| **cs** | chopsticks | Block explorer API |
| **eb** | electrs | Electrum server |
| **arc** | kvrocks | Archive cache (RocksDB-backed) |

All `ghcr.io/coinos/*` images share a common base layer (~196MB downloaded once).

### Optional Services

Uncomment in `compose.yml` to enable:

- **Ark** (arkd, arkd-wallet, nbxplorer) — off-chain UTXO protocol
- **Cashu** (nutshell) — ecash mint backed by Lightning

## Development

```bash
# Mine a block
docker exec bc bitcoin-cli -regtest generatetoaddress 1 \
  $(docker exec bc bitcoin-cli -regtest getnewaddress)

# Lightning CLI
docker exec cl lightning-cli --network=regtest getinfo
docker exec cl lightning-cli --network=regtest listpeerchannels

# Logs
docker compose logs -f app

# Restart a service
docker compose restart app

# Stop / start
docker compose down
docker compose up -d
```

### Project Structure

```
config.ts           App configuration (from config.ts.sample)
compose.yml         Docker services (from compose.yml.sample)
data/               Runtime data for all services (gitignored)
lib/                Core libraries (payments, lightning, ark, etc.)
routes/             HTTP route handlers
setup.sh            One-command dev environment setup
sampledata/         Default configs copied to data/ on first run
```

### Reset

```bash
rm -rf data config.ts compose.yml
./setup.sh
```

### Rebuild from Scratch

To skip the snapshot and generate wallets/blocks/channels manually:

```bash
./setup.sh --no-snapshot
```

## Contributing

1. Fork and clone
2. Run `./setup.sh`
3. Make changes — the app container bind-mounts this directory, so edits are live
4. `bun test` to run tests
5. Open a PR

## License

MIT
