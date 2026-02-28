import { archive } from "$lib/db";
import { db, g } from "$lib/db";
import { getHealthStatus } from "$lib/health";
import ln from "$lib/ln";
import { getDecodedToken } from "@cashu/cashu-ts";

export default {
  async health(c) {
    const status = getHealthStatus();
    const httpStatus = status.healthy ? 200 : 503;
    return c.json(status, httpStatus);
  },

  async balances(c) {
    let total = 0;

    const funds = await ln.listfunds();
    const lnchannel = parseInt(funds.channels.reduce((a, b) => a + b.channel_sat, 0));
    const lnwallet = parseInt(funds.outputs.reduce((a, b) => a + b.value, 0));

    const cash = getDecodedToken(await g("cash")).proofs.reduce((a, b) => a + b.amount, 0);

    const info = {
      cash,
      lnchannel,
      lnwallet,
    };

    return c.json(info);
  },
};
