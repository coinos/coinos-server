cp sampleconfig.js config.js
cp -r sampledata data
docker compose up -d
docker run -it -v $(pwd):/app --entrypoint pnpm cs i
docker exec -it bc bitcoin-cli createwallet coinos
docker exec -it bc bitcoin-cli rescanblockchain
docker exec -it bc bitcoin-cli generatetoaddress 500 $(docker exec -it bc bitcoin-cli getnewaddress "" "p2sh-segwit")
