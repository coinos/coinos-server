import db from "$lib/db";
import ln from "$lib/ln";

export default {
  async balances(req, res) {
    let lnchannel;
    let lnwallet;

    const stream = db.scanStream({
      match: "balance:*",
      count: 100
    });

    let b = 0;
    for await (let keys of stream) {
      for (let k of keys) b += parseInt(await db.get(k));
    }
    console.log(b);

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
