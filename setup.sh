#!/bin/bash

if [ -f config.ts ] || [ -f compose.yml ] || [ -d data ]; then
  echo "Existing config.ts, compose.yml, or data/ detected."
  read -p "Overwrite? This will destroy current config and data. (y/N) " confirm
  if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
    echo "Aborting."
    exit 1
  fi
fi

cp config.ts.sample config.ts
cp compose.yml.sample compose.yml
cp -r sampledata data
sudo chown 100:100 data/nostr/data
docker compose up -d
docker run -it -v $(pwd):/home/bun/app --entrypoint bun asoltys/coinos-server i
docker exec -it bc bitcoin-cli createwallet coinos
docker exec -it bc bitcoin-cli createwallet external
docker exec -it bc bitcoin-cli rescanblockchain
docker exec -it bc bitcoin-cli generatetoaddress 500 $(docker exec -it bc bitcoin-cli getnewaddress "" "p2sh-segwit")
docker exec -it bc bitcoin-cli -rpcwallet=external generatetoaddress 5000 $(docker exec -it bc bitcoin-cli -rpcwallet=external getnewaddress "" "p2sh-segwit")
docker exec -it lq elements-cli createwallet coinos
docker exec -it db keydb-cli set limit 1000000
