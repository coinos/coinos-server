const private = require("./private.json") || {}
const debug = require('debug')('test')

const dbOptions = private.connection[process.env.NODE_ENV || "development"]
let lnurl;

try {
  lnurl = require("./lnurl");
} catch(e) {
  debug("lnurl config not found");
} 

const btcasset = "5ac9f65c0efcc4775e0baec4ec03abdde22473cd3cf33c0419ca290e0751b225";
const cadasset = "e749f7326d0ba155ec1d878e23458bc3f740a38bf91bbce955945ee10d6ab523";
const usdtasset = "4dddd1d0d0beeaee17df7722b512906cc5bc660c81225083b72b05820ecd3d91";

module.exports = {
  dbOptions: dbOptions,
  lnurl,
  clientVersion: "x11111xx11xx11x11x11111111xx1111111xx111",
  vapid: {
    url: "https://coinos.io/",
    publicKey: "xxxxxx111xxxx1xxx111xxxxxxxxxxxxxxxxx_x-xxx1xxx1xxxxxxxx1xxxxxxxxx1x1xxxxxxxx1xxx1xxxxx",
    privateKey: private.VAPID_KEY
  },
  knex: {
    client: 'mysql2',
    connection: dbOptions
  },
  ipstack: "2e1805258268b4992ebac06e20fc1865", // optional, set default currency based on IP
  jwt: private.jwt,
  port: 3119,
  facebook: private.facebook,
  bitcoin: {
    masterkey: private.BITCOIN_KEY, // get from bitcoin-cli dumpwallet "walletfile"
    username: "user",
    password: "password",
    network: "regtest",
    port: 18443,
    zmqrawblock: "tcp://127.0.0.1:18506",
    zmqrawtx: "tcp://127.0.0.1:18507"
  },
  liquid: {
    masterkey: private.LIQUID_KEY, // get from elements-cli dumpwallet "walletfile"
    blindkey: '0e66557c1dfa0c7daa371314ffd763979d3f7c5db69380e5c15ea72b85453c2e',
    wallet: "coinos",
    username: "user",
    password: "password",
    network: "regtest",
    port: 18882,
    zmqrawblock: "tcp://127.0.0.1:18602",
    zmqrawtx: "tcp://127.0.0.1:18603",
    btcasset: "b2e15d0d7a0c94e4e2ce0fe6e8691b9e451377f6e46e8045a86f7c4b5d4f0f23", // find with elements-cli dumpassetlabels
  },
  lna: {
    server: 'localhost:10001',
    tls: '/home/user/.lnd.testa/tls.cert',
    macaroon: '/home/user/.lnd.testa/data/chain/bitcoin/testnet/admin.macaroon',
  },
  maker: [ // special account with username "maker" places orders on the exchange
    {
      c1: btcasset,
      c2: cadasset,
      currency: "CAD",
      amount: 0.001,
      askMultiplier: 1.01,
      bidMultiplier: 0.99,
    },
    {
      c1: btcasset,
      c2: usdtasset,
      currency: 'USD',
      amount: 0.001,
      askMultiplier: 1.01,
      bidMultiplier: 0.99,
    }
  ],
  mailgun: {
    domain: "coinos.io",
    apiKey: "key-59cd7eaxxxxxxxxxxxxxxxxxxx"
  },
  imap: {
    user: "user@example.com",
    password: "xxxxxxxxxxxxx",
    host: "imap.mailserver.com",
    port: 993,
    tls: true,
    accounts: { "STRING_TO_GREP_FOR": 999999 },
  }
}
