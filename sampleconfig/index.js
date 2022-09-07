const db = {
  user: "root",
  password: "password",
  database: "coinos",
  host: "mariadb",
  dialect: "mariadb",
  dialectOptions: { multipleStatements: true, timezone: "Etc/GMT+7" }
};

const btcasset =
  "5ac9f65c0efcc4775e0baec4ec03abdde22473cd3cf33c0419ca290e0751b225";

export default {
  db,
  clientVersion: "3b96359d6a6ce68fe4a32f495fc9a6f78af0aa63",
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
    lnd: true,
    socket: "lnd:10009",
    // get this with: sudo base64 config/lnd/tls.cert | tr -d '\n'
    cert:
      "LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSUNLekNDQWRDZ0F3SUJBZ0lSQUxrWGlSWVc1RHptTFVEa1FyVEk0eEl3Q2dZSUtvWkl6ajBFQXdJd09ERWYKTUIwR0ExVUVDaE1XYkc1a0lHRjFkRzluWlc1bGNtRjBaV1FnWTJWeWRERVZNQk1HQTFVRUF4TU1ZVFE0WVRNMgpORFkwT0dVeE1CNFhEVEl5TURrd05URTRNek0xT1ZvWERUSXpNVEF6TVRFNE16TTFPVm93T0RFZk1CMEdBMVVFCkNoTVdiRzVrSUdGMWRHOW5aVzVsY21GMFpXUWdZMlZ5ZERFVk1CTUdBMVVFQXhNTVlUUTRZVE0yTkRZME9HVXgKTUZrd0V3WUhLb1pJemowQ0FRWUlLb1pJemowREFRY0RRZ0FFVjFFRHV5MmtwK0g2K3VVRlgxSHVaYlBQeTh6KwprcUVOaS9BVGdSWnZLSnRTazd5TUJWRm1uM3ZZZmNNWDJTVSs5WjN2MXQzdml6aTM2MmNDYjJLUFJxT0J1akNCCnR6QU9CZ05WSFE4QkFmOEVCQU1DQXFRd0V3WURWUjBsQkF3d0NnWUlLd1lCQlFVSEF3RXdEd1lEVlIwVEFRSC8KQkFVd0F3RUIvekFkQmdOVkhRNEVGZ1FVNTR6TmNmdlV6aG94dGR2a2RBcnhtQ3U1UEVzd1lBWURWUjBSQkZrdwpWNElNWVRRNFlUTTJORFkwT0dVeGdnbHNiMk5oYkdodmMzU0NBMnh1WklJRWRXNXBlSUlLZFc1cGVIQmhZMnRsCmRJSUhZblZtWTI5dWJvY0Vmd0FBQVljUUFBQUFBQUFBQUFBQUFBQUFBQUFBQVljRXJCSUFHVEFLQmdncWhrak8KUFFRREFnTkpBREJHQWlFQWhHbFgvbkxCNDFlaDc3bjM4THZUTzlZcVpMajdKVC9CVk5zM0hYY1Y1UGNDSVFELwo0anNrdWs4WmdoUlFoTWhLdDhhbmhXSzhXTzNRdm5KVWcrdUxQdUZsQWc9PQotLS0tLUVORCBDRVJUSUZJQ0FURS0tLS0tCg==",
    // get this with: sudo base64 config/lnd/data/chain/bitcoin/regtest/admin.macaroon | tr -d '\n'
    macaroon:
      "AgEDbG5kAvgBAwoQmmnvoarLAytdlv0oasTlIhIBMBoWCgdhZGRyZXNzEgRyZWFkEgV3cml0ZRoTCgRpbmZvEgRyZWFkEgV3cml0ZRoXCghpbnZvaWNlcxIEcmVhZBIFd3JpdGUaIQoIbWFjYXJvb24SCGdlbmVyYXRlEgRyZWFkEgV3cml0ZRoWCgdtZXNzYWdlEgRyZWFkEgV3cml0ZRoXCghvZmZjaGFpbhIEcmVhZBIFd3JpdGUaFgoHb25jaGFpbhIEcmVhZBIFd3JpdGUaFAoFcGVlcnMSBHJlYWQSBXdyaXRlGhgKBnNpZ25lchIIZ2VuZXJhdGUSBHJlYWQAAAYgVPkLxSu/6QCUX5+ObLWXD2XD88NiR3AZNknn8QrYepM="
  }
};
