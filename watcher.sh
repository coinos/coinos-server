#!/bin/bash

sats=100000000
while true
do
  ln=$(lncli --lnddir=/root/.lnda --network=mainnet --chain=bitcoin --rpcserver=localhost:10001 channelbalance | jr .balance)
  bc=$(bitcoin-cli getbalance)
  el=$(elements-cli getbalance | jr .bitcoin)
  total=$(node -pe "$ln + $bc * $sats + $el * $sats")
  low=$(node -pe "$total < $1")
  echo $(date -Is) ln $ln bc $bc el $el tot $total
  if "$low"; then 
    echo "Balance below threshold, shutting down"
    yarn pm2 stop 0 > /dev/null
    cd /root/mailgun && node index.js
    exit
  fi
  sleep 10 
done
