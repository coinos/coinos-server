import { archive } from "$lib/db";
import { db, g } from "$lib/db";
import ln from "$lib/ln";
import { getDecodedToken } from "@cashu/cashu-ts";

export default {
  async balances(_, res) {
    let total = 0;

    for await (const k of db.scanIterator({ MATCH: "balance:*" })) {
      total += parseInt(await db.get(k));
    }

    for await (const k of archive.scanIterator({ MATCH: "balance:*" })) {
      total += parseInt(await archive.get(k));
    }

    const funds = await ln.listfunds();
    const lnchannel = parseInt(
      funds.channels.reduce((a, b) => a + b.channel_sat, 0),
    );
    const lnwallet = parseInt(funds.outputs.reduce((a, b) => a + b.value, 0));

    const cash = getDecodedToken(await g("cash")).proofs.reduce(
      (a, b) => a + b.amount,
      0,
    );

    const info = {
      cash,
      lnchannel,
      lnwallet,
      total,
    };

    res.send(info);
  },
};
