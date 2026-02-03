#!/bin/bash
set -e

# 1. Send BTC to boarding address and mine
echo "Funding boarding address..."
docker exec bc bitcoin-cli -regtest -rpcuser=admin1 -rpcpassword=123 -rpcwallet=coinos sendtoaddress "bcrt1p4pm6myqffj07g8quw9er2vdnvf8rj7ns4nwwt9l5gxjf8pmjkueqh9hezk" 1
docker exec bc bitcoin-cli -regtest -rpcuser=admin1 -rpcpassword=123 generatetoaddress 1 "$(docker exec bc bitcoin-cli -regtest -rpcuser=admin1 -rpcpassword=123 -rpcwallet=coinos getnewaddress)"
echo "Funded and confirmed."

# 2. Start settle in background
echo "Starting settle..."
cd /home/adam/coinos-server && bun inspect-ark.ts &
SETTLE_PID=$!

# 3. Wait for intent to register then mine blocks
echo "Waiting for intent registration..."
for i in $(seq 1 60); do
  sleep 5
  INTENTS=$(docker exec arkd arkd intents 2>&1)
  if echo "$INTENTS" | grep -q "boardingInputs"; then
    echo "Intent registered! Mining block..."
    docker exec bc bitcoin-cli -regtest -rpcuser=admin1 -rpcpassword=123 generatetoaddress 1 "$(docker exec bc bitcoin-cli -regtest -rpcuser=admin1 -rpcpassword=123 -rpcwallet=coinos getnewaddress)"
    break
  fi
  echo "No intent yet (attempt $i)..."
done

# 4. Wait for settle to complete
echo "Waiting for settle..."
wait $SETTLE_PID
echo "Done."
