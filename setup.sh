cp config.ts.sample config.ts
cp compose.yml.sample compose.yml
cp -r sampledata data
sudo chown 100:100 data/nostr/data
docker compose up -d
docker run -it -v $(pwd):/app --entrypoint bun asoltys/coinos-server i
docker exec -it bc bitcoin-cli createwallet coinos
docker exec -it bc bitcoin-cli rescanblockchain
docker exec -it bc bitcoin-cli generatetoaddress 500 $(docker exec -it bc bitcoin-cli getnewaddress "" "p2sh-segwit")
