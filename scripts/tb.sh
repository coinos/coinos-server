#!/bin/bash
# TigerBeetle query utilities for coinos-server
# Source this file: source scripts/tb.sh

# Get user UUID from Redis by username
_user_id() {
  local username="$1"
  docker exec db valkey-cli GET "user:$username" | tr -d '"' | while read key; do
    if [[ "$key" =~ ^[0-9a-f-]{36}$ ]]; then
      docker exec db valkey-cli GET "user:$key" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['id'])"
    else
      echo "$key" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['id'])" 2>/dev/null || echo "$key"
    fi
  done
}

# Query TB accounts via bun in app container
# Args: space-separated list of bigint IDs (as decimal strings)
# Returns: id credits_posted debits_posted balance_micro balance_sats (one line per account)
# Note: balances stored in microsats (1 sat = 1,000,000 microsats)
_tb_lookup() {
  local ids="$1"
  docker exec app bun -e "
    const { createClient } = require('tigerbeetle-node');
    const { lookup } = require('node:dns/promises');
    (async () => {
      const { address: ip } = await lookup('tb');
      const c = createClient({ cluster_id: 0n, replica_addresses: [\`\${ip}:3000\`] });
      const ids = '${ids}'.split(',').map(s => BigInt(s.trim()));
      const accs = await c.lookupAccounts(ids);
      const found = new Map(accs.map(a => [a.id.toString(), a]));
      for (const id of ids) {
        const a = found.get(id.toString());
        if (a) {
          const micro = a.credits_posted - a.debits_posted;
          const sats = Number(micro / 1000000n);
          console.log(id.toString() + ' ' + a.credits_posted.toString() + ' ' + a.debits_posted.toString() + ' ' + micro.toString() + ' ' + sats.toString());
        } else {
          console.log(id.toString() + ' 0 0 0 0');
        }
      }
      c.destroy();
    })();
  " 2>/dev/null
}

# Convert UUID to BigInt decimal string
_uuid2int() {
  python3 -c "print(int('${1//-/}', 16))"
}

# Derive all TB account IDs for a UUID
_derive_ids() {
  local uid="$1"
  python3 -c "
uid = int('${uid//-/}', 16)
print(uid)                    # balance
print(uid ^ (5 << 64))       # pending
print(uid ^ (2 << 64))       # btc credit
print(uid ^ (3 << 64))       # ln credit
print(uid ^ (4 << 64))       # lq credit
"
}

# Get balance for a username
tb-balance() {
  if [ -z "$1" ]; then echo "Usage: tb-balance <username>"; return 1; fi
  local uid=$(_user_id "$1")
  if [ -z "$uid" ]; then echo "User not found: $1"; return 1; fi
  local account_id=$(_uuid2int "$uid")
  local result=$(_tb_lookup "$account_id")
  local micro=$(echo "$result" | awk '{print $4}')
  local sats=$(echo "$result" | awk '{print $5}')
  echo "$1: $sats sats ($micro μsats)"
}

# Get pending balance for a username
tb-pending() {
  if [ -z "$1" ]; then echo "Usage: tb-pending <username>"; return 1; fi
  local uid=$(_user_id "$1")
  if [ -z "$uid" ]; then echo "User not found: $1"; return 1; fi
  local pending_id=$(python3 -c "print(int('${uid//-/}', 16) ^ (5 << 64))")
  local result=$(_tb_lookup "$pending_id")
  local micro=$(echo "$result" | awk '{print $4}')
  local sats=$(echo "$result" | awk '{print $5}')
  echo "$1: $sats sats pending ($micro μsats)"
}

# Get fee credits for a username
tb-credits() {
  if [ -z "$1" ]; then echo "Usage: tb-credits <username>"; return 1; fi
  local uid=$(_user_id "$1")
  if [ -z "$uid" ]; then echo "User not found: $1"; return 1; fi
  local ids
  IFS=$'\n' read -d '' -ra ids < <(_derive_ids "$uid")
  local result=$(_tb_lookup "${ids[2]},${ids[3]},${ids[4]}")
  local btc_micro=$(echo "$result" | sed -n '1p' | awk '{print $4}')
  local btc_sats=$(echo "$result" | sed -n '1p' | awk '{print $5}')
  local ln_micro=$(echo "$result" | sed -n '2p' | awk '{print $4}')
  local ln_sats=$(echo "$result" | sed -n '2p' | awk '{print $5}')
  local lq_micro=$(echo "$result" | sed -n '3p' | awk '{print $4}')
  local lq_sats=$(echo "$result" | sed -n '3p' | awk '{print $5}')
  echo "$1 credits:"
  echo "  bitcoin:   $btc_sats sats ($btc_micro μsats)"
  echo "  lightning: $ln_sats sats ($ln_micro μsats)"
  echo "  liquid:    $lq_sats sats ($lq_micro μsats)"
}

# Full summary for a username
tb-user() {
  if [ -z "$1" ]; then echo "Usage: tb-user <username>"; return 1; fi
  local uid=$(_user_id "$1")
  if [ -z "$uid" ]; then echo "User not found: $1"; return 1; fi
  local ids
  IFS=$'\n' read -d '' -ra ids < <(_derive_ids "$uid")
  local result=$(_tb_lookup "${ids[0]},${ids[1]},${ids[2]},${ids[3]},${ids[4]}")
  local bal_micro=$(echo "$result" | sed -n '1p' | awk '{print $4}')
  local bal_sats=$(echo "$result" | sed -n '1p' | awk '{print $5}')
  local pend_micro=$(echo "$result" | sed -n '2p' | awk '{print $4}')
  local pend_sats=$(echo "$result" | sed -n '2p' | awk '{print $5}')
  local btc_micro=$(echo "$result" | sed -n '3p' | awk '{print $4}')
  local btc_sats=$(echo "$result" | sed -n '3p' | awk '{print $5}')
  local ln_micro=$(echo "$result" | sed -n '4p' | awk '{print $4}')
  local ln_sats=$(echo "$result" | sed -n '4p' | awk '{print $5}')
  local lq_micro=$(echo "$result" | sed -n '5p' | awk '{print $4}')
  local lq_sats=$(echo "$result" | sed -n '5p' | awk '{print $5}')
  echo "$1 ($uid)"
  echo "  balance:   $bal_sats sats ($bal_micro μsats)"
  echo "  pending:   $pend_sats sats ($pend_micro μsats)"
  echo "  credits:"
  echo "    bitcoin:   $btc_sats sats ($btc_micro μsats)"
  echo "    lightning: $ln_sats sats ($ln_micro μsats)"
  echo "    liquid:    $lq_sats sats ($lq_micro μsats)"
}

# Show house account balances
tb-house() {
  local result=$(_tb_lookup "1,2,3,4")
  local sats_micro=$(echo "$result" | sed -n '1p' | awk '{print $4}')
  local sats=$(echo "$result" | sed -n '1p' | awk '{print $5}')
  local btc_micro=$(echo "$result" | sed -n '2p' | awk '{print $4}')
  local btc=$(echo "$result" | sed -n '2p' | awk '{print $5}')
  local ln_micro=$(echo "$result" | sed -n '3p' | awk '{print $4}')
  local ln=$(echo "$result" | sed -n '3p' | awk '{print $5}')
  local lq_micro=$(echo "$result" | sed -n '4p' | awk '{print $4}')
  local lq=$(echo "$result" | sed -n '4p' | awk '{print $5}')
  echo "House accounts (in microsats, 1 sat = 1,000,000 μsats):"
  echo "  sats (1):       $sats sats ($sats_micro μsats)"
  echo "  btc credit (2): $btc sats ($btc_micro μsats)"
  echo "  ln credit (3):  $ln sats ($ln_micro μsats)"
  echo "  lq credit (4):  $lq sats ($lq_micro μsats)"
}

# Raw TB account lookup by numeric ID(s), comma-separated
tb-raw() {
  if [ -z "$1" ]; then echo "Usage: tb-raw <id>[,<id>...]"; return 1; fi
  docker exec app bun -e "
    const { createClient } = require('tigerbeetle-node');
    const { lookup } = require('node:dns/promises');
    (async () => {
      const { address: ip } = await lookup('tb');
      const c = createClient({ cluster_id: 0n, replica_addresses: [\`\${ip}:3000\`] });
      const ids = '${1}'.split(',').map(BigInt);
      const accs = await c.lookupAccounts(ids);
      for (const a of accs) {
        console.log(JSON.stringify({
          id: a.id.toString(),
          ledger: a.ledger,
          credits_posted: a.credits_posted.toString(),
          debits_posted: a.debits_posted.toString(),
          credits_pending: a.credits_pending.toString(),
          debits_pending: a.debits_pending.toString(),
          balance: (a.credits_posted - a.debits_posted).toString(),
        }, null, 2));
      }
      c.destroy();
    })();
  " 2>/dev/null
}

echo "TB utils loaded: tb-balance, tb-pending, tb-credits, tb-user, tb-house, tb-raw"
