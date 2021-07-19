const debug = require("debug")("test");

const db = {
  user: "root",
  password: "password",
  database: "coinos",
  host: "mariadb",
  dialect: "mariadb",
  dialectOptions: { multipleStatements: true, timezone: "Etc/GMT+7" },
};

const btcasset =
  "5ac9f65c0efcc4775e0baec4ec03abdde22473cd3cf33c0419ca290e0751b225";

module.exports = {
  db,
  clientVersion: "3b96359d6a6ce68fe4a32f495fc9a6f78af0aa63",
  knex: {
    client: "mysql2",
    connection: db,
  },
  jwt: "secret",
  port: 3119,
  bitcoin: {
    masterkey:
      "tprv8ZgxMBicQKsPdTUoagV41nang9pQUA2DKoVWLmTrWmb2PfsC8pDTHveCMyzUyMguKJCjd5uyHcqg27r7gDzz4TY3MgucpLsSXwCbjn2C3Q1",
    host: "bitcoin",
    wallet: "coinosdev",
    username: "admin1",
    password: "123",
    network: "regtest",
    port: 18443,
    zmqrawblock: "tcp://bitcoin:18506",
    zmqrawtx: "tcp://bitcoin:18507",
  },
  liquid: {
    masterkey:
      "tprv8ZgxMBicQKsPfBjZp16yQUmZM3DWh5fb366inBXF3Xk6ANhJYqxXYL4FeQxAW5kjT3ku1A1wmS79c5y6RajKr2TkCADG8A3h4WdggbFMXX1",
    blindkey:
      "099e599b1d79dbc536c6f8461772d7f2f9583d7b6f3fba70394d60b599c3bd96",
    host: "liquid",
    username: "admin1",
    password: "123",
    network: "regtest",
    wallet: "a",
    port: 7040,
    zmqrawblock: "tcp://liquid:18602",
    zmqrawtx: "tcp://liquid:18603",
    btcasset,
  },
  lna: {
    clightning: true,
    dir: "/app/config/lightning/regtest",
  },
};
