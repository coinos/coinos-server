const fs = require('fs');
const path = require('path');
const grpc = require('grpc');
const protoLoader = require('@grpc/proto-loader');

module.exports = ({ tls, macaroon, server }) => {
  const packageDefinition = protoLoader.loadSync('rpc.proto', {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
  });
  const lnrpc = grpc.loadPackageDefinition(packageDefinition).lnrpc;
  process.env.GRPC_SSL_CIPHER_SUITES = 'HIGH+ECDSA'
  const lndCert = fs.readFileSync(tls);
  const sslCreds = grpc.credentials.createSsl(lndCert);
  const macaroonCreds = grpc.credentials.createFromMetadataGenerator(function(args, callback) {
      const macaroonFile = fs.readFileSync(macaroon).toString('hex');
      const metadata = new grpc.Metadata()
      metadata.add('macaroon', macaroonFile);
      callback(null, metadata);
    });
  const creds = grpc.credentials.combineChannelCredentials(sslCreds, macaroonCreds);
  return new lnrpc.Lightning(server, creds);
}
