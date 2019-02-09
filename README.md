This is the backend API server for https://coinos.io/

It's built on NodeJS and Express and uses Sequelize to communicate with a MariaDB database server. There are a couple GraphQL endpoints I was experimenting with but most of the communication is done with REST endpoints and persistent per-user websocket connections using socket.io.

The server expects you to be running a full bitcoind node and two separate lnd instances, referred to in the code as lna and lnb. The reason for running two nodes is so that they can invoice and pay each other in the case that one CoinOS user wants to pay another CoinOS user since lnd nodes cannot pay themselves (or at least that was the case when I started, that may have changed). 

lnb takes care of generating invoices and receiving payments and lna takes deposits and sends payments. As soon as lna sends a payment, it generates an invoice for lnb to pay it back right away so that they don't become unbalanced.

We use ZMQ to communicate with bitcoind in addition to the JSON RPC so make sure your bitcoind is compiled with ZMQ enabled. This should be done automatically if you have the prerequisite libzmq dependency installed at compile time.

There are also integrations with Facebook's API for single sign-in and contacts, Stripe for taking credit card payments, Mailgun for email notifications, Twilio for SMS notifications, and Authy for two-factor authentication. Pricing info is fetched from Kraken at the time of writing and only in CAD but that's soon to change.

## Configuration

You can configure the connection info and API keys for all the external services in config/index.js 

There's a sample config at config/index.sample.js

## Database

There's a sample of the MariaDB database schema at schema.sql

For a while I was writing Sequelize migrations to keep it in sync with the codebase but right now there are a handful of columns that aren't captured in any migration.

## Installation

git clone https://github.com/asoltys/coinos-server
yarn
yarn start

