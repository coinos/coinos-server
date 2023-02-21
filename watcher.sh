#!/bin/bash

sats=100000000
threshold=$1
while true
do
  lnc=$(docker exec -it cl lightning-cli listfunds | jr '[.channels[] | .channel_sat] | add')
  lnw=$(docker exec -it cl lightning-cli listfunds | jr '[.outputs[] | .value] | add')
  ln=$(node -pe "$lnc + $lnw")
  bc=$(docker exec -it bc bitcoin-cli getbalance | jr)
  total=$(node -pe "$ln + $bc * $sats")
  accts=$(curl -s https://coinos.io/api/balances | jr '.total')
  gap=$(node -pe "$accts - $total")
  echo $(date -Is) lnc $lnc lnw $lnw bc $bc tot $total gap $gap
  # low=$(node -pe "!!($gap > $threshold)")
  # if "$low"; then 
  #   echo "Threshold hit, setting new threshold"
  #   pnpm pm2 stop 0 > /dev/null
  #   node /root/mailgun/index.js
  # fi
  sleep 60 
done
