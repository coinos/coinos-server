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
    cert: // get this with: sudo base64 config/lnd/tls.cert | tr -d '\n'
      "LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSUNLRENDQWMrZ0F3SUJBZ0lRTzBDWGhna3k0Z1RQZDFYZmxZaWFrekFLQmdncWhrak9QUVFEQWpBNE1SOHcKSFFZRFZRUUtFeFpzYm1RZ1lYVjBiMmRsYm1WeVlYUmxaQ0JqWlhKME1SVXdFd1lEVlFRREV3dzVOelJqWXpVMgpOelF4TkdRd0hoY05NakV3T0RBeU1qRXpOakkyV2hjTk1qSXdPVEkzTWpFek5qSTJXakE0TVI4d0hRWURWUVFLCkV4WnNibVFnWVhWMGIyZGxibVZ5WVhSbFpDQmpaWEowTVJVd0V3WURWUVFERXd3NU56UmpZelUyTnpReE5HUXcKV1RBVEJnY3Foa2pPUFFJQkJnZ3Foa2pPUFFNQkJ3TkNBQVE5bFM5ODlxNklzamJKTkQ1TW14eko1dnpzdGp4bgpUMFVyMitpaC9ZS1NQTlJSNFFKSzAvSk9pR1lzL3pPbGJTRDRxSGg2QlRyQmdMd0FxUDY3ZGh0bG80RzZNSUczCk1BNEdBMVVkRHdFQi93UUVBd0lDcERBVEJnTlZIU1VFRERBS0JnZ3JCZ0VGQlFjREFUQVBCZ05WSFJNQkFmOEUKQlRBREFRSC9NQjBHQTFVZERnUVdCQlE3M2s3ZXNpTXlHNW1NTTFMRjkzM3IwNG4valRCZ0JnTlZIUkVFV1RCWApnZ3c1TnpSall6VTJOelF4TkdTQ0NXeHZZMkZzYUc5emRJSURiRzVrZ2dSMWJtbDRnZ3AxYm1sNGNHRmphMlYwCmdnZGlkV1pqYjI1dWh3Ui9BQUFCaHhBQUFBQUFBQUFBQUFBQUFBQUFBQUFCaHdTc0hBQUhNQW9HQ0NxR1NNNDkKQkFNQ0EwY0FNRVFDSUFjUVdJd3YrVEkvT2NYZVpRNU1yQm5kQjFtWUQzWFEyU3E1VE5ISnkrTWZBaUF1RlEvNQpNT2pqWWdlN0hZd0gvQmwzb0ZKWWFTUUJEcVFRWE9YVkhDN3JZUT09Ci0tLS0tRU5EIENFUlRJRklDQVRFLS0tLS0K",
    macaroon: // get this with: sudo base64 config/lnd/data/chain/bitcoin/regtest/admin.macaroon | tr -d '\n'
      "AgEDbG5kAvgBAwoQ7uOeHFozqNAvezu2+4G29hIBMBoWCgdhZGRyZXNzEgRyZWFkEgV3cml0ZRoTCgRpbmZvEgRyZWFkEgV3cml0ZRoXCghpbnZvaWNlcxIEcmVhZBIFd3JpdGUaIQoIbWFjYXJvb24SCGdlbmVyYXRlEgRyZWFkEgV3cml0ZRoWCgdtZXNzYWdlEgRyZWFkEgV3cml0ZRoXCghvZmZjaGFpbhIEcmVhZBIFd3JpdGUaFgoHb25jaGFpbhIEcmVhZBIFd3JpdGUaFAoFcGVlcnMSBHJlYWQSBXdyaXRlGhgKBnNpZ25lchIIZ2VuZXJhdGUSBHJlYWQAAAYgOcqQGlllETS4FikFxk9X33ZgAi4kowVw9Ze2IcVnfHo=",
  },
};
