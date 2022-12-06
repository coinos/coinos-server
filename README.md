# coinos-server

Coinos is a bitcoin wallet app that supports payments over the <a href="https://bitcoin.org">bitcoin</a>, <a href="https://blockstream.com/liquid/">liquid</a> and <a href="http://lightning.network/">lightning</a> networks. Try it out at <a href="https://coinos.io/">coinos.io</a>.

This repository contains the code for the backend API server which is implemented as a NodeJS application. The code for the frontend UI is tracked separately <a href="https://github.com/asoltys/coinos.io">here</a>.

## Install

The follow commands will set up bitcoin, liquid and lightning nodes in regtest mode, along with a coinos app server, database, and front end UI. You'll need to have <a href="https://docs.docker.com/get-docker/">docker</a> installed as a pre-requisite.

```bash
git clone https://github.com/coinos/coinos-server
cd coinos-server
cp -r sampleconfig config
cp -r sampledata data
sudo chown $(id -u):$(id -g) config/liquid
sudo chown $(id -u):$(id -g) config/bitcoin
cp .env.sample .env
cp fx.sample fx
docker network create net --gateway 172.18.0.1 --subnet 172.18.0.0/16
docker run -it -v $(pwd):/app --entrypoint pnpm asoltys/coinos-server i
docker-compose up -d
docker exec -i maria mysql -u root -ppassword < db/schema.sql   
docker exec -it bitcoin bitcoin-cli createwallet coinos
docker exec -it bitcoin bitcoin-cli rescanblockchain
docker exec -it bitcoin bitcoin-cli generatetoaddress 500 $(docker exec -it bitcoin bitcoin-cli getnewaddress "" "p2sh-segwit")
docker exec -it liquid elements-cli createwallet coinos
docker exec -it liquid elements-cli rescanblockchain
docker exec -it liquid elements-cli sendtoaddress AzpsKhC6xE9FEK4aWAzMnbvueMLiSa5ym1xpuYogFkHzWgMHSt8B79aNNbFppQzCSQ2yZ9E4nL6RQJU7 1000000
docker exec -it liquid elements-cli generatetoaddress 1 AzpsKhC6xE9FEK4aWAzMnbvueMLiSa5ym1xpuYogFkHzWgMHSt8B79aNNbFppQzCSQ2yZ9E4nL6RQJU7
curl localhost:3119/register -H "content-type: application/json" -d '{"user": { "username": "coinosfees", "password": "password"}}'
```

After successful creation of all docker containers coinos ui will be available at http://localhost:8085 and coinos server will be available at http://localhost:3119

### License

This code is [licensed].  Coinos is free for personal use.  Anyone can fork as long as it stays AGPLv3.  

To purchase a commercial license or to inquire about customized, managed instances - please reach out to us at [contact@coinos.io]


[Config changes]:(#config-changes)
[config/lnd/lnd.conf]:./sampleconfig/lnd/lnd.conf
[pwd file]:./sampleconfig/lnd/pwd
[licensed]:./LICENSE.md
[contact@coinos.io]:mailto:contact@coinos.io
[generate some BTC]:./doc/fund-server-bitcoin-cli.md
