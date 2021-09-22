module.exports = async (txid) => {
    const tx = await bc.getRawTransaction(txid);
    const transaction = await bc.decodeRawTransaction(tx);
    let valueIn = 0;
    let valueOut = 0;

    const txVin = await Promise.all(
        transaction.vin.map(async o =>
            await bc.decodeRawTransaction(
                await bc.getRawTransaction(o.txid)
            )
        )
    );

    txVin.forEach(o => o.vout.forEach(o => valueIn += o.value));
    transaction.vout.forEach(o => valueOut += o.value);

    return toSats(valueIn - valueOut);
}
