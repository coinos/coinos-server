import config from "$config";
import { db, g } from "$lib/db";
import ln from "$lib/ln";
import { err, l, warn } from "$lib/logging";
import { mail, templates } from "$lib/mail";
import mqtt from "$lib/mqtt";
import { encryptPayload, publish, serverSecret2 } from "$lib/nostr";
import { emit } from "$lib/sockets";
import { f, fiat, fmt, getUser, link, nada, t } from "$lib/utils";
import { hexToBytes } from "@noble/hashes/utils";
import { finalizeEvent } from "nostr-tools";
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
      let payment_hash = p.payment_hash || "";
      if (!payment_hash && (p.type === "lightning" || p.type === "bolt12")) {
        try {
          const d = await ln.decode(p.hash);
          // bolt11 decodes expose payment_hash, bolt12 invoices
          // invoice_payment_hash
          payment_hash = d.payment_hash || d.invoice_payment_hash || "";
        } catch (e) {}
      }
      for (const pubkey of pubkeys) {
        // The app record may be missing/not-yet-written: a pubkey lands in
        // `${uid}:apps` before its `app:<pubkey>` is persisted (creation race when
        // adding an NWC connection), or a stale entry outlived its record. Guard
        // the lookup — destructuring `notify` off null threw and, since the catch
        // wraps the whole loop, aborted notifications for ALL the user's apps.
        const app = await g(`app:${pubkey}`);
        if (!app?.notify) continue;

        l("notifying", pubkey, p.type, p.amount);
        const notification = {
          type: p.amount > 0 ? "incoming" : "outgoing",
          invoice: p.hash,
          description: p.memo,
          preimage: p.ref,
          payment_hash: payment_hash,
          amount: Math.abs(p.amount) * 1000,
          fees_paid: (parseInt(p.fee) || 0) * 1000,
          created_at: Math.round(p.created / 1000),
          settled_at: Math.round(p.created / 1000),
        };

        const payload = JSON.stringify({
          notification_type: p.amount > 0 ? "payment_received" : "payment_sent",
          notification,
        });

        // NIP-47: a wallet supporting both schemes publishes each notification
        // twice — kind 23196 nip04-encrypted, kind 23197 nip44-encrypted
        for (const [scheme, kind] of [
          ["nip04", 23196],
          ["nip44_v2", 23197],
        ] as const) {
          const content = await encryptPayload(
            scheme,
            serverSecret2,
            pubkey,
            payload,
          );

          const unsigned = {
            content,
            tags: [["p", pubkey]],
            kind,
            created_at: Math.floor(Date.now() / 1000),
          };

          const event = finalizeEvent(unsigned, hexToBytes(serverSecret2));

          publish(event).catch(nada);
        }
      }
    }
  } catch (e) {
    warn("nwc notification failed", e.message);
  }
};
