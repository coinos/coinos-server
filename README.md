# coinos-server

Coinos is a bitcoin wallet app that supports payments over the <a href="https://bitcoin.org">bitcoin</a>  and <a href="http://lightning.network/">lightning</a> networks. Try it out at <a href="https://coinos.io/">coinos.io</a>.

This repository contains the code for the API server. The frontend code is at <a href="https://github.com/coinos/coinos-ui-v2">https://github.com/coinos/coinos-ui-v2</a>

## Install

The follow commands will set up bitcoin, liquid and lightning nodes in regtest mode, along with a coinos app server, database, and front end UI. You'll need to have <a href="https://docs.docker.com/get-docker/">docker</a> installed as a pre-requisite.

```bash
git clone https://github.com/coinos/coinos-server
cd coinos-server
cp -r sampledata data
docker run -it -v $(pwd):/app --entrypoint pnpm asoltys/coinos-server i
docker-compose up -d
docker exec -it bc bitcoin-cli createwallet coinos
docker exec -it bc bitcoin-cli rescanblockchain
docker exec -it bc bitcoin-cli generatetoaddress 500 $(docker exec -it bitcoin bitcoin-cli getnewaddress "" "p2sh-segwit")
```

