const wretch = require("wretch");
const fetch = require("node-fetch");
wretch().polyfills({ fetch });

callWebhook = (invoice, payment) => {
  if (!invoice || !payment) return;

  let { address, text, webhook } = invoice;

  if (webhook) {
    let { amount, confirmed, hash, memo } = payment;

    l.info("calling webhook", webhook);
    return wretch()
      .url(webhook)
      .post({
        address,
        amount,
        hash,
        memo,
        confirmed,
        text,
        webhook
      })
      .json()
      .catch(console.log);
  }
};
