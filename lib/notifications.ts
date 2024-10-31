import config from "$config";
import { db } from "$lib/db";
import { err, warn } from "$lib/logging";
import { mail, templates } from "$lib/mail";
import mqtt from "$lib/mqtt";
import { emit } from "$lib/sockets";
import { f, fiat, fmt, link, t } from "$lib/utils";
import webpush from "web-push";

if (config.vapid) {
  webpush.setVapidDetails(
    `mailto:${config.support}`,
    config.vapid.pk,
    config.vapid.sk,
  );
}

export const notify = async (p, user, withdrawal) => {
  emit(user.id, "payment", p);
  const { username } = user;
  const { paymentReceived } = t(user);

  try {
    if (user.verified && user.notify) {
      mail(user, paymentReceived, templates.paymentReceived, {
        ...t(user),
        username,
        payment: {
          amount: fmt(p.amount),
          link: link(p.id),
          tip: p.tip ? fmt(p.tip) : undefined,
          fiat: f(fiat(p.amount, p.rate), p.currency),
          fiatTip: p.tip ? f(fiat(p.tip, p.rate), p.currency) : undefined,
          memo: p.memo,
          items: p.items?.map((i) => {
            return {
              quantity: i.quantity,
              name: i.name,
              total: i.quantity * i.price,
              totalFiat: f(i.quantity * i.price, p.currency),
            };
          }),
        },
        withdrawal,
      });
    }
  } catch (e) {
    err("problem emailing", e.message);
  }

  const subscriptions = await db.sMembers(`${user.id}:subscriptions`);

  const payload = {
    title: paymentReceived,
    body: `${fmt(p.amount)} ${f(fiat(p.amount, p.rate), p.currency)}`,
    url: `/payment/${p.id}`,
  };

  for (const s of subscriptions) {
    webpush
      .sendNotification(JSON.parse(s), JSON.stringify(payload))
      .catch((e) => {
        warn("sub failed", e.message);
        db.sRem(`${user.id}:subscriptions`, s);
      });
  }

  if (config.mqtt) {
    if (!mqtt.connected) await mqtt.reconnect();
    mqtt.publish(
      username,
      `pay:${p.amount}:${p.tip}:${p.rate}:${p.created}:${p.id}:${p.memo}:${p.items}`,
    );
  }
};
