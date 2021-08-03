const fs = require('fs');
const path = require('path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const { promisify } = require('util');


module.exports = ({ tls, macaroon, server }) => {
  const packageDefinition = protoLoader.loadSync('config/rpc.proto', {
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
  const lnd = new lnrpc.Lightning(server, creds);
  
  return new Proxy(lnd, {
    get(target, key) {
      const method = target[key];
      if (typeof method === 'function' && !key.startsWith('sub')) return promisify(method);
      return target[key];
    },
  });
}
