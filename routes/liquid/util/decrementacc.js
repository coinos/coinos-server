const btc = config.liquid.btcasset;

module.exports = async (user, transaction, limit, fee, assets, amount, address, memo, asset) => {
    let total = amount;

    if (asset === btc) {
        let covered = 0;
        let nonbtc = assets.filter(a => a !== btc);
        if (nonbtc.length === 1) {
            let faucet = await db.Account.findOne({
                where: {
                    asset: nonbtc[0],
                    user_id: null
                },
                lock: transaction.LOCK.UPDATE,
                transaction
            });

            if (faucet) {
                // TODO: is faucet ok with 0 fee in withdraw?
                covered = faucet.balance;
                if (covered > fee) covered = fee;
                // covered = fee;
                // if (covered > faucet.balance) covered = faucet.balance;
                await faucet.decrement({balance: covered}, {transaction});
                await faucet.reload({transaction});
                await faucet.save({transaction});
            }
        }

        total += fee - covered;
    }

    if (limit && total > limit + fee)
        throw new Error("Tx amount exceeds authorized amount");

    if (asset !== btc || total) {
        l.info("creating liquid payment", user.username, asset, total, fee);

        let account = await db.Account.findOne({
            where: {
                user_id: user.id,
                asset,
                pubkey: null
            },
            lock: transaction.LOCK.UPDATE,
            order: [["balance", "DESC"]],
            transaction
        });

        if (total > account.balance) {
            l.warn("amount exceeds balance", {
                total,
                fee,
                balance: account.balance
            });
            throw new Error(
                `Insufficient funds, need ${total} ${
                    account.ticker === "BTC" ? "SAT" : account.ticker
                }, have ${account.balance}`
            );
        }

        await account.decrement({balance: total}, {transaction});
        await account.reload({transaction});

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
        return payment;
    }

    return null;
};
