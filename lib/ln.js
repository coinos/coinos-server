import config from "../config/index.js";
let ln;

if (config.lna.clightning) {
  ln = (await import("clightning-client"))(config.lna.dir);
} else {
  let lnd = await import("../lib/lnd");
  ln = [
    "addInvoice",
    "channelBalance",
    "connectPeer",
    "decodePayReq",
    "getInfo",
    "listInvoices",
    "listPayments",
    "sendPaymentSync",
    "walletBalance"
  ].reduce(
    (a, b) =>
      (a[b] = args => new Promise(r => lnd[b](args, (e, v) => r(v)))) && a,
    {}
  );
}

export default ln;
