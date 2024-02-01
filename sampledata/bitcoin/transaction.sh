#!/bin/sh
wget -O- --post-data='{"txid": "'$1'", "wallet": "'$2'", "type": "bitcoin"}' --header='Content-Type:application/json' 'http://app:3119/confirm'
