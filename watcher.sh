#!/bin/bash

sats=100000000
threshold=$1
while true
do
  f=/home/adam/coinos-server/data/funds/$(date +"%m-%d-%y-%T").json
  docker exec -it cl lightning-cli listfunds > $f

  lnc=$(cat $f | jr '[.channels[] | select(.state == "CHANNELD_NORMAL") | .our_amount_msat] | add')
  lnc=$(node -pe "((($lnc)/$sats)/1000).toFixed(4)")

  lnw=$(cat $f | jr '[.outputs[] | .amount_msat] | add')
  lnw=$(node -pe "((($lnw)/$sats)/1000).toFixed(4)")

  bc=$(docker exec -it bc bitcoin-cli getbalance | jr)
  bc=$(node -pe "($bc).toFixed(4)")

  total=$(node -pe "($lnc + $lnw + $bc).toFixed(4)")

  accts=$(curl -s https://coinos.io/api/balances | jr '.total')
  accts=$(node -pe "($accts / $sats).toFixed(4)")

  gap=$(node -pe "($accts - $total).toFixed(4)")
  echo $(date -Is) lnc $lnc lnw $lnw bc $bc tot $total gap $gap
  low=$(node -pe "!!($gap > $threshold)")
  
#   if "$low"; then 
#     echo "Threshold hit, setting new threshold"
# #    docker stop app;
#     curl localhost:3119/email -H "content-type: application/json" -d '{"token": "MPJzfq97ab!!!!", "message": "threshold hit"}'
#   fi
  sleep 120 
done
