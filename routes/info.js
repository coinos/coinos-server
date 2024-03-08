import { archive } from "$lib/db";
import db from "$lib/db";
import ln from "$lib/ln";

export default {
  async balances(req, res) {
    let lnchannel;
    let lnwallet;

    let total = 0;

    for await (let k of db.scanIterator({ MATCH: "balance:*" })) {
      total += parseInt(await db.get(k));
    }

    for await (let k of archive.scanIterator({ MATCH: "balance:*" })) {
      total += parseInt(await archive.get(k));
    }

    const funds = await ln.listfunds();
    lnchannel = parseInt(funds.channels.reduce((a, b) => a + b.channel_sat, 0));
    lnwallet = parseInt(funds.outputs.reduce((a, b) => a + b.value, 0));

    const info = {
      lnchannel,
      lnwallet,
      total,
    };

    res.send(info);
  },
};
