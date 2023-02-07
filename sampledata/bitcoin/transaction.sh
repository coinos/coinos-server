#!/bin/sh
wget -O- --post-data='{"txid": "'$1'", "wallet": "'$2'"}' --header='Content-Type:application/json' 'http://app:3119/bitcoin'
