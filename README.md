# coinos-server

Coinos is a bitcoin wallet app that supports payments over the <a href="https://bitcoin.org">bitcoin</a>, <a href="https://blockstream.com/liquid/">liquid</a> and <a href="http://lightning.network/">lightning</a> networks. Try it out at <a href="https://coinos.io/">coinos.io</a>.

This repository contains the code for the backend API server which is implemented as a NodeJS application. The code for the frontend UI is tracked separately <a href="https://github.com/asoltys/coinos.io">here</a> (but is automatically installed & started via the Docker way outlined below). 

## Install/Run (the Docker way)

### Requirements 

* <a href="https://docs.docker.com/get-docker/
">docker</a> and <a href="https://docs.docker.com/compose/install/">docker-compose</a>
* NodeJS (recommended version: 16)
* ~7GB of hard drive space (which will go into /var/lib/docker; primarily for Liquid)

### Getting Started

```bash
git clone https://github.com/coinos/coinos-server
cd coinos-server
cp -rf sampleconfig ./config
sudo chown 1000:1000 config/liquid
sudo chown 1000:1000 config/bitcoin
cp .env.sample .env
cp fx.sample fx
docker network create net --gateway 172.18.0.1 --subnet 172.18.0.0/16
docker run -it -v $(pwd):/app --entrypoint pnpm asoltys/coinos-server i
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d
docker exec -i mariadb mysql -u root -ppassword < db/schema.sql   
docker exec -it bitcoin bitcoin-cli createwallet coinos
docker exec -it bitcoin bitcoin-cli generatetoaddress 1 bcrt1qwhrhu9feqkvmgdph0a4p248zzmy4grjr38a8uq
docker exec -it liquid elements-cli createwallet coinos
docker exec -it liquid elements-cli rescanblockchain
docker exec -it liquid elements-cli sendtoaddress AzpsKhC6xE9FEK4aWAzMnbvueMLiSa5ym1xpuYogFkHzWgMHSt8B79aNNbFppQzCSQ2yZ9E4nL6RQJU7 1000000
docker exec -it liquid elements-cli generatetoaddress 1 AzpsKhC6xE9FEK4aWAzMnbvueMLiSa5ym1xpuYogFkHzWgMHSt8B79aNNbFppQzCSQ2yZ9E4nL6RQJU7
docker exec -it lnd lncli create # set password to "password"
sed -i "s/# wallet/wallet/g" config/lnd/lnd.conf
CERT=$(sudo base64 config/lnd/tls.cert | tr -d '\n') 
sed -i "s/LS0tL.*\"/$CERT\"/g" config/index.js
MACAROON=$(sudo base64 config/lnd/data/chain/bitcoin/regtest/admin.macaroon | tr -d '\n') 
sed -i "s/AgED.*\"/$MACAROON\"/g" config/index.js
```

After successful creation of all docker containers coinos ui will be available at http://localhost:8085 and coinos server will be available at http://localhost:3119

### Setup Lightning Channels

    docker exec -it cl lightning-cli getinfo
    docker exec -it lnd lncli --network=regtest --chain=bitcoin connect 029ba19ec5f65f82b1952fd535a86ff136ccc67ff7f91e19c3fcbc83a5224adaee@cl:9735
    docker exec -it lnd lncli --network=regtest --chain=bitcoin openchannel 029ba19ec5f65f82b1952fd535a86ff136ccc67ff7f91e19c3fcbc83a5224adaee 10000000
    docker exec -it bitcoin bitcoin-cli generatetoaddress 10 $(docker exec -it bitcoin bitcoin-cli getnewaddress "" "legacy")

### License

This code is [licensed].  Coinos is free for personal use.  Anyone can fork as long as it stays AGPLv3.  

To purchase a commercial license or to inquire about customized, managed instances - please reach out to us at [contact@coinos.io]


[Config changes]:(#config-changes)
[config/lnd/lnd.conf]:./sampleconfig/lnd/lnd.conf
[pwd file]:./sampleconfig/lnd/pwd
[licensed]:./LICENSE.md
[contact@coinos.io]:mailto:contact@coinos.io
[generate some BTC]:./doc/fund-server-bitcoin-cli.md
