import fs from "fs";

export default {
  host: "app",
  port: 3118,
  protocol: "http",
  url: "https://staging.coinos.io",
  endpoint: "/lnurl",
  listen: true,
  auth: {
    apiKeys: [
      {
        id: "50bdeb634d",
        key: "ac9bdd15a983072311c74c13877d122f16a27a8f40cb4dfa5014eece4da5cda2"
      }
    ]
  },
  lightning: {
    backend: "c-lightning",
    config: {
      unixSockPath: "/app/config/lightning/regtest/lightning-rpc"
    }
  },
  store: {
    backend: "knex",
    config: {
      client: "mysql",
      connection: {
        host: "maria",
        user: "root",
        password: "password",
        database: "coinos"
      }
    }
  }
};
