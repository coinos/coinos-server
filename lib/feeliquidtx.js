module.exports = async (txid) => {
    const tx = await lq.getRawTransaction(txid);
    const transaction = await lq.decodeRawTransaction(tx);
    let valueOut = 0;

    transaction.vout.forEach(o => {
        if (o.scriptPubKey.type === 'fee') {
            valueOut = o.value;
        }
    });

    return toSats(valueOut);
}
