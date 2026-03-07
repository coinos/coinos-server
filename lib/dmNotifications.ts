import config from "$config";
import { db, g } from "$lib/db";
import { l, warn } from "$lib/logging";
import { getUser } from "$lib/utils";
import { Relay } from "nostr-tools/relay";
import webpush from "web-push";

if (config.vapid) {
  webpush.setVapidDetails(`mailto:${config.support}`, config.vapid.pk, config.vapid.sk);
}

export const listenForDMs = async () => {
  try {
    const relay = await Relay.connect(config.nostr);
    const since = Math.floor(Date.now() / 1000);

    relay.subscribe([{ kinds: [1059], since }], {
      onevent: async (event) => {
        const pTag = event.tags.find((t) => t[0] === "p");
        l(`dm event ${event.id.slice(0, 8)} p=${pTag?.[1]?.slice(0, 12) || "none"}`);
        if (!pTag) return;

        const recipientPubkey = pTag[1];

        try {
          const user = await getUser(recipientPubkey);
          if (!user?.id) { l(`dm no user for ${recipientPubkey.slice(0, 12)}`); return; }

          const subscriptions = await db.sMembers(`${user.id}:subscriptions`);
          l(`dm user=${user.username} subs=${subscriptions?.length || 0}`);
          if (!subscriptions?.length) return;

          const payload = JSON.stringify({
            title: "New message",
            body: "You have a new encrypted message",
            url: "/messages",
          });

          for (const s of subscriptions as any) {
            webpush
              .sendNotification(JSON.parse(s as string), payload)
              .catch((e) => {
                warn("dm push failed", e.message);
                db.sRem(`${user.id}:subscriptions`, s);
              });
          }
        } catch (e) {
          // User not found for this pubkey - not a coinos user
        }
      },
    });

    l("listening for DM notifications on relay");
  } catch (e) {
    warn("DM notification listener failed", e.message);
    setTimeout(listenForDMs, 5000);
  }
};
