import config from "$config";
import { db, g } from "$lib/db";
import { l, warn } from "$lib/logging";
import { getUser } from "$lib/utils";
import { Relay } from "nostr-tools/relay";
import webpush from "web-push";

if (config.vapid) {
  webpush.setVapidDetails(`mailto:${config.support}`, config.vapid.pk, config.vapid.sk);
}

const handleDmEvent = async (event: any) => {
  const pTag = event.tags.find((t: any) => t[0] === "p");
  l(`dm event ${event.id.slice(0, 8)} p=${pTag?.[1]?.slice(0, 12) || "none"}`);
  if (!pTag) return;

  const recipientPubkey = pTag[1];

  try {
    const user = await getUser(recipientPubkey);
    if (!user?.id) return;

    const subscriptions = await db.sMembers(`${user.id}:subscriptions`);
    if (!subscriptions?.length) return;

    l(`dm push to ${user.username} (${subscriptions.length} subs)`);

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
};

const subscribeRelay = (url: string) => {
  Relay.connect(url)
    .then((relay) => {
      relay.subscribe([{ kinds: [1059], since: Math.floor(Date.now() / 1000) }], {
        onevent: handleDmEvent,
      });
      l(`listening for DM notifications on ${url}`);
    })
    .catch((e) => {
      warn(`DM listener failed ${url}`, e.message);
      setTimeout(() => subscribeRelay(url), 5000);
    });
};

export const listenForDMs = () => {
  const relays = new Set([config.nostr, ...config.relays.filter((r: string) => r.startsWith("wss://"))]);
  for (const url of relays) subscribeRelay(url);
};
