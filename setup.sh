docker exec -it bc bitcoin-cli createwallet coinos
docker exec -it bc bitcoin-cli rescanblockchain
docker exec -it bc bitcoin-cli generatetoaddress 500 $(docker exec -it bitcoin bitcoin-cli getnewaddress "" "p2sh-segwit")
