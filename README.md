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
cp .env.sample .env
cp fx.sample fx
docker network create net
docker run -it -v $(pwd):/app --entrypoint yarn asoltys/coinos-server
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d
docker exec -i mariadb mysql -u root -ppassword < db/schema.sql   
docker exec -it liquid elements-cli -conf=/home/elements/.elements/elements.conf sendtoaddress AzpsKhC6xE9FEK4aWAzMnbvueMLiSa5ym1xpuYogFkHzWgMHSt8B79aNNbFppQzCSQ2yZ9E4nL6RQJU7 1000000
```

then run this and keep reference to the result for the forthcoming [Config changes] 

```bash
sudo base64 config/lnd/tls.cert | tr -d '\n'
```
then run this and type a password when prompted, and then 'n' to create new wallet: 

```bash 
docker exec -it lnd lncli create
```
(optionally write down the seed as backup in case you lose the wallet and/or password)

then uncomment line 12 of [config/lnd/lnd.conf] and update the [pwd file] with the new wallet password you just set.

then run this and keep reference to the result again:
```bash
sudo base64 config/lnd/data/chain/bitcoin/regtest/admin.macaroon | tr -d '\n'
```

then run:
```bash
docker-compose down --remove-orphans
``` 
and start it back up again with the same command from before: 
```bash
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

and finally, create a Bitcoin wallet: 

```
docker exec -it bitcoin bitcoin-cli -regtest -rpcuser=admin1 -rpcpassword=123 createwallet coinos
```

then [generate some BTC] to fund the server. 

For reviewing output, you may run `docker-compose logs` or run the docker-compose up command above but without the `-d `flag

### Setup pre-commit git hooks
    
   We have a pre-commit git hook for running prettier on all files to keep the formatting consistent.
    
   `git config core.hooksPath "./git_hooks"` - This will set the git config path to use this directory for hooks.
    
   `chmod +x ./git_hooks/pre-commit` - This will give the hook the necessary permissions to run.

### Config changes

Navigate to `./config/index.js`
Under `lna`, update the values for `cert` and `macaroon` with the output from the respective commands you ran in the section above.

### Wallet not found issues
If your app logs complain that the wallet was not found, do the following:
```bash
docker-compose exec bitcoin bash
bitcoin-cli createwallet coinos
exit
docker exec -it lnd lncli --network=regtest --chain=bitcoin unlock
```
### Spinning down coinos & services

from the root of this repo, run: 

```bash
docker-compose down --remove-orphans
```

---


Note the initial `docker-compose up` step will take some time on first run as it will download all of the necessary images.

After successful creation of all docker containers coinos will be available at http://localhost:8085 

To shutdown coinos and all of its containers/services, run `docker-compose down --remove-orphans` again.  

At anypoint to purge the database and start with a new one run `rm -rf mysql` and then `mkdir mysql` and then the same steps following from that point as outlined above.   Or run `purge-except-git.sh` from `./scripts`

To review a log of individual containers use `docker-compose app` or `docker-compose maria` etc; container names are available in `docker-compose.yml` or via `docker-compose ps` when they are running.  `docker images` will show you a list of the images installed on your system and `docker image rm [IMAGE ID]` removes them.

#### Volumes and local filesystem changes

The `docker-compose.yml` specifies volumes that map to the host (ie- your local machine).  As per Docker's <a href="https://docs.docker.com/storage/volumes/">volume feature</a> these override what is in the container's 'virtual' filesystem for those folders and instead will map to what is on your local filesystem.  As such, changes/developments that occur in these locations will be reflected without needing to restart the containers. 

Additionally <a href="https://github.com/remy/nodemon">Nodemon</a> is setup by default to watch coinos-server directory and will auto-restart the app as changes occur. 

Alternative to allowing nodemon to manage the app, you may enter bash on the docker to start/stop the node app manually ie: 

    docker exec -it app bash
    node index.js 
    # ^ starts app manually in a bash session inside the docker
    # ( reflecting your local coinos-server directory)


To prevent nodemon from starting with the container change the `package.json` `"start"` script value to: `"tail -f /dev/null"` which will then keep the container alive so you may enter an interactive bash as above to start the app manually. 

#### Debugging

To debug the node app while it is running via Docker, edit `docker-compose.yml` to add `9229` to the ports section for the `app` service: 

    ports:
      - '3119:3119'
      - '9229'

then get the IP of the app container: 

    docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' app
    > 192.168.115.72 #outputs the coinos app container IP

then edit `package.json` start script to: 

    "start" : "nodemon --inspect=0.0.0.0 index.js",

(or use the interactive bash technique above with this same inspect flag)

restart with `docker-compose restart app`

then open your browser (Chrome in this example) to the URL`chrome://inspect` then click "Configure" and add the IP address + debugger port to the list of targets ex- `192.168.115.72:92229`

an inspect link will then display under 'Remote Target'!

  Note the IP address may change between restarts so you may have to rerun the docker inspect command above again to make sure you have the correct IP on following sessions. 

----

### Install/Run (standalone)

Note the Docker way outlined above is recommended as manual setup requirements/instructions shown below are out of date. 


#### Requirements

* <a href="https://github.com/bitcoin/bitcoin">bitcoind</a> with zmq support
* <a href="https://github.com/ElementsProject/elements">elementsd</a> with zmq support
* <a href="https://github.com/lightningnetwork/lnd">lnd</a> or <a href="https://github.com/elementsproject/lightning">c-lightning</a>
* a database that <a href="https://github.com/sequelize/sequelize">sequelize</a> can talk to

The bitcoind and elementsd nodes can be a pruned if you want to limit the amount of disk space used.

#### Getting Started

    git clone git@github.com:coinos/coinos-server.git
    cd coinos-server
    cp -rf sampleconfig ./config    # edit config files as necessary for your local setup
    cp .env.sample .env
    yarn
    yarn start 
    # or, alternatively
    yarn min    # to run a stripped down development version that doesn't do payments or talk to any nodes

#### Database Setup

I've only tested with <a href="https://mariadb.org/">Maria</a>. Here's a [schema](https://github.com/asoltys/coinos-server/blob/master/db/schema.sql) to get you started.

    cat db/schema.sql | mysql -u root -p

---
### Miscellaneous Commands

#### Funding the regtest chain

##### Bitcoin

generate some blocks

    docker exec -it bitcoin bitcoin-cli generatetoaddress 1 $(docker exec -it bitcoin bitcoin-cli getnewaddress "" "legacy")

get balance

    docker exec -it bitcoin bitcoin-cli getbalance

---
##### Liquid

The Liquid network gives you a starting balance of Bitcoin specified in the `config/liquid/elements.conf` file as `initialfreecoins`. 

generate some blocks

    docker exec -it liquid elements-cli generatetoaddress 1 $(docker exec -it liquid elements-cli getnewaddress)

get balance

    docker exec -it liquid elements-cli getbalance

---
##### Lightning

get node id of clighting node

    docker exec -it cl lightning-cli getinfo

connect to clightning node

    docker exec -it lnd lncli --network=regtest --chain=bitcoin connect 029ba19ec5f65f82b1952fd535a86ff136ccc67ff7f91e19c3fcbc83a5224adaee@cl:9735

open a channel

    docker exec -it lnd lncli --network=regtest --chain=bitcoin openchannel 029ba19ec5f65f82b1952fd535a86ff136ccc67ff7f91e19c3fcbc83a5224adaee 10000000

generate 10 btc blocks

    docker exec -it bitcoin bitcoin-cli generatetoaddress 10 $(docker exec -it bitcoin bitcoin-cli getnewaddress "" "legacy")

---
#### Test clightning payment

payment request from clightning

    docker exec -it cl lightning-cli invoice 100000 "test payment" "test desc"

get full payment request code from field bolt11

    something like this
    
    lnbcrt1u1p3qhle9pp5mzn7aezr59tmlmp5mg9x2sa45j8fec5ygmwx6mg2x29qpnnw3j9qdq0w3jhxapqv3jhxccxqyjw5qcqp2sp54tuk3ns3gd66w50hflkzwks0d9z9eelsa8284283zhkug9kevzqq9qyyssqjsprhd38eywg6kp8w7gmwf48hnx0mpd28465v9f595xfrec0dg2jnqdumrmeh9srw32u5t9g6tdy6tdpu47emhkfnu72fnzevvwd0acqxmurkx

Use this botl11 address and paste in the UI to check 

---
#### Check if all three nodes are connected

    curl http://localhost:8085/api/info

(look for nodes array at the end)


### license

This code is [licensed].  Coinos is free for personal use.  Anyone can fork as long as it stays AGPLv3.  

To purchase a commercial license or to inquire about customized, managed instances - please reach out to us at [contact@coinos.io]


[Config changes]:(#config-changes)
[config/lnd/lnd.conf]:./sampleconfig/lnd/lnd.conf
[pwd file]:./sampleconfig/lnd/pwd
[licensed]:./LICENSE.md
[contact@coinos.io]:mailto:contact@coinos.io
[generate some BTC]:./doc/fund-server-bitcoin-cli.md
