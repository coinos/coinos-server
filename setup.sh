#!/usr/bin/env bash
set -euo pipefail

########################################################################
# coinos regtest setup
#
# Sets up a complete local development environment:
#   Bitcoin Core, Liquid, Core Lightning (x3), TigerBeetle,
#   Nostr relay (strfry), Cashu mint, Ark, Esplora, and the coinos API
#
# Usage:
#   chmod +x setup.sh && ./setup.sh
#
# Idempotent — safe to re-run at any point.
########################################################################

# -- configuration --
BITCOIN_BLOCKS=500
CHANNEL_SATS=500000
LN_FUND_BTC=1
ARK_FUND_BTC=1
SNAPSHOT_URL="https://github.com/coinos/coinos-server/releases/download/regtest-data/regtest-data.tar.gz"
USE_SNAPSHOT=true  # set to false to generate everything from scratch

# -- colors --
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "  ${BLUE}•${NC} $*"; }
ok()    { echo -e "  ${GREEN}✓${NC} $*"; }
warn()  { echo -e "  ${YELLOW}!${NC} $*"; }
err()   { echo -e "  ${RED}✗${NC} $*"; }
step()  { echo -e "\n${BOLD}${GREEN}▸ $*${NC}"; }

# Bootstrap: if run via curl (not from inside the repo), clone first
if [ ! -f "compose.yml.sample" ]; then
  REPO_DIR="${COINOS_DIR:-$HOME/coinos-server}"
  if [ ! -d "$REPO_DIR" ]; then
    echo -e "  ${BLUE}•${NC} Cloning coinos-server..."
    git clone https://github.com/coinos/coinos-server.git "$REPO_DIR"
    cd "$REPO_DIR"
    git checkout staging 2>/dev/null || true
  else
    cd "$REPO_DIR"
  fi
  exec bash "$REPO_DIR/setup.sh" "$@"
fi

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

# ── helpers ──────────────────────────────────────────────────────────

wait_for() {
  local name="$1" cmd="$2" retries="${3:-30}" delay="${4:-2}"
  local i=0
  info "Waiting for $name..."
  while ! eval "$cmd" &>/dev/null 2>&1; do
    i=$((i + 1))
    if [ "$i" -ge "$retries" ]; then
      err "$name did not become ready after $((retries * delay))s"
      return 1
    fi
    sleep "$delay"
  done
  ok "$name"
}

bcli() { docker exec bc bitcoin-cli -regtest "$@"; }
lcli() { docker exec lq elements-cli -chain=liquidregtest "$@"; }
clcli()  { docker exec cl  lightning-cli --network=regtest "$@"; }
clbcli() { docker exec clb lightning-cli --network=regtest "$@"; }
clccli() { docker exec clc lightning-cli --network=regtest "$@"; }

mine() {
  local n="${1:-1}"
  local addr
  addr=$(bcli getnewaddress "" "bech32")
  bcli generatetoaddress "$n" "$addr" > /dev/null
}

# ── phase 1: prerequisites ──────────────────────────────────────────

check_prereqs() {
  step "Checking prerequisites"

  # Docker
  if ! command -v docker &>/dev/null; then
    info "Docker not found — installing via get.docker.com..."
    # Install script is noisy (dumps systemd status); suppress output
    set +e
    curl -fsSL https://get.docker.com | sudo sh >/dev/null 2>&1
    set -e
    if ! command -v docker &>/dev/null; then
      err "Docker installation failed"
      exit 1
    fi
    sudo usermod -aG docker "$USER" 2>/dev/null || true
    ok "Docker installed"
  fi

  if ! docker info &>/dev/null 2>&1; then
    # Docker group membership not active in current shell — re-exec via sg
    if getent group docker | grep -qw "$USER" 2>/dev/null; then
      info "Activating docker group membership..."
      sg docker -c "cd $DIR && bash $DIR/setup.sh"
      exit $?
    fi
    err "Cannot connect to Docker daemon."
    err "Try: sudo usermod -aG docker \$USER && newgrp docker && ./setup.sh"
    exit 1
  fi
  ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')"

  # Docker Compose
  if ! docker compose version &>/dev/null 2>&1; then
    err "docker compose plugin not found"
    err "Install: https://docs.docker.com/compose/install/"
    exit 1
  fi
  ok "Docker Compose $(docker compose version --short)"

  # Disk space (want at least 2GB free)
  local avail_kb
  avail_kb=$(df -k "$DIR" | tail -1 | awk '{print $4}')
  local avail_gb=$((avail_kb / 1024 / 1024))
  if [ "$avail_gb" -lt 2 ]; then
    warn "Only ${avail_gb}GB free disk space (recommend ≥2GB)"
  else
    ok "${avail_gb}GB free disk space"
  fi
}

# ── phase 2: configuration files ────────────────────────────────────

setup_config() {
  step "Setting up configuration"

  if [ ! -f config.ts ]; then
    cp config.ts.sample config.ts
    ok "Created config.ts"
  else
    ok "config.ts exists"
  fi

  if [ -f compose.yml ]; then
    if ! diff -q compose.yml compose.yml.sample >/dev/null 2>&1; then
      warn "compose.yml differs from compose.yml.sample"
      read -rp "  Overwrite compose.yml with compose.yml.sample? [Y/n] " answer
      if [ "${answer,,}" != "n" ]; then
        cp compose.yml compose.yml.bak
        cp compose.yml.sample compose.yml
        ok "compose.yml updated (old saved as compose.yml.bak)"
      else
        ok "compose.yml kept as-is"
      fi
    else
      ok "compose.yml"
    fi
  else
    cp compose.yml.sample compose.yml
    ok "compose.yml"
  fi
}

# ── phase 3: data directories ───────────────────────────────────────

setup_data() {
  step "Setting up data directories"

  if [ -d data ]; then
    ok "data/ exists"
  elif [ "$USE_SNAPSHOT" = true ]; then
    # Try to download pre-built regtest snapshot
    info "Downloading regtest snapshot (4MB)..."
    if curl -fsSL "$SNAPSHOT_URL" -o /tmp/regtest-data.tar.gz 2>/dev/null; then
      tar xzf /tmp/regtest-data.tar.gz
      rm -f /tmp/regtest-data.tar.gz
      # Also extract config.ts if it was in the snapshot and we don't have one
      ok "Extracted regtest snapshot"
      SNAPSHOT_LOADED=true
    else
      warn "Snapshot download failed — will generate from scratch"
      cp -r sampledata data
      ok "Copied sampledata → data"
    fi
  else
    cp -r sampledata data
    ok "Copied sampledata → data"
  fi

  # Create directories not in sampledata
  local dirs=(
    data/lightningc
    data/strfry/db
    data/ark
    data/arkd-wallet
    data/tigerbeetle
    data/mint
    data/archive-kv
    data/sockets
    logs
    .aws
  )
  for d in "${dirs[@]}"; do
    mkdir -p "$d"
  done

  # Lightning C config (third node)
  if [ -f sampledata/lightningc/config ] && [ ! -f data/lightningc/config ]; then
    cp sampledata/lightningc/config data/lightningc/config
    ok "Created Lightning C config"
  fi

  # Strfry config
  if [ -f sampledata/strfry/strfry.conf ] && [ ! -f data/strfry/strfry.conf ]; then
    cp sampledata/strfry/strfry.conf data/strfry/strfry.conf
    ok "Created strfry.conf"
  fi

  # Kvrocks config
  if [ -f sampledata/archive-kv/kvrocks.conf ] && [ ! -f data/archive-kv/kvrocks.conf ]; then
    cp sampledata/archive-kv/kvrocks.conf data/archive-kv/kvrocks.conf
    ok "Created kvrocks.conf"
  fi

  # Valkey config (compose expects valkey.conf, not keydb.conf)
  if [ ! -f data/db/valkey.conf ]; then
    if [ -f sampledata/db/valkey.conf ]; then
      cp sampledata/db/valkey.conf data/db/valkey.conf
    else
      cat > data/db/valkey.conf <<'EOF'
dir /data
loglevel warning
save ""
appendonly yes
appendfsync everysec
EOF
    fi
    ok "Created valkey.conf"
  fi

  # Fix nostr data permissions (bun user = 100:100 inside container)
  if [ -d data/nostr ]; then
    sudo chown -R 100:100 data/nostr 2>/dev/null || true
  fi

  ok "All data directories ready"
}

# ── phase 4: TigerBeetle ────────────────────────────────────────────

setup_tigerbeetle() {
  step "Setting up TigerBeetle"

  if [ -f data/tigerbeetle/0_0.tigerbeetle ]; then
    ok "Data file already exists"
    return
  fi

  info "Formatting TigerBeetle data file..."
  docker run --rm --privileged \
    -v "$DIR/data/tigerbeetle:/data" \
    ghcr.io/coinos/tigerbeetle \
    format --cluster=0 --replica=0 --replica-count=1 /data/0_0.tigerbeetle

  ok "TigerBeetle formatted"
}

# ── phase 5: Docker network ─────────────────────────────────────────

setup_network() {
  step "Setting up Docker network"

  if docker network inspect net &>/dev/null 2>&1; then
    ok "Network 'net' exists"
  else
    docker network create net
    ok "Created network 'net'"
  fi
}

# ── phase 6: install dependencies ───────────────────────────────────

install_deps() {
  step "Installing application dependencies"

  # Server deps
  if [ -d node_modules ] && [ -d node_modules/.cache ]; then
    ok "Server node_modules exists"
  else
    info "Running bun install for server..."
    docker run --rm \
      -v "$DIR":/home/bun/app \
      -w /home/bun/app \
      ghcr.io/coinos/base bun i
    ok "Server dependencies installed"
  fi

  # UI deps
  local ui_dir="$DIR/../coinos-ui"
  if [ ! -d "$ui_dir" ]; then
    info "Cloning coinos-ui..."
    git clone -b staging https://github.com/coinos/coinos-ui.git "$ui_dir" 2>/dev/null || {
      warn "Could not clone coinos-ui — skipping frontend setup"
      return
    }
  fi

  if [ -d "$ui_dir/node_modules" ]; then
    ok "UI node_modules exists"
  else
    info "Running bun install for UI..."
    docker run --rm \
      -v "$ui_dir":/home/bun/app \
      -w /home/bun/app \
      ghcr.io/coinos/base bun i
    ok "UI dependencies installed"
  fi
}

# ── phase 7: pull images ────────────────────────────────────────────

pull_images() {
  step "Pulling container images"

  info "This may take a few minutes on first run..."
  docker compose pull --ignore-pull-failures 2>&1 | tail -3 || true

  ok "Images ready"
}

# ── phase 8: start services ─────────────────────────────────────────

start_services() {
  step "Starting services"

  docker compose up -d 2>&1
  ok "Containers started"
}

# ── phase 9: wait for services ──────────────────────────────────────

wait_for_services() {
  step "Waiting for services"

  wait_for "Valkey"          "docker exec db valkey-cli ping"    30 2
  wait_for "Bitcoin Core"    "bcli getblockchaininfo"            30 2
  wait_for "Liquid"          "lcli getblockchaininfo"            30 2
  wait_for "Lightning (cl)"  "clcli getinfo"                     60 3
  wait_for "Lightning (clb)" "clbcli getinfo"                    60 3
  wait_for "Lightning (clc)" "clccli getinfo"                    60 3
  wait_for "TigerBeetle"     "docker ps --filter name=^tb$ --filter status=running -q" 30 2
}

# ── phase 10: wallets ───────────────────────────────────────────────

setup_wallets() {
  step "Setting up wallets"

  # Bitcoin
  if bcli listwallets 2>/dev/null | grep -q coinos; then
    ok "Bitcoin 'coinos' wallet exists"
  else
    bcli createwallet coinos >/dev/null 2>&1 || true
    ok "Created Bitcoin 'coinos' wallet"
  fi

  # Liquid
  if lcli listwallets 2>/dev/null | grep -q coinos; then
    ok "Liquid 'coinos' wallet exists"
  else
    lcli createwallet coinos >/dev/null 2>&1 || true
    ok "Created Liquid 'coinos' wallet"
  fi

  bcli rescanblockchain >/dev/null 2>&1 &
}

# ── phase 11: generate blocks & fund ────────────────────────────────

fund_regtest() {
  step "Funding regtest environment"

  local height
  height=$(bcli getblockcount 2>/dev/null || echo 0)
  if [ "$height" -lt "$BITCOIN_BLOCKS" ]; then
    info "Generating blocks (current: $height, target: $BITCOIN_BLOCKS)..."
    local addr
    addr=$(bcli getnewaddress "" "bech32")
    bcli generatetoaddress "$BITCOIN_BLOCKS" "$addr" > /dev/null
    ok "Generated $BITCOIN_BLOCKS blocks"
  else
    ok "Already have $height blocks"
  fi

  # Fund Lightning nodes
  info "Funding Lightning nodes ($LN_FUND_BTC BTC each)..."

  local cl_addr clb_addr clc_addr
  cl_addr=$(clcli  newaddr 2>/dev/null | grep -m1 -o '"bech32": "[^"]*"' | cut -d'"' -f4)
  clb_addr=$(clbcli newaddr 2>/dev/null | grep -m1 -o '"bech32": "[^"]*"' | cut -d'"' -f4)
  clc_addr=$(clccli newaddr 2>/dev/null | grep -m1 -o '"bech32": "[^"]*"' | cut -d'"' -f4)

  bcli sendtoaddress "$cl_addr"  "$LN_FUND_BTC" > /dev/null
  bcli sendtoaddress "$clb_addr" "$LN_FUND_BTC" > /dev/null
  bcli sendtoaddress "$clc_addr" "$LN_FUND_BTC" > /dev/null
  ok "Sent $LN_FUND_BTC BTC to each Lightning node"

  mine 10
  ok "Confirmed funding transactions"

  # Wait for Lightning nodes to see confirmed funds
  info "Waiting for Lightning nodes to sync funds..."
  wait_for "cl funds"  "clcli  listfunds 2>/dev/null | grep -q outputs" 30 3 || true
  wait_for "clb funds" "clbcli listfunds 2>/dev/null | grep -q outputs" 30 3 || true
  wait_for "clc funds" "clccli listfunds 2>/dev/null | grep -q outputs" 30 3 || true
}

# ── phase 12: Lightning channels ────────────────────────────────────

setup_channels() {
  step "Opening Lightning channels"

  # Wait for confirmed funds before opening channels
  wait_for "cl confirmed funds" \
    "clcli listfunds 2>/dev/null | grep -q '\"status\": \"confirmed\"'" 30 3 || true

  # Use set +e for channel ops — failures are handled gracefully
  set +e

  # cl → clb
  local clb_id
  clb_id=$(clbcli getinfo 2>/dev/null | grep -m1 -o '"id": "[^"]*"' | cut -d'"' -f4)
  if [ -z "$clb_id" ]; then
    warn "Could not get clb node ID — skipping channels"
    set -e
    return
  fi

  clcli connect "$clb_id" clb 9735 > /dev/null 2>&1
  if clcli listpeerchannels 2>/dev/null | grep -q "$clb_id"; then
    ok "cl → clb channel exists"
  else
    local result
    result=$(clcli fundchannel "$clb_id" "$CHANNEL_SATS" 2>&1)
    if echo "$result" | grep -q "txid"; then
      ok "Opened cl → clb ($CHANNEL_SATS sats)"
    else
      warn "cl → clb channel: $result"
    fi
  fi

  # Mine blocks and wait for change UTXO to be confirmed before second channel
  mine 6
  info "Waiting for change UTXO to confirm..."
  sleep 8

  # cl → clc
  local clc_id
  clc_id=$(clccli getinfo 2>/dev/null | grep -m1 -o '"id": "[^"]*"' | cut -d'"' -f4)
  if [ -n "$clc_id" ]; then
    clcli connect "$clc_id" clc 9735 > /dev/null 2>&1
    if clcli listpeerchannels 2>/dev/null | grep -q "$clc_id"; then
      ok "cl → clc channel exists"
    else
      result=$(clcli fundchannel "$clc_id" "$CHANNEL_SATS" 2>&1)
      if echo "$result" | grep -q "txid"; then
        ok "Opened cl → clc ($CHANNEL_SATS sats)"
      else
        warn "cl → clc channel: $result"
      fi
    fi
  fi

  set -e

  # Confirm channel opens + wait for maturity
  mine 10
  info "Waiting for channels to become active..."
  sleep 5
  mine 6
  ok "Lightning channels ready"
}

# ── phase 13: Ark ───────────────────────────────────────────────────

setup_ark() {
  step "Setting up Ark"

  if ! docker ps --format '{{.Names}}' | grep -q '^arkd$'; then
    warn "arkd container not running — skipping"
    return
  fi

  # Arkd wallet needs initialization on first run
  # Wait for arkd admin port to be available
  wait_for "arkd admin" \
    "docker exec arkd wget -qO- http://localhost:7071/v1/admin/wallet/status 2>/dev/null | grep -q initialized" 30 3 || {
    warn "arkd admin not available — skipping"
    return
  }

  local wallet_status
  wallet_status=$(docker exec arkd wget -qO- http://localhost:7071/v1/admin/wallet/status 2>/dev/null) || true
  if echo "$wallet_status" | grep -q '"initialized":false'; then
    info "Initializing Ark wallet..."
    # Step 1: Get seed
    local seed
    seed=$(docker exec arkd wget -qO- http://localhost:7071/v1/admin/wallet/seed 2>/dev/null \
      | grep -m1 -o '"seed":"[^"]*"' | cut -d'"' -f4) || true
    if [ -z "$seed" ]; then
      warn "Could not get Ark wallet seed"
      return
    fi
    # Step 2: Create wallet with seed + password
    docker exec arkd sh -c "wget -qO- --header='Content-Type: application/json' \
      --post-data='{\"seed\":\"$seed\",\"password\":\"testpassword\"}' \
      http://localhost:7071/v1/admin/wallet/create" >/dev/null 2>&1 || true
    sleep 2
    # Step 3: Unlock
    docker exec arkd sh -c "wget -qO- --header='Content-Type: application/json' \
      --post-data='{\"password\":\"testpassword\"}' \
      http://localhost:7071/v1/admin/wallet/unlock" >/dev/null 2>&1 || true
    sleep 3
    ok "Ark wallet initialized"
  elif echo "$wallet_status" | grep -q '"unlocked":false'; then
    info "Unlocking Ark wallet..."
    docker exec arkd sh -c "wget -qO- --header='Content-Type: application/json' \
      --post-data='{\"password\":\"testpassword\"}' \
      http://localhost:7071/v1/admin/wallet/unlock" >/dev/null 2>&1 || true
    sleep 3
    ok "Ark wallet unlocked"
  else
    ok "Ark wallet ready"
  fi

  # Wait for arkd API to become available (may take a few seconds after unlock)
  wait_for "arkd API" "docker exec arkd wget -qO- http://localhost:7070/v1/info 2>/dev/null | grep -q signerPubkey" 30 3 || {
    warn "arkd API not available — skipping Ark funding"
    return
  }

  # Extract server pubkey
  local ark_info ark_pubkey
  ark_info=$(docker exec arkd wget -qO- http://localhost:7070/v1/info 2>/dev/null) || true

  ark_pubkey=$(echo "$ark_info" | grep -m1 -o '"signerPubkey":"[^"]*"' | cut -d'"' -f4) || true
  if [ -z "$ark_pubkey" ]; then
    ark_pubkey=$(echo "$ark_info" | grep -m1 -o '"signerPubkey": "[^"]*"' | cut -d'"' -f4) || true
  fi

  if [ -n "$ark_pubkey" ]; then
    ok "Ark pubkey: ${ark_pubkey:0:20}..."
    if grep -q 'arkServerPublicKey: ""' config.ts 2>/dev/null; then
      sed -i "s|arkServerPublicKey: \"\"|arkServerPublicKey: \"$ark_pubkey\"|" config.ts
      ok "Updated config.ts with Ark pubkey"
    fi
  fi

  # Fund Ark wallet
  local boarding_addr ark_wallet_resp
  ark_wallet_resp=$(docker exec arkd wget -qO- http://localhost:7071/v1/admin/wallet/address 2>/dev/null) || true
  boarding_addr=$(echo "$ark_wallet_resp" | grep -m1 -o '"address":"[^"]*"' | cut -d'"' -f4) || true
  if [ -z "$boarding_addr" ]; then
    boarding_addr=$(echo "$ark_wallet_resp" | grep -m1 -o '"address": "[^"]*"' | cut -d'"' -f4) || true
  fi

  if [ -n "$boarding_addr" ]; then
    bcli sendtoaddress "$boarding_addr" "$ARK_FUND_BTC" > /dev/null
    mine 6
    ok "Funded Ark wallet with $ARK_FUND_BTC BTC"
  else
    warn "Could not get Ark boarding address"
  fi
}

# ── phase 14: restart app ───────────────────────────────────────────

restart_app() {
  step "Restarting app"

  docker compose restart app >/dev/null 2>&1
  sleep 3
  ok "App restarted"
}

# ── phase 15: verify ────────────────────────────────────────────────

verify() {
  step "Verifying setup"

  echo ""
  local services=("app" "db" "bc" "lq" "cl" "clb" "clc" "tb" "sf" "cs" "eb" "arc")
  local optional=("arkd" "arkd-wallet" "nbxplorer" "pgnbxplorer" "mon" "mint" "wallet")

  for svc in "${services[@]}"; do
    if docker ps --format '{{.Names}}' | grep -q "^${svc}$"; then
      ok "$svc"
    else
      err "$svc not running"
    fi
  done

  for svc in "${optional[@]}"; do
    if docker ps --format '{{.Names}}' | grep -q "^${svc}$"; then
      ok "$svc (optional)"
    fi
  done

  # Summary
  echo ""
  local chan_count
  chan_count=$(clcli listpeerchannels 2>/dev/null | grep -c '"state":') || chan_count=0
  info "$chan_count Lightning channel(s)"

  local block_height
  block_height=$(bcli getblockcount 2>/dev/null || echo "?")
  info "Block height: $block_height"

  echo ""
  echo -e "${BOLD}────────────────────────────────────────${NC}"
  echo -e "${GREEN}${BOLD}  Setup complete!${NC}"
  echo -e "${BOLD}────────────────────────────────────────${NC}"
  echo ""
  echo "  API server:    http://localhost:3119"
  echo "  Esplora:       http://localhost:3000"
  echo "  Nostr relay:   ws://localhost:7777"
  echo "  Cashu mint:    http://localhost:3338"
  echo "  Ark server:    http://localhost:7070"
  echo ""
  echo "  Frontend:  cd ~/coinos-ui && bun dev"
  echo ""
  echo "  Mine a block:"
  echo "    docker exec bc bitcoin-cli -regtest generatetoaddress 1 \\"
  echo "      \$(docker exec bc bitcoin-cli -regtest getnewaddress)"
  echo ""
}

# ── main ─────────────────────────────────────────────────────────────

main() {
  SNAPSHOT_LOADED=false

  echo ""
  echo -e "${BOLD}╔════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}║      coinos regtest setup              ║${NC}"
  echo -e "${BOLD}╚════════════════════════════════════════╝${NC}"

  check_prereqs
  setup_config
  setup_data
  setup_tigerbeetle
  setup_network
  install_deps
  pull_images
  start_services
  wait_for_services

  if [ "$SNAPSHOT_LOADED" = true ]; then
    # Snapshot has wallets, blocks, channels, ark — just need to
    # wait for services to load the pre-existing data
    step "Using pre-built regtest snapshot"
    wait_for "Bitcoin wallet" "bcli listwallets 2>/dev/null | grep -q coinos" 30 2 || true
    wait_for "Liquid wallet" "lcli listwallets 2>/dev/null | grep -q coinos" 30 2 || true
    ok "Snapshot data loaded"
  else
    setup_wallets
    fund_regtest
    setup_channels
    setup_ark
    restart_app
  fi

  verify
}

# ── snapshot command ──────────────────────────────────────────────────

create_snapshot() {
  step "Creating regtest snapshot"

  info "Stopping services..."
  docker compose down 2>/dev/null || true

  info "Packaging data/ and config.ts..."
  tar czf regtest-data.tar.gz data/ config.ts 2>/dev/null || \
  sudo tar czf regtest-data.tar.gz data/ config.ts

  local size
  size=$(ls -lh regtest-data.tar.gz | awk '{print $5}')
  ok "Created regtest-data.tar.gz ($size)"
  echo ""
  echo "  Upload to GitHub Releases:"
  echo "    gh release create regtest-data --title 'Regtest Data Snapshot' regtest-data.tar.gz"
  echo ""

  info "Restarting services..."
  docker compose up -d 2>/dev/null
}

case "${1:-}" in
  snapshot) create_snapshot ;;
  --no-snapshot) USE_SNAPSHOT=false; main ;;
  *) main ;;
esac
