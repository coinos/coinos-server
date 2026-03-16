import config from "$config";
import { db, g } from "$lib/db";
import { l, warn } from "$lib/logging";
import { getUser } from "$lib/utils";
import { Relay } from "nostr-tools/relay";
import webpush from "web-push";

if (config.vapid) {
  webpush.setVapidDetails(`mailto:${config.support}`, config.vapid.pk, config.vapid.sk);
}

// ---------------------------------------------------------------------------
// Push notification delivery
// ---------------------------------------------------------------------------

const sendPush = async (pubkey: string, url = "/messages", event?: any) => {
  try {
    const user = await getUser(pubkey);
    if (!user?.id) return;

    const subscriptions = await db.sMembers(`${user.id}:subscriptions`);
    if (!subscriptions?.length) return;

    l(`push to ${user.username} (${subscriptions.length} subs)`);

    const payloadObj: any = {
      title: "New message",
      body: "You have a new encrypted message",
      url,
    };

    // Include the raw event for push-as-data-transport (size guard for ~4KB push limit)
    if (event) {
      const eventStr = JSON.stringify(event);
      if (eventStr.length < 3000) payloadObj.event = eventStr;
    }

    const payload = JSON.stringify(payloadObj);

    for (const s of subscriptions as any) {
      webpush
        .sendNotification(JSON.parse(s as string), payload)
        .catch((e) => {
          warn("push failed", e.message);
          db.sRem(`${user.id}:subscriptions`, s);
        });
    }
  } catch {
    // User not found — not a coinos user
  }
};

// ---------------------------------------------------------------------------
// Kind 1059 (gift wrap / invite) — notifies recipient via p tag
// ---------------------------------------------------------------------------

const handleInviteEvent = async (event: any) => {
  const pTag = event.tags.find((t: any) => t[0] === "p");
  if (!pTag) return;
  await sendPush(pTag[1]);
};

// ---------------------------------------------------------------------------
// Kind 445 (MLS group message) — notifies all group members except sender
// ---------------------------------------------------------------------------

// In-memory group registry: nostrGroupId → { members, relays }
interface GroupEntry {
  members: string[];
  relays: string[];
}

const groupRegistry = new Map<string, GroupEntry>();

// Track active relay subscriptions for kind 445
const activeGroupRelays = new Set<string>();
const groupRelaySubs: (() => void)[] = [];

const handleGroupMessage = async (event: any) => {
  const hTag = event.tags.find((t: any) => t[0] === "h");
  if (!hTag) return;

  const nostrGroupId = hTag[1];
  const group = groupRegistry.get(nostrGroupId);
  if (!group) return;

  const sender = event.pubkey;
  for (const member of group.members) {
    if (member !== sender) sendPush(member, "/messages", event);
  }
};

const subscribeGroupRelay = (url: string) => {
  if (activeGroupRelays.has(url)) return;
  activeGroupRelays.add(url);

  Relay.connect(url)
    .then((relay) => {
      const sub = relay.subscribe(
        [{ kinds: [445], since: Math.floor(Date.now() / 1000) }],
        { onevent: handleGroupMessage },
      );
      groupRelaySubs.push(() => sub.close());
      // l(`listening for group messages on ${url}`);
    })
    .catch((e) => {
      warn(`group listener failed ${url}`, e.message);
      activeGroupRelays.delete(url);
      setTimeout(() => subscribeGroupRelay(url), 5000);
    });
};

/** Called when a client syncs its groups. Updates registry and subscribes to new relays. */
export const syncGroups = async (groups: { nostrGroupId: string; members: string[]; relays: string[] }[]) => {
  for (const g of groups) {
    groupRegistry.set(g.nostrGroupId, { members: g.members, relays: g.relays });
    for (const url of g.relays) subscribeGroupRelay(url);
  }

  l(`group registry: ${groupRegistry.size} groups, ${activeGroupRelays.size} relays`);
};

// ---------------------------------------------------------------------------
// Kind 1059 relay subscriptions (invites / NIP-17 DMs)
// ---------------------------------------------------------------------------

const subscribeInviteRelay = (url: string) => {
  Relay.connect(url)
    .then((relay) => {
      relay.subscribe([{ kinds: [1059], since: Math.floor(Date.now() / 1000) }], {
        onevent: handleInviteEvent,
      });
      // l(`listening for invites on ${url}`);
    })
    .catch((e) => {
      warn(`invite listener failed ${url}`, e.message);
      setTimeout(() => subscribeInviteRelay(url), 5000);
    });
};

// ---------------------------------------------------------------------------
// Boot: restore group registry from Redis, start listeners
// ---------------------------------------------------------------------------

const REGISTRY_KEY = "mls:groupRegistry";

const saveRegistry = async () => {
  const obj: Record<string, GroupEntry> = {};
  for (const [id, entry] of groupRegistry) obj[id] = entry;
  await db.set(REGISTRY_KEY, JSON.stringify(obj));
};

const loadRegistry = async () => {
  try {
    const raw = await db.get(REGISTRY_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw as string);
    for (const [id, entry] of Object.entries(obj) as [string, GroupEntry][]) {
      groupRegistry.set(id, entry);
      for (const url of entry.relays) subscribeGroupRelay(url);
    }
    l(`restored ${groupRegistry.size} groups from registry`);
  } catch {}
};

/** Called from syncGroups to persist after updates */
export const syncGroupsAndSave = async (groups: { nostrGroupId: string; members: string[]; relays: string[] }[]) => {
  await syncGroups(groups);
  await saveRegistry();
};

export const listenForDMs = () => {
  // Subscribe to kind 1059 on configured relays
  const relays = new Set([config.nostr, ...config.relays.filter((r: string) => r.startsWith("wss://"))]);
  for (const url of relays) subscribeInviteRelay(url);

  // Restore persisted group registry and subscribe to kind 445
  loadRegistry();
};
