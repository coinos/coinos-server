import fs from 'fs';
import grpc from 'grpc';
import createLnrpc from 'lnrpc';
import { promisify } from 'util';

export default async ({ server, tls, macaroon, channelpeers }) => {
  const lnrpc = await createLnrpc({ server, tls });
  lnrpc.meta = new grpc.Metadata();
  lnrpc.meta.add('macaroon', fs.readFileSync(macaroon).toString('hex'));
  lnrpc.channelpeers = channelpeers;

  // Resolve proxy instance
  return new Proxy(lnrpc, {
    /**
     * Promisify each lightning RPC method
     * @param  {lnrpc.Lightning} target
     * @param  {String}          key
     * @return {Promise} {Any}
     */
    get(target, key) {
      const method = target[key];

      if (typeof key === 'string' && typeof method === 'function') {
        const streaming = key.match(/openChannel$|sendPayment|subscribe.*/);
        let fn;

        if (streaming) {
          if (key === 'sendPayment') {
            fn = params => method.call(lnrpc, target.meta, params);
          } else {
            fn = params => method.call(lnrpc, params, target.meta);
          }
        } else {
          fn = params => promisify(method).call(lnrpc, params, target.meta);
        }

        return fn;
      }

      return target[key]; // forward
    },
  });
};
