import config from "$config";
import { db } from "$lib/db";
import ln from "$lib/ln";
import { err, warn } from "$lib/logging";
import { mail, templates } from "$lib/mail";
import mqtt from "$lib/mqtt";
import { publish, serverSecret } from "$lib/nostr";
import { emit } from "$lib/sockets";
import { f, fiat, fmt, getUser, link, nada, t } from "$lib/utils";
import { hexToBytes } from "@noble/hashes/utils";
import { finalizeEvent, nip04 } from "nostr-tools";
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
  let { username } = user;
  const { paymentReceived } = t(user);
  username = username.replace(/\s/g, "");

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

export const nwcNotify = async (p) => {
  try {
    const user = await getUser(p.uid);
    const pubkeys = await db.sMembers(`${user.id}:apps`);
    if (pubkeys.length) {
      let payment_hash = "";
      if (p.type === "lightning") ({ payment_hash } = await ln.decode(p.hash));
      for (const pubkey of pubkeys) {
        const notification = {
          type: p.amount > 0 ? "incoming" : "outgoing",
          invoice: p.hash,
          description: p.memo,
          preimage: p.ref,
          payment_hash: payment_hash,
          amount: Math.abs(p.amount) * 1000,
          fees_paid: (parseInt(p.fee) || 0) * 1000,
          created_at: p.created,
          settled_at: p.created,
        };

        const payload = JSON.stringify({
          notification_type: p.amount > 0 ? "payment_received" : "payment_sent",
          notification,
        });

        const content = await nip04.encrypt(serverSecret, pubkey, payload);

        const unsigned = {
          content,
          tags: [["p", pubkey]],
          kind: 23196,
          created_at: Math.floor(Date.now() / 1000),
        };

        const event = finalizeEvent(unsigned, hexToBytes(serverSecret));

        publish(event).catch(nada);
      }
    }
  } catch (e) {
    warn("nwc notification failed", e.message);
  }
};
