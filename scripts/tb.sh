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
# Returns: id credits_posted debits_posted balance (one line per account)
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
          const bal = a.credits_posted - a.debits_posted;
          console.log(id.toString() + ' ' + a.credits_posted.toString() + ' ' + a.debits_posted.toString() + ' ' + bal.toString());
        } else {
          console.log(id.toString() + ' 0 0 0');
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
  local bal=$(echo "$result" | awk '{print $4}')
  echo "$1: $bal sats"
}

# Get pending balance for a username
tb-pending() {
  if [ -z "$1" ]; then echo "Usage: tb-pending <username>"; return 1; fi
  local uid=$(_user_id "$1")
  if [ -z "$uid" ]; then echo "User not found: $1"; return 1; fi
  local pending_id=$(python3 -c "print(int('${uid//-/}', 16) ^ (5 << 64))")
  local result=$(_tb_lookup "$pending_id")
  local bal=$(echo "$result" | awk '{print $4}')
  echo "$1: $bal sats pending"
}

# Get fee credits for a username
tb-credits() {
  if [ -z "$1" ]; then echo "Usage: tb-credits <username>"; return 1; fi
  local uid=$(_user_id "$1")
  if [ -z "$uid" ]; then echo "User not found: $1"; return 1; fi
  local ids
  IFS=$'\n' read -d '' -ra ids < <(_derive_ids "$uid")
  local result=$(_tb_lookup "${ids[2]},${ids[3]},${ids[4]}")
  local btc=$(echo "$result" | sed -n '1p' | awk '{print $4}')
  local ln=$(echo "$result" | sed -n '2p' | awk '{print $4}')
  local lq=$(echo "$result" | sed -n '3p' | awk '{print $4}')
  echo "$1 credits:"
  echo "  bitcoin:   $btc"
  echo "  lightning: $ln"
  echo "  liquid:    $lq"
}

# Full summary for a username
tb-user() {
  if [ -z "$1" ]; then echo "Usage: tb-user <username>"; return 1; fi
  local uid=$(_user_id "$1")
  if [ -z "$uid" ]; then echo "User not found: $1"; return 1; fi
  local ids
  IFS=$'\n' read -d '' -ra ids < <(_derive_ids "$uid")
  local result=$(_tb_lookup "${ids[0]},${ids[1]},${ids[2]},${ids[3]},${ids[4]}")
  local bal=$(echo "$result" | sed -n '1p' | awk '{print $4}')
  local pending=$(echo "$result" | sed -n '2p' | awk '{print $4}')
  local btc=$(echo "$result" | sed -n '3p' | awk '{print $4}')
  local ln=$(echo "$result" | sed -n '4p' | awk '{print $4}')
  local lq=$(echo "$result" | sed -n '5p' | awk '{print $4}')
  echo "$1 ($uid)"
  echo "  balance:   $bal sats"
  echo "  pending:   $pending sats"
  echo "  credits:"
  echo "    bitcoin:   $btc"
  echo "    lightning: $ln"
  echo "    liquid:    $lq"
}

# Show house account balances
tb-house() {
  local result=$(_tb_lookup "1,2,3,4")
  local sats=$(echo "$result" | sed -n '1p' | awk '{print $4}')
  local btc=$(echo "$result" | sed -n '2p' | awk '{print $4}')
  local ln=$(echo "$result" | sed -n '3p' | awk '{print $4}')
  local lq=$(echo "$result" | sed -n '4p' | awk '{print $4}')
  echo "House accounts:"
  echo "  sats (1):       $sats"
  echo "  btc credit (2): $btc"
  echo "  ln credit (3):  $ln"
  echo "  lq credit (4):  $lq"
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
