const getFee = require('../../lib/feetx');
const decrementAccount = require('./util/decrementacc');
const addPayment = require('./util/addPayment');

module.exports = ah(async (req, res) => {
    let {user} = req;
    let {address, amount, memo} = req.body;

    let account;
    try {
        account = await decrementAccount(user, amount);
        const txid = await bc.sendToAddress(address, amount, 'withdrawal', memo, true);
        const fee = await getFee(txid);

        res.send(await addPayment(account, user, address, toSats(amount), memo, txid, fee));
        l.info("withdraw bitcoin", user.username, amount);
    } catch (e) {
        l.error("error withdrawing bitcoin", e.message);
        return res.status(500).send(e.message);
    }
});
