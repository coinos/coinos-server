#!/bin/bash

sats=100000000
threshold=$1
while true
do
  f=/home/adam/coinos-server/data/funds/$(date +"%m-%d-%y-%T").json
  docker exec -it cl lightning-cli listfunds > $f
  lnc=$(cat $f | jr '[.channels[] | select(.state == "CHANNELD_NORMAL") | .our_amount_msat] | add')
  lnw=$(cat $f | jr '[.outputs[] | .amount_msat] | add')
  ln=$(node -pe "($lnc + $lnw)/1000")
  bc=$(docker exec -it bc bitcoin-cli getbalance | jr)
  total=$(node -pe "$ln + $bc * $sats")
  accts=$(curl -s https://coinos.io/api/balances | jr '.total')
  gap=$(node -pe "$accts - $total")
  echo $(date -Is) lnc $lnc lnw $lnw bc $bc tot $total gap $gap
  low=$(node -pe "!!($gap > $threshold)")
  
  if "$low"; then 
    echo "Threshold hit, setting new threshold"
#    docker stop app;
    curl localhost:3119/email -H "content-type: application/json" -d '{"token": "MPJzfq97ab!!!!", "message": "threshold hit"}'
  fi
  sleep 120 
done
