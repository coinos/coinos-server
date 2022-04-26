#!/bin/bash
BTCADDRESS=$(bitcoin-cli -regtest -rpcuser=admin1 -rpcpassword=123 getnewaddress); bitcoin-cli -regtest -rpcuser=admin1 -rpcpassword=123 generatetoaddress 101 $BTCADDRESS