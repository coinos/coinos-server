import db from "$lib/db";
import ln from "$lib/ln";

export default {
  async balances(req, res) {
    let lnchannel;
    let lnwallet;

    let b = 0;
    for await (let k of db.scanIterator({ MATCH: "balance:*" })) {
      b += parseInt(await db.get(k));
    }

    const funds = await ln.listfunds();
    lnchannel = parseInt(funds.channels.reduce((a, b) => a + b.channel_sat, 0));
    lnwallet = parseInt(funds.outputs.reduce((a, b) => a + b.value, 0));

    const info = {
      lnchannel,
      lnwallet,
      total: lnchannel + lnwallet
    };

    res.send(info);
  }
};
