# coinos-server

Coinos is a bitcoin wallet app that supports payments over the <a href="https://bitcoin.org">bitcoin</a>, <a href="https://blockstream.com/liquid/">liquid</a> and <a href="http://lightning.network/">lightning</a> networks. Try it out at <a href="https://coinos.io/">coinos.io</a>.

This repository contains the code for the backend API server which is implemented as a NodeJS application. The code for the frontend UI is tracked separately <a href="https://github.com/asoltys/coinos.io">here</a>.

## Requirements

* <a href="https://github.com/bitcoin/bitcoin">bitcoind</a> with zmq support
* <a href="https://github.com/ElementsProject/elements">elementsd</a> with zmq support
* two instances of <a href="https://github.com/lightningnetwork/lnd">lnd</a> (<a href="https://github.com/elementsproject/lightning">c-lightning</a> coming soon)
* a database that <a href="https://github.com/sequelize/sequelize">sequelize</a> can talk to

The bitcoind and elementsd nodes can be a pruned if you want to limit the amount of disk space used.

The reason for running two lightning nodes is so that one can create invoices while the other sends payments when two coinos users want to pay each other. 

## Getting Started

    git clone https://github.com/asoltys/coinos-server
    cd coinos-server
    cp config/index.js.sample config/index.js <-- edit with connection info for servers and keys for 3rd party API's
    yarn
    yarn start

## Database Setup

I've only tested with <a href="https://mariadb.org/">Maria</a>. Here's a [schema](https://github.com/asoltys/coinos-server/blob/master/db/schema.sql) to get you started.

    cat db/schema.sql | mysql -u root -p
