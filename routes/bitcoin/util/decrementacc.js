const btc = config.liquid.btcasset;

module.exports = async (user, total) => await db.transaction(async transaction => {
    let account = await db.Account.findOne({
        where: {
            id: user.account_id
        },
        lock: transaction.LOCK.UPDATE,
        transaction
    });

    if (account.asset !== btc) {
        account = await db.Account.findOne({
            where: {
                user_id: user.id,
                asset: btc,
                pubkey: null
            },
            lock: transaction.LOCK.UPDATE,
            transaction
        });
    }

    if (total > account.balance) {
        l.error("amount exceeds balance", total, account.balance);
        throw new Error("Insufficient funds");
    }

    await account.decrement({ balance: total }, { transaction });
    await account.reload({ transaction });

    return account;
});
