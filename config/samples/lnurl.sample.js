module.exports = {
  host: "localhost",
  port: 3118,
  protocol: "http",
  url: "http://localhost:8085",
  auth: {
    apiKeys: [
      {
        id: "50bdeb634d",
        key: "ac9bdd15a983072311c74c13877d122f16a27a8f40cb4dfa5014eece4da5cda2"
      }
    ]
  },
  lightning: {
    backend: "lnd",
    config: {
      hostname: "localhost:8005",
      cert: "/home/user/.lnd.sima/tls.cert",
      macaroon: "/home/user/.lnd.sima/data/chain/bitcoin/regtest/admin.macaroon"
    }
  },
	store: {
    backend: 'knex',
    config: {
      client: 'sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: './lnurl-server.sqlite3',
      },
    },
  },
};
