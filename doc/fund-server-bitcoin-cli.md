## Fund Coinos server (via bitcoin-cli)

Bitcoin Regtest Mode allows us to create our own Bitcoin sandbox blockchain for use in testing & development. 

In this demo/tutorial we will setup a regtest network along with wallet and some initial bitcoin.   

From the coinos-server dir on your localfilesystem (ie- after following the 'Getting Started' section of our [root README]) 

```bash

docker exec -it bitcoin bash

# get an address
bitcoin-cli -regtest -datadir=/config -rpcwallet=coinosdev getnewaddress

# mine a block to the new address 
bitcoin-cli -regtest -datadir=/config generatetoaddress 101 theaddressgeneratedabove

# verify you got the reward: 
bitcoin-cli -regtest -datadir=/config -conf=./bitcoin.conf -rpcwallet=coinosdev getbalance
> 50.00000000

# send 10 bitcoin to your account on the server
# get the address to send to from ./receive, select 'Bitcoin'
bitcoin-cli -regtest -datadir=/config -rpcwallet=coinosdev sendtoaddress [account-address] 10

# confirm the transaction
# (do the mining command again)
bitcoin-cli -regtest -datadir=/config generatetoaddress 101 theaddressgeneratedabove
```

![](./img/50-bitcoin-server-balance.gif)


#### Start from scratch

To purge any existing transactions you made and to recreate all wallets including the coinos wallet (coinosdev) do (assuming coinos-server is running): 

```bash
docker-compose down
sudo rm -rf config/bitcoin 
sudo rm -rf config/lightning
sudo rm -rf config/liquid
cp -rf sampleconfig/bitcoin config
cp -rf sampleconfig/lightning config
cp -rf sampleconfig/liquid config
docker-compose up
# app may crash during re-initalization of blockchains so
# restart it again after a few moments if necessary: 
docker-compose restart app 
```


#### Creating new (Bitcoin native) wallets

Note the wallet 'coinosdev' is created apart of the initial docker build for our Coinos Bitcoin server.  
To create a new wallet (ie- as an alternate or one for yourself) do: 

```bash
bitcoin-cli -regtest -datadir=/config -conf=./bitcoin.conf createwallet me
> # new wallet created in /config/regtest/wallets
```
and then specify `-rpcwallet=me` (or wallet name of your choice)


#### further reading

On why to generate 101 blocks and some general info on Regtest Mode: 

https://developer.bitcoin.org/examples/testing.html


[root README]:https://github.com/coinos/coinos-server

