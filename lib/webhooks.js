const wretch = require("wretch");
const fetch = require("node-fetch");
wretch().polyfills({ fetch });

callWebhook = (invoice, payment) => {
  if (!invoice || !payment) return;

  let { address, text, webhook } = invoice;

  if (webhook) {
    let { amount, confirmed, hash, memo, account } = payment;
    let { asset } = account;
    let secret = config.webhooks[webhook];

    l.info("calling webhook", webhook, amount, hash, address, text);
    return wretch()
      .headers({ "x-webhook": secret })
      .url(webhook)
      .post({
        address,
        asset,
        amount,
        hash,
        memo,
        confirmed,
        text,
        webhook
      })
      .res()
      .catch(console.log);
  }
};
