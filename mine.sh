#!/bin/bash


while true
do
  docker exec -it liquid elements-cli -rpcwallet=a -datadir=/config generatetoaddress 1 $(docker exec -it liquid elements-cli -rpcwallet=a -datadir=/config getnewaddress)
  sleep 8
done
