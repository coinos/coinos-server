module.exports = async (account, user, address, amount, memo, hash, fee) => {
    const params = {
        amount: -amount,
        memo,
        fee,
        hash,
        address,
        account_id: account.id,
        user_id: user.id,
        rate: app.get("rates")[user.currency],
        currency: user.currency,
        confirmed: true,
        received: false,
        network: "bitcoin",
    };

    let payment = await db.Payment.create(params);

    payment = payment.get({ plain: true });
    payment.account = account.get({ plain: true });

    emit(user.username, "payment", payment);

    payments.push(params.hash);
    return payment;
}
