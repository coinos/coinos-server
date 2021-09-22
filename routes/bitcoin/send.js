const decrementAccount = require('./util/decrementacc');
const addPayment = require('./util/addPayment');

module.exports = ah(async (req, res) => {
  let { user } = req;
  let { address, memo, tx } = req.body;
  let { hex } = tx;

  let fee = toSats(tx.fee);
  if (fee < 0) throw new Error("fee cannot be negative");

  const isChange = async address =>
    (await bc.getAddressInfo(address)).ismine &&
    !Object.keys(addresses).includes(address);

  tx = await bc.decodeRawTransaction(hex);

  let total = 0;
  let change = 0;

  for (let i = 0; i < tx.vout.length; i++) {
    let o = tx.vout[i];
    total += toSats(o.value);

    if (o.scriptPubKey.addresses) {
      if (await isChange(o.scriptPubKey.addresses[0])) {
        change += toSats(o.value);
      }
    }
  }

  total = total - change + fee;
  let amount = total - fee;

  let account;
  try {
    account = await decrementAccount(user, amount);

    if (config.bitcoin.walletpass)
      await bc.walletPassphrase(config.bitcoin.walletpass, 300);

    hex = (await bc.signRawTransactionWithWallet(hex)).hex;
    const txid = await bc.sendRawTransaction(hex);

    res.send(await addPayment(account, user, address, amount, memo, txid, fee));
    l.info("sent bitcoin", user.username, total);
  } catch (e) {
    l.error("error sending bitcoin", e.message);
    return res.status(500).send(e.message);
  }
});
