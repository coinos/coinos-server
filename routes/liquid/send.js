const btc = config.liquid.btcasset;

module.exports = ah(async (req, res) => {
  let { user } = req;
  let { address, memo, tx } = req.body;

  const isChange = async address =>
    (await lq.getAddressInfo(address)).ismine &&
    !Object.keys(addresses).includes(address);

  let totals = {};
  let change = {};
  let fee = 0;

  let { vout } = await lq.decodeRawTransaction(tx.hex);

  for (let i = 0; i < vout.length; i++) {
    let {
      asset,
      value,
      scriptPubKey: { type, addresses }
    } = vout[i];

    if (type === "fee") fee = toSats(value);
    else {
      if (!totals[asset]) totals[asset] = change[asset] = 0;
      totals[asset] += toSats(value);

      if (addresses) {
        if (await isChange(addresses[0])) {
          change[asset] += toSats(value);
        }
      }
    }
  }

  const assets = Object.keys(totals);
  const payments = [];

  try {
    await db.transaction(async transaction => {
      for (let i = 0; i < assets.length; i++) {
        let asset = assets[i];
        let amount = totals[asset];
        if (change[asset]) amount -= change[asset];
        let total = amount;

        if (asset === btc) {
          let covered = 0;
          let nonbtc = assets.filter(a => a !== btc);
          if (nonbtc.length === 1) {
            let faucet = await db.Account.findOne({
              where: {
                asset: nonbtc[0],
                user_id: null
              }
            });

            if (faucet) {
              covered = faucet.balance;
              if (covered > fee) covered = fee;
              faucet.balance -= covered;
              await faucet.save({ transaction });
            }

            total += fee - covered;
          }
        }

        if (asset !== btc || total) {
          l.info("creating liquid payment", user.username, asset, total, fee);

          let account = await db.Account.findOne({
            where: {
              user_id: user.id,
              asset,
              pubkey: null
            },
            lock: transaction.LOCK.UPDATE,
            transaction
          });

          if (total > account.balance) {
            l.warn("amount exceeds balance", {
              total,
              fee,
              balance: account.balance
            });
            throw new Error(
              `Insufficient funds, need ${total} ${account.ticker === 'BTC' ? 'SAT' : account.ticker}, have ${account.balance}`
            );
          }

          account.balance -= total;
          await account.save({ transaction });

          let payment = {
            amount: -amount,
            account_id: account.id,
            fee,
            memo,
            user_id: user.id,
            rate: app.get("rates")[user.currency],
            currency: user.currency,
            address,
            confirmed: true,
            received: false,
            network: "liquid"
          };

          payment.account = account;
          payments.push(payment);
        }
      }
    });
  } catch (e) {
    l.error("problem creating liquid payment", user.username, e.message);
    return res.status(500).send(e.message);
  }

  try {
    await db.transaction(async transaction => {
      if (config.liquid.walletpass)
        await lq.walletPassphrase(config.liquid.walletpass, 300);

      let blinded = await lq.blindRawTransaction(tx.hex);
      let signed = await lq.signRawTransactionWithWallet(blinded);
      let txid = await lq.sendRawTransaction(signed.hex);

      let main;
      for (let i = 0; i < assets.length; i++) {
        p = payments[i];
        if (p) {
          let { account } = p;
          p.hash = txid;
          p = await db.Payment.create(p, { transaction });
          if (account.ticker !== "BTC" || !main) {
            main = p.get({ plain: true });
            main.account = account.get({ plain: true });
          }
        }
      }

      emit(user.username, "account", main.account);
      emit(user.username, "payment", main);
      res.send(main);
    });
  } catch (e) {
    l.error("problem sending liquid", user.username, e.message);
    return res.status(500).send(e.message);
  }
});
