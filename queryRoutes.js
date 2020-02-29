const bolt11 = require("bolt11");
const config = require("./config");

var fs = require('fs');
var grpc = require('grpc');
var lnrpc = grpc.load('/root/grpc/rpc.proto').lnrpc;
process.env.GRPC_SSL_CIPHER_SUITES = 'HIGH+ECDSA'
var lndCert = fs.readFileSync('/root/.lnda/tls.cert');
var sslCreds = grpc.credentials.createSsl(lndCert);
var macaroonCreds = grpc.credentials.createFromMetadataGenerator(function(args, callback) {
    var macaroon = fs.readFileSync("/root/.lnda/data/chain/bitcoin/mainnet/admin.macaroon").toString('hex');
    var metadata = new grpc.Metadata()
    metadata.add('macaroon', macaroon);
    callback(null, metadata);
  });
var creds = grpc.credentials.combineChannelCredentials(sslCreds, macaroonCreds);
var lightning = new lnrpc.Lightning('localhost:10001', creds);


const l = console.log;

module.exports = (app, db, emit, seen, lna, lnb) => async (req, res) => {
  let hash = req.body.payreq;
  let payreq = bolt11.decode(hash);
  const request = { "pub_key": payreq.payeeNodeKey, "amt": payreq.satoshis };
  lightning.queryRoutes(request, function(err, response) {
    res.send(response);
  })
};
