const dbOptions = require("./config.json")[process.env.NODE_ENV || "development"];

module.exports = {
  dbOptions,
  ipstack: "2e1805258268b4992ebac06e20fc1865", // optional, set default currency based on IP
  jwt: '2ad260b2202ad557b205ba17c7d8d62c69ffc95021b6147597c32eb30e3cf899',
  port: 3119,
  facebook: {
    appToken: '290368338052652|WorpE7Brn61TTKUOQUyy1T8cKvc',
    specialFriend: '10102176487832944',
  }, 
  bitcoin: {
    username: "user",
    password: "password",
    network: "regtest",
    port: 18443,
    zmqrawblock: "tcp://127.0.0.1:18506",
    zmqrawtx: "tcp://127.0.0.1:18507"
  },
  liquid: {
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
  lnb: {
    server: 'localhost:10002',
    tls: '/home/user/.lnd.testb/tls.cert',
    macaroon: '/home/user/.lnd.testb/data/chain/bitcoin/testnet/admin.macaroon',
    id: '029654df009f907a2f513d944fc9456c6cac5f3a9c34dab85289e1425856c1b0fe', // find with lightning-cli getinfo
  },
}
