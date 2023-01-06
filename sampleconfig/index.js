import lnurl from "./lnurl";

const db = {
  user: "root",
  password: "password",
  database: "coinos",
  options: {
    logging: false,
    host: "maria",
    dialect: "mariadb",
    dialectOptions: { multipleStatements: true, timezone: "Etc/GMT+7" }
  }
};

const btcasset =
  "5ac9f65c0efcc4775e0baec4ec03abdde22473cd3cf33c0419ca290e0751b225";

export default {
  nostr: "http://api:9393",
  relay: "ws://nostr:8080",
  ipxapi: "4275|PqKjKaxIlzooToria2m4XFLzvHihSpsZMX4hvgxu",
  webhooks: {
    "http://172.18.0.1:5173/wallet/purchase": "horsey"
  },
  postmark: "d64dffd2-84ea-47c7-ba9f-95505332d0ae",
  db,
  clientVersion: "3b96359d6a6ce68fe4a32f495fc9a6f78af0aa63",
  lnurl,
  knex: {
    client: "mysql2",
    connection: db
  },
  jwt: Buffer.from(
    "00d0ab4f7738a83feb37f661526512063c41e49278b7c32cba87314269a5788b",
    "hex"
  ),
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
    zmqrawtx: "tcp://bitcoin:18507"
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
    btcasset
  },
  lna: {
    clightning: true,
    dir: "/app/config/lightning/regtest/lightning-rpc"
    /*
    lnd: true
    socket: "lnd:10009",
    // get this with: sudo base64 config/lnd/tls.cert | tr -d '\n'
    cert:
      "LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSUNLVENDQWMrZ0F3SUJBZ0lRVE4wWEhJdTI1eitKaUpmVUxSOTROVEFLQmdncWhrak9QUVFEQWpBNE1SOHcKSFFZRFZRUUtFeFpzYm1RZ1lYVjBiMmRsYm1WeVlYUmxaQ0JqWlhKME1SVXdFd1lEVlFRREV3d3haREkyWVRkagpObUZqTVRZd0hoY05Nakl3TlRFMU1qSTFOVFEyV2hjTk1qTXdOekV3TWpJMU5UUTJXakE0TVI4d0hRWURWUVFLCkV4WnNibVFnWVhWMGIyZGxibVZ5WVhSbFpDQmpaWEowTVJVd0V3WURWUVFERXd3eFpESTJZVGRqTm1Gak1UWXcKV1RBVEJnY3Foa2pPUFFJQkJnZ3Foa2pPUFFNQkJ3TkNBQVFjdzRtR0lNbEpkTWsvT2pEWkJ6U21HTm5kY3pQZgphSGlCQytqd0F5RVBnOUhqY3o2MlhYSXdxcTFiV2xmOGtuck5lamg2cm5zQTgrYkNOWTBkNFlxRW80RzZNSUczCk1BNEdBMVVkRHdFQi93UUVBd0lDcERBVEJnTlZIU1VFRERBS0JnZ3JCZ0VGQlFjREFUQVBCZ05WSFJNQkFmOEUKQlRBREFRSC9NQjBHQTFVZERnUVdCQlNZTmx4NTBXU2VIN0VTSTZ2eVJCL2JNMG01QmpCZ0JnTlZIUkVFV1RCWApnZ3d4WkRJMllUZGpObUZqTVRhQ0NXeHZZMkZzYUc5emRJSURiRzVrZ2dSMWJtbDRnZ3AxYm1sNGNHRmphMlYwCmdnZGlkV1pqYjI1dWh3Ui9BQUFCaHhBQUFBQUFBQUFBQUFBQUFBQUFBQUFCaHdTc0VnQUhNQW9HQ0NxR1NNNDkKQkFNQ0EwZ0FNRVVDSUU5M3hBWEFxQzBuejdqRWVXWVN3czB2dlZWZmcvSEFNYnNLSzVXMFFNMCtBaUVBME5EVgpOV0VVdU9Vdk4ydTZ0UjBpRFh3dXhPMmJtTDltVEZwejhHc3RUKzA9Ci0tLS0tRU5EIENFUlRJRklDQVRFLS0tLS0K",
    // get this with: sudo base64 config/lnd/data/chain/bitcoin/regtest/admin.macaroon | tr -d '\n'
    macaroon:
      "AgEDbG5kAvgBAwoQFdsmSt7tRRKg8kFR+avH0BIBMBoWCgdhZGRyZXNzEgRyZWFkEgV3cml0ZRoTCgRpbmZvEgRyZWFkEgV3cml0ZRoXCghpbnZvaWNlcxIEcmVhZBIFd3JpdGUaIQoIbWFjYXJvb24SCGdlbmVyYXRlEgRyZWFkEgV3cml0ZRoWCgdtZXNzYWdlEgRyZWFkEgV3cml0ZRoXCghvZmZjaGFpbhIEcmVhZBIFd3JpdGUaFgoHb25jaGFpbhIEcmVhZBIFd3JpdGUaFAoFcGVlcnMSBHJlYWQSBXdyaXRlGhgKBnNpZ25lchIIZ2VuZXJhdGUSBHJlYWQAAAYgR93/t3TVABMMqjYOdcYG/B70ZczhSoLXVT7NlocedG0="
      */
  }
};
