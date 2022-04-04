//const debug = require("debug")("test");
const fs = require('fs')

let lndCert, lndMacaroon
try {
  lndCert = fs.readFileSync(__dirname + '/lnd/tlscert.txt','utf8')
} catch (err) {
  console.warn('no cert file avail')
  lndCert = ""
}

try {
  lndMacaroon = fs.readFileSync(__dirname + '/lnd/macaroon.txt', 'utf8')
} catch (err) {
  console.warn('no macaroon file available')
  lndMacaroon = ""
}

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
  taxi: "864234bccdd230ecb6db05ebdf5061c3af42fefb9f186b3326e6454fdd3a9475",
  bitcoin: {
    masterkey:
      "tprv8ZgxMBicQKsPdTUoagV41nang9pQUA2DKoVWLmTrWmb2PfsC8pDTHveCMyzUyMguKJCjd5uyHcqg27r7gDzz4TY3MgucpLsSXwCbjn2C3Q1",
    host: "bitcoin",
    wallet: "coinos",
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
    wallet: "coinos",
    port: 7040,
    zmqrawblock: "tcp://liquid:18606",
    zmqrawtx: "tcp://liquid:18607",
    btcasset,
  },
  lna: {
    lnd: true,
    socket: "lnd:10009",
    cert: lndCert,
    macaroon: lndMacaroon
  },
};
