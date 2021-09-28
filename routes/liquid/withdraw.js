const btc = config.liquid.btcasset;
const getFee = require('../../lib/feeliquidtx');
const decrementAccount = require('./util/decrementacc');

module.exports = ah(async (req, res) => {
    let {user} = req;
    let {asset = btc, address, amount, memo} = req.body;

    let payment;
    try {
        await db.transaction(async transaction => {
            payment = await decrementAccount(user, transaction, toSats(amount), 0, [asset], toSats(amount), address, memo, asset);

            const txid = (await lq.sendToAddress(address, amount, 'withdrawal', memo, true));
            const fee = await getFee(txid);

            if(payment) {
                payment.fee = fee;
                const { account } = payment;

                await db.Payment.create(payment, {transaction});

                emit(user.username, "account", account.get({ plain: true }));
                emit(user.username, "payment", payment);
            }

        });

        l.info("withdraw liquid", user.username, amount);
        res.send(payment);
    } catch (e) {
        l.error("error withdrawing liquid", e.message);
        return res.status(500).send(e.message);
    }
});
