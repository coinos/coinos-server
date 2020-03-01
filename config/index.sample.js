const dbOptions = require("./config.json")[process.env.NODE_ENV || "development"];

module.exports = {
  jwt: '2ad260b2202ad557b205ba17c7d8d62c69ffc95021b6147597c32eb30e3cf899',
  authy: {
    key: 'I6KdqjAKMZg7uMHLUrswMQ1PSEZ2gFZ4',
    sid: 'SK0d7263ed9a3f4a4bdbdcd77791b67381',
  },
  twilio: {
    authToken: 'a61a7bb0922dea9ec0098138da76afc6',
    number: '+15864091422',
    sid: 'AC2836311228c04e499e4eeb3a139a352b',
  },
  port: 3119,
  dbOptions,
  facebook: {
    appToken: '290368338052652|WorpE7Brn61TTKUOQUyy1T8cKvc',
    specialFriend: '10102176487832944',
  }, 
  mailgun: {
    domain: 'coinos.io',
    apiKey: 'key-59cd7fa2322ae2511d6b50cf9adf924d',
  },
  stripe: "sk_test_mBv5cAeehiYFDyFZJNsDwjht",
  bitcoin: {
    username: 'bitcoin',
    password: 'f-7mLj4rOxcrkqreXyTflLNaj927UsKtNapuQcHv7Kk=',
    walletpass: 'bitcoin',
    network: 'testnet',
    zmqrawblock: 'tcp://127.0.0.1:18504',
    zmqrawtx: 'tcp://127.0.0.1:18505',
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
    id: '029654df009f907a2f513d944fc9456c6cac5f3a9c34dab85289e1425856c1b0fe',
  },
  auto: {
    host: "localhost",
    dialect: "mysql",
    tables: ["users", "payments"],
  },
}
